/**
 * Cámara → foto → sello → guardar.
 *
 * Privacidad en cada paso:
 * - La cámara se enciende solo al pulsar y se apaga en el instante del disparo.
 * - La foto sale sin EXIF (pasa por un canvas) y nunca se sube.
 * - La ubicación viene apagada; si se activa, se sella cifrada y por niveles.
 * - El recibo no lleva modelo de teléfono, sistema ni zona horaria.
 * - Al salir de la vista se sueltan la foto, la URL local y el geohash.
 */
import { isInsideContainerSync } from '@parity/product-sdk-host';
import { icon } from '../lib/icons';
import { openCamera, grabFrame, type OpenCamera } from '../lib/camera';
import { finishShot, verifyUrl, type Shot } from '../lib/photo';
import { newId } from '../lib/ids.ts';
import { dhashHex } from '../lib/imagehash.ts';
import { encodeGeohash } from '../lib/geohash.ts';
import { LEVELS, maxLevelFor, sealLocation, makeProof, encodeProof, type Level, type SealedLocation } from '../lib/loc.ts';
import { receiptBytes, utcSeconds, type Receipt } from '../lib/receipt.ts';
import { locationMaster, currentPosition, type Position } from '../lib/geo';
import { subscribeFinalized, getClient, withReadClient, ASSET_HUB_GENESIS, NETWORK, type Block } from '../lib/chain';
import { connectWallet, authorFor, signBytes, txSignerFor, hasIdentity, isConnected, connectedUsername, identityUnavailableReason, modeOf, type Author } from '../lib/signer';
import { askChainSubmit } from '../lib/permissions';
import { registryDeployed, freeBalance, isMapped, mapAccount, simulateSeal, submitSeal, readPhoto, pas, type SealArgs } from '../lib/registry';
import { sharePhoto, downloadPhoto, canShareFiles, isIOS } from '../lib/save';
import { withTimeout, TIMED_OUT, describeError } from '../lib/host';
import { APP_DOTNS, FAUCET_URL } from '../lib/network';
import { esc, toast, copyText, fmtBlock, fmtBytes, shortAddr, shortHash, type Cleanup } from '../ui';

/** Tiempo para aprobar en el celular y que el bloque se finalice. */
const TX_MS = 240_000;

type Phase = 'intro' | 'live' | 'working' | 'review' | 'sealing' | 'sealed';

export function renderCamera(root: HTMLElement): Cleanup {
  const inside = isInsideContainerSync();
  let phase: Phase = 'intro';
  let facing: 'environment' | 'user' = 'environment';
  let wantLocation = false;
  let wantStamp = true;
  let cam: OpenCamera | null = null;
  let latest: Block | null = null;
  let shot: Shot | null = null;
  let anchor: Block | null = null;
  let taken = '';
  let position: Promise<Position> | null = null;
  let loc: { sealed: SealedLocation; g8: string; max: Level; accuracy: number } | null = null;
  let locNote = '';
  let chosen: 'identity' | 'app' = 'identity';
  let sealedBlock = 0;
  /** La foto ya salió de la app (se compartió o la persona dijo que la guardó). */
  let saved = false;
  let dead = false;

  let stopBlocks: (() => void) | null = null;
  subscribeFinalized(b => { latest = b; drawBlock(); }, e => console.warn('[chain]', e))
    .then(stop => (dead ? stop() : (stopBlocks = stop)))
    .catch(e => console.warn('[chain]', e));

  const stopCamera = () => {
    cam?.stop();
    cam = null;
  };

  const drawBlock = () => {
    const el = root.querySelector('#blk');
    if (el) el.innerHTML = latest ? `<i></i>${fmtBlock(latest.number)}` : 'Asset Hub…';
  };

  const top = (right = '') => `
    <div class="cam-top">
      <a class="round" href="#/" aria-label="Salir">${icon('arrowLeft')}</a>
      <span class="blk" id="blk" title="Último bloque finalizado de Asset Hub"></span>
      <span class="grow"></span>${right}
    </div>`;

  const chips = () => `
    <div class="chips" role="group" aria-label="Opciones de la foto">
      <button class="chip${wantLocation ? ' on' : ''}" id="t-loc" aria-pressed="${wantLocation}">${icon(wantLocation ? 'mapPin' : 'eyeSlash')}${wantLocation ? 'Ubicación cifrada' : 'Sin ubicación'}</button>
      <button class="chip${wantStamp ? ' on' : ''}" id="t-stamp" aria-pressed="${wantStamp}">${icon('qrCode')}${wantStamp ? 'Marco con QR' : 'Sin QR'}</button>
    </div>`;

  const bindChips = () => {
    root.querySelector('#t-loc')?.addEventListener('click', () => { wantLocation = !wantLocation; redraw(); });
    root.querySelector('#t-stamp')?.addEventListener('click', () => { wantStamp = !wantStamp; redraw(); });
  };

  function redraw() {
    if (dead) return;
    if (phase === 'intro') intro();
    else if (phase === 'live') live();
  }

  function intro(error = '') {
    phase = 'intro';
    root.innerHTML = `<div class="cam">
      ${top()}
      <div class="cam-center">
        <h1>Proof of Cam</h1>
        <p>La foto se toma aquí, se firma y se ancla a un bloque. No se sube a ningún lado: se queda en tu teléfono con un QR para verificarla.</p>
        ${error ? `<div class="note bad" style="text-align:left">${icon('warningCircle')}<span>${esc(error)}</span></div>` : ''}
        <button class="btn accent big" id="open">${icon('camera')}Encender cámara</button>
        ${inside ? '' : `<p class="hint">Estás en un navegador normal: la foto sale como ensayo y no se sella en la cadena. Para sellar, abre <b>${APP_DOTNS}</b> en Polkadot App.</p>`}
      </div>
      <div class="cam-bottom">${chips()}</div>
    </div>`;
    drawBlock();
    bindChips();
    root.querySelector('#open')!.addEventListener('click', start);
  }

  async function start() {
    const b = root.querySelector<HTMLButtonElement>('#open');
    if (b) { b.disabled = true; b.innerHTML = `<i class="spin"></i>Pidiendo la cámara…`; }
    try {
      cam = await openCamera(facing);
      if (dead) return stopCamera();
      live();
    } catch (e) {
      stopCamera();
      intro(e instanceof Error ? e.message : describeError(e));
    }
  }

  function live() {
    phase = 'live';
    root.innerHTML = `<div class="cam">
      <video id="v" autoplay playsinline muted class="${cam?.info.facing === 'front' ? 'mirror' : ''}"></video>
      ${top(`<button class="round" id="flip" aria-label="Cambiar de cámara">${icon('cameraRotate')}</button>`)}
      <div class="cam-bottom">
        ${chips()}
        <div class="shutter-row">
          <span></span>
          <button class="shutter" id="shoot" aria-label="Tomar foto"></button>
          <span></span>
        </div>
        <p class="hint">${wantLocation ? 'La ubicación se pedirá al disparar y se sellará cifrada.' : 'Sin ubicación: nadie sabrá dónde se tomó.'}</p>
      </div>
    </div>`;
    const v = root.querySelector<HTMLVideoElement>('#v')!;
    if (cam) v.srcObject = cam.stream;
    v.play().catch(() => undefined);
    drawBlock();
    bindChips();
    root.querySelector('#flip')!.addEventListener('click', async () => {
      facing = facing === 'environment' ? 'user' : 'environment';
      stopCamera();
      await start();
    });
    root.querySelector('#shoot')!.addEventListener('click', () => shoot(v));
  }

  async function shoot(video: HTMLVideoElement) {
    if (!cam) return;
    if (!latest) return toast('Espera a que llegue un bloque de Asset Hub');
    // El ancla es el último bloque finalizado ANTES del disparo: la foto no pudo existir antes.
    anchor = latest;
    taken = utcSeconds();
    const facingNow = cam.info.facing;
    if (wantLocation) position = currentPosition();
    phase = 'working';
    let frame: HTMLCanvasElement;
    try {
      frame = await grabFrame(cam, video);
    } catch (e) {
      stopCamera();
      return intro((e as Error).message);
    } finally {
      // Apagada en el instante del disparo: el indicador del sistema también.
      stopCamera();
    }
    root.innerHTML = `<div class="cam"><div class="cam-center"><i class="spin"></i><p>Preparando la foto…${wantLocation ? '<br>y pidiendo la ubicación (hasta 25 s)' : ''}</p></div></div>`;
    try {
      shot = await finishShot(frame, { id: newId(), stamp: wantStamp, camera: facingNow, taken });
      frame.width = frame.height = 0;
    } catch (e) {
      return intro(`No se pudo preparar la foto: ${(e as Error).message}`);
    }
    await sealLocationIfWanted();
    review();
  }

  async function sealLocationIfWanted() {
    loc = null;
    locNote = '';
    if (!wantLocation || !position || !shot) return;
    try {
      const p = await position;
      const g8 = encodeGeohash(p.lat, p.lon, 8);
      const max = maxLevelFor(p.accuracy);
      const master = await locationMaster();
      loc = { sealed: sealLocation(master, shot.id, g8, max), g8, max, accuracy: Math.round(p.accuracy) };
      // Las coordenadas se descartan aquí: solo queda el geohash de 8 caracteres, en memoria.
    } catch (e) {
      locNote = (e as Error).message;
    } finally {
      position = null;
    }
  }

  function modeBlock(): string {
    if (!inside) return `<p class="muted" style="font-size:14px">${icon('info')} Ensayo en navegador: se firma con una cuenta de prueba y no se sella en la cadena.</p>`;
    if (!isConnected()) return `<button class="btn block" id="connect">${icon('wallet')}Conectar mi wallet para firmar</button>`;
    const idOk = hasIdentity();
    if (!idOk) chosen = 'app';
    return `<div class="mode-pick" role="radiogroup" aria-label="Firmar como">
      <label${idOk ? '' : ' style="opacity:.5"'}><input type="radio" name="mode" value="identity" ${chosen === 'identity' ? 'checked' : ''} ${idOk ? '' : 'disabled'}>
        <span><b>${icon('user')} Con mi identidad</b> <span class="mono">${esc(connectedUsername() ?? '')}</span>
        <small>${idOk ? 'Quien verifique verá tu username, comprobado en People chain. El registro es público: cualquiera puede ver cuántas fotos firmó tu nombre y cuándo.' : esc(`No disponible: ${identityUnavailableReason() ?? 'sin identidad'}.`)}</small></span></label>
      <label><input type="radio" name="mode" value="app" ${chosen === 'app' ? 'checked' : ''}>
        <span><b>${icon('detective')} Con seudónimo</b>
        <small>Firma la cuenta de esta app: nadie puede ligarla a tu nombre. Tus fotos con seudónimo sí quedan ligadas entre sí. Paga su propia transacción, así que necesita su propio saldo.</small></span></label>
    </div>`;
  }

  function locLine(): string {
    if (!wantLocation) return `${icon('eyeSlash')} Sin ubicación`;
    if (loc) return `${icon('lockSimple')} Ubicación cifrada · se puede revelar hasta nivel <b>${LEVELS[loc.max - 1].label}</b> (GPS ±${loc.accuracy} m)`;
    return `${icon('warningCircle')} Sin ubicación: ${esc(locNote || 'no se obtuvo')}`;
  }

  function review() {
    if (!shot || !anchor) return intro();
    phase = 'review';
    root.innerHTML = `<div class="cam">
      <div class="shot-wrap"><img src="${shot.url}" alt="Foto recién tomada"></div>
      <div class="sheet">
        <div class="grab"></div>
        <h2>¿Sellar esta foto?</h2>
        <dl class="kv" style="margin:12px 0">
          <dt>Tamaño</dt><dd>${shot.w}×${shot.h} · ${fmtBytes(shot.bytes.length)} · sin EXIF</dd>
          <dt>Bloque previo</dt><dd class="mono">${fmtBlock(anchor.number)}</dd>
          <dt>Huella</dt><dd class="mono">${shortHash(shot.sha256)}</dd>
          <dt>Lugar</dt><dd>${locLine()}</dd>
        </dl>
        ${modeBlock()}
        <div class="actions" style="margin-top:14px">
          <button class="btn accent big block" id="seal">${icon('sealCheck')}Sellar foto</button>
          <button class="btn ghost block" id="retake">${icon('arrowCounterClockwise')}Repetir</button>
        </div>
        ${!registryDeployed() && inside ? `<div class="note" style="margin-top:12px">${icon('warningCircle')}<span>El registro de fotos todavía no está desplegado: la firma funciona, el sello no.</span></div>` : ''}
      </div>
    </div>`;
    root.querySelector('#connect')?.addEventListener('click', async ev => {
      const b = ev.currentTarget as HTMLButtonElement;
      b.disabled = true;
      b.innerHTML = '<i class="spin"></i>Abriendo el wallet…';
      try {
        await connectWallet();
        chosen = hasIdentity() ? 'identity' : 'app';
      } catch (e) {
        toast((e as Error).message);
      }
      review();
    });
    root.querySelectorAll<HTMLInputElement>('input[name=mode]').forEach(r => r.addEventListener('change', () => { chosen = r.value as 'identity' | 'app'; }));
    root.querySelector('#retake')!.addEventListener('click', () => { dropShot(); intro(); });
    root.querySelector('#seal')!.addEventListener('click', seal);
  }

  const STEPS = ['Revisar saldo y registro', 'Firmar el recibo en Polkadot App', 'Registrar la cuenta (solo la primera vez)', 'Enviar el sello', 'Esperar el bloque finalizado'];

  function steps(at: number, error = '', extra = '') {
    if (!shot) return;
    phase = 'sealing';
    root.innerHTML = `<div class="cam">
      <div class="shot-wrap"><img src="${shot.url}" alt=""></div>
      <div class="sheet">
        <div class="grab"></div>
        <h2>Sellando</h2>
        <ol class="steps">${STEPS.map((s, i) => `<li class="${i < at ? 'done' : i === at ? 'doing' : ''}">${i < at ? icon('checkCircle') : i === at ? (error ? icon('xCircle') : '<i class="spin"></i>') : icon('clock')}${s}</li>`).join('')}</ol>
        ${error ? `<div class="note bad">${icon('warningCircle')}<span>${esc(error)}</span></div>${extra}
          <div class="actions" style="margin-top:12px"><button class="btn primary block" id="again">Reintentar</button><button class="btn ghost block" id="back">Volver</button></div>` : ''}
      </div>
    </div>`;
    root.querySelector('#again')?.addEventListener('click', seal);
    root.querySelector('#back')?.addEventListener('click', review);
    root.querySelector('#copy-addr')?.addEventListener('click', ev => copyText((ev.currentTarget as HTMLElement).dataset.addr!, 'Dirección copiada'));
  }

  function buildReceipt(author: Author): Receipt {
    return {
      v: 1,
      app: 'proofofcam',
      id: shot!.id,
      sha256: shot!.sha256,
      dhash: dhashHex(shot!.visual),
      stamp: shot!.stamp,
      taken,
      block: { n: anchor!.number, hash: anchor!.hash },
      ...(loc ? { loc: loc.sealed } : {}),
      who: author.kind === 'identity' ? author.username ?? '' : '',
      mode: modeOf(author.kind),
      net: NETWORK,
      genesis: ASSET_HUB_GENESIS,
    };
  }

  async function seal() {
    if (!shot || !anchor) return;
    let at = 0;
    try {
      if (!isConnected()) await connectWallet();
      const author = authorFor(chosen);
      const bytes = receiptBytes(buildReceipt(author));
      const receipt = `0x${[...bytes].map(b => b.toString(16).padStart(2, '0')).join('')}` as `0x${string}`;

      if (author.kind === 'rehearsal') {
        steps(1);
        await signBytes(bytes, 'rehearsal');
        sealedBlock = 0;
        return sealed();
      }
      if (!registryDeployed()) throw new Error('el registro de fotos todavía no está desplegado');

      // 1. Antes de pedir firmas: ¿alcanza el saldo de quien paga?
      steps(at);
      const args = (sig: `0x${string}`): SealArgs => ({
        id: shot!.id, imageHash: shot!.sha256, visualHash: shot!.visual, pubkey: author.pubkey as `0x${string}`, anchorBlock: anchor!.number, sig, receipt,
      });
      const balance = await withReadClient(c => freeBalance(c, author.address));
      const mapped = await withReadClient(c => isMapped(c, author.address));
      const estimate = await withReadClient(c => simulateSeal(c, mapped ? author.address : '5DfhGyQdFobKM8NsWvEeAKk5EQQgYe9AydgJ7rMB6E1EqRzV', args(`0x${'00'.repeat(64)}`)));
      if (!estimate.ok) throw new Error(`el registro no aceptaría el sello: ${estimate.why}`);
      const need = (estimate.deposit * 3n) / 2n + 3n * 10n ** 8n;
      if (balance < need) {
        const who = author.kind === 'identity' ? 'Tu identidad' : 'Tu seudónimo (la cuenta de esta app)';
        return steps(at, `${who} tiene ${pas(balance)} y el sello necesita unos ${pas(need)}.`,
          `<p class="muted" style="font-size:14px;margin-top:10px">Pide PAS en <b>${FAUCET_URL.replace('https://', '')}</b> (Paseo Asset Hub) para <span class="mono">${shortAddr(author.address)}</span>.${author.kind === 'app' ? ' No lo fondees desde tu identidad: esa transferencia ligaría el seudónimo a tu nombre.' : ''}</p>
           <button class="btn sm" id="copy-addr" data-addr="${esc(author.address)}" style="margin-top:8px">${icon('copy')}Copiar dirección</button>`);
      }

      // 2. Firma del recibo.
      steps(++at);
      const sig = (await signBytes(bytes, author.kind)) as `0x${string}`;

      // 3. Mapeo en pallet-revive, solo si hace falta.
      steps(++at);
      await askChainSubmit();
      const signer = txSignerFor(author.kind);
      if (!signer) throw new Error('no hay firmante de transacciones: vuelve a conectar tu wallet');
      const client = await getClient();
      if (!mapped) {
        const m = await withTimeout(mapAccount(client, signer, () => undefined), TX_MS);
        if (m === TIMED_OUT) throw new Error('el registro de la cuenta no se confirmó a tiempo');
      }

      // 4 y 5. Simulación con la firma real y envío.
      steps(++at);
      const sim = await withReadClient(c => simulateSeal(c, author.address, args(sig)));
      if (!sim.ok) throw new Error(sim.why);
      const r = await withTimeout(submitSeal(client, signer, args(sig), sim, () => steps(4)), TX_MS);
      if (r === TIMED_OUT) {
        const late = await withReadClient(c => readPhoto(c, shot!.id)).catch(() => null);
        if (!late) throw new Error('no llegó la confirmación a tiempo; revisa el acta en un minuto antes de reintentar');
        sealedBlock = Number(late.blockNumber);
      } else {
        sealedBlock = r.block;
      }
      sealed();
    } catch (e) {
      steps(at, describeSealError(e));
    }
  }

  function sealed() {
    if (!shot) return;
    phase = 'sealed';
    const link = verifyUrl(shot.id);
    const rehearsal = !inside;
    const share = canShareFiles();
    const ios = isIOS();
    root.innerHTML = `<div class="cam">
      <div class="shot-wrap"><img src="${shot.url}" alt="Foto sellada"></div>
      <div class="sheet">
        <div class="grab"></div>
        <span class="pill ${rehearsal ? '' : 'ok'}">${icon('sealFill')}${rehearsal ? 'Ensayo firmado' : `Sellada en el bloque ${fmtBlock(sealedBlock)}`}</span>
        <h2 style="margin-top:10px">Guárdala en tu teléfono</h2>
        <p class="muted" style="font-size:14px">Es la única copia: no está en ningún servidor ni en la cadena. ${shot.stamp ? 'El QR del marco lleva a su acta; la foto no se tocó.' : 'Sin QR: se verifica soltándola en «Verificar».'}</p>
        <div class="actions" style="margin-top:14px">
          <button class="btn accent block" id="save">${icon('downloadSimple')}${share ? 'Guardar en mi teléfono' : 'Ver la foto para guardarla'}</button>
          ${share ? `<button class="btn ghost block" id="viewer">${icon('image')}Ver la foto para guardarla</button>` : ''}
          ${ios ? '' : `<button class="btn ghost block" id="dl">${icon('downloadSimple')}Descargar archivo</button>`}
        </div>
        <p class="faint" style="font-size:13px;margin-top:8px" id="save-note">${share ? 'Se abre la hoja del sistema: elige "Guardar imagen".' : 'Mantén presionada la foto y elige "Guardar imagen".'}</p>
        ${rehearsal ? '' : `<div class="actions" style="margin-top:14px">
          <button class="btn sm" id="copy-link">${icon('copy')}Copiar enlace del acta</button>
          <button class="btn sm" id="acta">${icon('shieldCheck')}Ver el acta</button>
        </div>`}
        ${loc && !rehearsal ? revealBlock() : ''}
        <button class="btn ghost block" id="another" style="margin-top:16px">${icon('camera')}Tomar otra</button>
      </div>
    </div>`;
    const markSaved = () => {
      saved = true;
      const n = root.querySelector('#save-note');
      if (n) n.innerHTML = `${icon('checkCircle')} Guardada. Ya puedes tomar otra.`;
    };
    root.querySelector('#save')!.addEventListener('click', async () => {
      if (!share) return openViewer(markSaved);
      const r = await sharePhoto(shot!.blob, shot!.id);
      if (r === 'shared') markSaved();
      else if (r === 'unsupported') openViewer(markSaved);
    });
    root.querySelector('#viewer')?.addEventListener('click', () => openViewer(markSaved));
    root.querySelector('#dl')?.addEventListener('click', () => { downloadPhoto(shot!.blob, shot!.id); toast('Descarga iniciada: revisa tus descargas'); });
    root.querySelector('#copy-link')?.addEventListener('click', () => copyText(link, 'Enlace copiado'));
    root.querySelectorAll<HTMLButtonElement>('[data-level]').forEach(b => b.addEventListener('click', () => reveal(Number(b.dataset.level) as Level)));
    // Salir suelta la foto: si no se ha guardado, hay que confirmar con un segundo toque.
    const guard = (el: HTMLButtonElement | null, go: () => void) => el?.addEventListener('click', () => {
      if (saved || el.dataset.armed) return go();
      el.dataset.armed = '1';
      el.innerHTML = `${icon('warningCircle')}Aún no la guardas. Toca otra vez para salir sin ella`;
      setTimeout(() => { if (!dead && el.isConnected) { delete el.dataset.armed; el.innerHTML = el.id === 'acta' ? `${icon('shieldCheck')}Ver el acta` : `${icon('camera')}Tomar otra`; } }, 4000);
    });
    guard(root.querySelector('#acta'), () => { location.hash = `#/f/${shot!.id}`; });
    guard(root.querySelector('#another'), () => { dropShot(); intro(); });
  }

  /**
   * Visor dentro de la app para guardar con el gesto del sistema. No navega a
   * ningún lado: en iPhone, abrir la imagen en el WebView reemplazaba la app y
   * la foto se perdía.
   */
  function openViewer(onSaved: () => void) {
    if (!shot) return;
    const v = document.createElement('div');
    v.className = 'viewer';
    v.setAttribute('role', 'dialog');
    v.setAttribute('aria-label', 'Foto para guardar');
    v.innerHTML = `
      <button class="round viewer-close" aria-label="Cerrar">${icon('xCircle')}</button>
      <img src="${shot.url}" alt="Foto sellada">
      <div class="viewer-help">
        <p>Mantén presionada la foto y elige <b>Guardar imagen</b> o <b>Guardar en Fotos</b>.</p>
        <div class="actions" style="justify-content:center;margin-top:12px">
          ${canShareFiles() ? `<button class="btn sm" id="v-share">${icon('shareNetwork')}Compartir</button>` : ''}
          <button class="btn sm primary" id="v-done">${icon('checkCircle')}Ya la guardé</button>
        </div>
      </div>`;
    const close = () => v.remove();
    v.querySelector('.viewer-close')!.addEventListener('click', close);
    v.querySelector('#v-done')!.addEventListener('click', () => { onSaved(); close(); });
    v.querySelector('#v-share')?.addEventListener('click', async () => {
      if ((await sharePhoto(shot!.blob, shot!.id)) === 'shared') { onSaved(); close(); }
    });
    root.querySelector('.cam')?.append(v);
  }

  function revealBlock(): string {
    return `<div class="card" style="margin-top:16px;padding:16px">
      <h3 style="font-size:18px">${icon('lockSimple')} Ubicación sellada</h3>
      <p class="muted" style="font-size:14px">Nadie puede verla. Si quieres probar dónde fue, crea un enlace que revele solo un nivel; los demás siguen ocultos.</p>
      <div class="levels" style="margin-top:10px">${LEVELS.map(l => `<button class="btn sm" data-level="${l.n}" ${l.n > loc!.max ? 'disabled' : ''}>${l.label}</button>`).join('')}</div>
    </div>`;
  }

  async function reveal(level: Level) {
    if (!shot || !loc) return;
    try {
      const proof = makeProof(await locationMaster(), shot.id, loc.sealed, level);
      await copyText(`${verifyUrl(shot.id)}?loc=${encodeProof(proof)}`, `Enlace con nivel ${LEVELS[level - 1].label} copiado`);
    } catch (e) {
      toast((e as Error).message);
    }
  }

  function dropShot() {
    if (shot) URL.revokeObjectURL(shot.url);
    shot = null;
    saved = false;
    loc = null;
    anchor = null;
  }

  intro();
  return () => {
    dead = true;
    stopCamera();
    stopBlocks?.();
    dropShot();
  };
}

function describeSealError(e: unknown): string {
  const m = e instanceof Error ? e.message : describeError(e);
  if (/reject|cancel|denied|Denied/i.test(m)) return 'Se canceló la firma.';
  return m;
}
