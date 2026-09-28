/**
 * Verificar: el acta de una foto (`#/f/<id>`, a donde lleva su QR) y el
 * buscador por archivo (`#/verificar`).
 *
 * Todo lo que se compara pasa en este navegador: la copia que alguien suelta
 * aquí no se sube a ningún lado. Lo único que sale son lecturas de la cadena.
 */
import { isInsideContainerSync } from '@parity/product-sdk-host';
import { hexToU8a } from '@polkadot/util';
import { icon } from '../lib/icons';
import { isId } from '../lib/ids.ts';
import { compareHashes, dhashHex, SIMILAR_MAX, hamming, isWeakVisual, type MatchKind } from '../lib/imagehash.ts';
import { parseReceipt, verifyReceiptSig, addressOf, type Receipt } from '../lib/receipt.ts';
import { LEVELS, decodeProof, verifyProof, openLocation, makeProof, encodeProof, type Level } from '../lib/loc.ts';
import { hashFile, verifyUrl, type FileHashes } from '../lib/photo';
import { withReadClient, hashAtHeight, chainSource, ASSET_HUB_GENESIS } from '../lib/chain';
import { readPhoto, idOfImage, allVisualHashes, registryDeployed, type OnChainPhoto } from '../lib/registry';
import { usernameOwner } from '../lib/people';
import { locationMaster } from '../lib/geo';
import { connectWallet, authorFor, hasIdentity } from '../lib/signer';
import { esc, topbar, row, toast, copyText, fmtBlock, fmtBytes, fmtDate, shortAddr, type Tone, type Cleanup } from '../ui';

/** Resultado de comparar que llega desde el buscador, para no pedir la foto dos veces. */
let carried: { id: string; file: FileHashes } | null = null;

function dropzone(label: string): string {
  return `<label class="drop" id="drop">
    ${icon('image')}
    <b>${label}</b>
    <span style="font-size:14px">Toca para elegir, arrastra o pega una imagen. No se sube: se revisa en este navegador.</span>
    <input type="file" accept="image/*" id="file">
  </label>`;
}

/** Engancha el selector, arrastrar y pegar a una función que recibe el archivo. */
function bindDrop(root: HTMLElement, onFile: (f: File) => void): () => void {
  const drop = root.querySelector<HTMLElement>('#drop')!;
  const input = root.querySelector<HTMLInputElement>('#file')!;
  input.addEventListener('change', () => { if (input.files?.[0]) onFile(input.files[0]); input.value = ''; });
  drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', e => {
    e.preventDefault();
    drop.classList.remove('over');
    const f = e.dataTransfer?.files?.[0];
    if (f) onFile(f);
  });
  const paste = (e: ClipboardEvent) => {
    const f = [...(e.clipboardData?.items ?? [])].find(i => i.kind === 'file')?.getAsFile();
    if (f) onFile(f);
  };
  document.addEventListener('paste', paste);
  return () => document.removeEventListener('paste', paste);
}

const MATCH: Record<MatchKind, [Tone, string, string]> = {
  exact: ['ok', 'Idéntica a la sellada', 'Mismos bytes: no cambió ni un píxel.'],
  same: ['ok', 'La misma foto, con otra compresión o tamaño', 'Así queda después de pasar por WhatsApp o una red social. Para la prueba fuerte pide el archivo original.'],
  similar: ['warn', 'Se parece, pero no es seguro que sea la misma', 'Puede estar recortada, editada o ser otra toma de la misma escena.'],
  different: ['bad', 'No es esta foto', 'La imagen que revisaste no corresponde a esta acta.'],
  weak: ['warn', 'No es idéntica, y esta foto tiene muy poco detalle para compararla de otra forma', 'Su huella visual no distingue bien (cielo, pared, pantalla oscura). Solo la copia exacta prueba que es la misma: pide el archivo original.'],
};

function matchRow(kind: MatchKind, distance: number): string {
  const [tone, title, detail] = MATCH[kind];
  return row(tone, title, `${detail}${kind === 'exact' || kind === 'weak' ? '' : ` Diferencia visual: ${distance} de 64.`}`);
}

/**
 * Por dónde se leyó la cadena, dicho sin rodeos: dentro de Polkadot App es el
 * cliente ligero del host; fuera, un RPC público que ve la IP y qué acta se
 * consulta.
 */
function sourceNote(): string {
  const { source } = chainSource();
  if (source === 'host') return 'el cliente ligero de Polkadot App, sin intermediarios';
  return 'un RPC público: su operador puede ver tu IP y qué acta consultaste. Dentro de Polkadot App o en el gateway .dev-dot.li se usa un cliente ligero';
}

// ─────────────────────────────── acta ───────────────────────────────

export function renderActa(root: HTMLElement, id: string, locParam: string | null): Cleanup {
  let dead = false;
  let unbind = () => undefined as void;
  root.innerHTML = `${topbar()}<main class="page"><div class="shell">
    <section class="card verdict" id="verdict"><span class="mono faint">acta ${esc(id)}</span><h1>Consultando…</h1><p class="muted">Leyendo el registro en Asset Hub.</p></section>
  </div></main>`;

  (async () => {
    if (!registryDeployed()) return fail('El registro de fotos todavía no está desplegado.');
    let photo: OnChainPhoto | null;
    try {
      photo = await withReadClient(c => readPhoto(c, id));
    } catch (e) {
      return fail(`No se pudo consultar Asset Hub (${(e as Error).message}). Inténtalo de nuevo en un momento.`);
    }
    if (dead) return;
    if (!photo) return fail('No hay acta con este id. Si la foto se acaba de tomar, espera unos segundos; si se tomó en modo ensayo, nunca se selló.');
    const bytes = hexToU8a(photo.receipt);
    const receipt = parseReceipt(bytes);
    if (typeof receipt === 'string') return fail(`El acta existe pero su recibo no se puede leer: ${receipt}.`);
    draw(photo, receipt, bytes);
  })();

  function fail(msg: string) {
    if (dead) return;
    root.querySelector('#verdict')!.outerHTML = `<section class="card verdict bad"><span class="mono faint">acta ${esc(id)}</span><h1>Sin acta</h1><p class="muted">${esc(msg)}</p>
      <div class="actions" style="margin-top:14px"><a class="btn" href="#/verificar">${icon('magnifyingGlass')}Buscar por foto</a></div></section>`;
  }

  function draw(p: OnChainPhoto, r: Receipt, bytes: Uint8Array) {
    const window = Number(p.blockNumber) - r.block.n;
    root.querySelector('main')!.innerHTML = `<div class="shell">
      <section class="card verdict" id="verdict"><span class="mono faint">acta ${esc(id)}</span><h1>Comprobando…</h1><p class="muted" id="who"></p></section>
      <section class="card"><h3>Comprobaciones</h3><div id="checks">
        <div id="c-sig">${row('wait', 'Firma')}</div>
        <div id="c-data">${row('wait', 'El acta coincide con su recibo')}</div>
        <div id="c-id">${row('wait', 'Quién la tomó')}</div>
        <div id="c-blk">${row('wait', 'Bloque previo al disparo')}</div>
        <div id="c-seal">${row('ok', `Sellada en el bloque ${fmtBlock(p.blockNumber)}`, `${fmtDate(Number(p.sealedAt) * 1000)}. La foto existía a más tardar entonces.`)}</div>
      </div></section>
      <section class="card"><h3>Compara tu copia</h3><p class="muted" style="font-size:14px;margin-bottom:12px">¿Te llegó esta foto? Revisa que sea la misma que se selló.</p>
        ${dropzone('Elegir la foto que recibiste')}<div id="cmp" style="margin-top:12px"></div></section>
      <section class="card" id="loc"></section>
      <section class="card"><h3>Detalles</h3>
        <dl class="kv">
          <dt>Tomada</dt><dd>entre el bloque ${fmtBlock(r.block.n)} y el ${fmtBlock(p.blockNumber)} (${window} bloques)</dd>
          <dt>Hora del teléfono</dt><dd>${esc(r.taken)} (UTC, la declara el teléfono)</dd>
          <dt>QR en la foto</dt><dd>${r.stamp ? 'sí' : 'no'}</dd>
          <dt>Huella exacta</dt><dd class="mono">${esc(r.sha256)}</dd>
          <dt>Huella visual</dt><dd class="mono">${esc(r.dhash)}</dd>
          <dt>Firmó</dt><dd class="mono">${esc(addressOf(p.pubkey))}</dd>
          <dt>Red</dt><dd>${esc(r.net)}</dd>
          <dt>Consultado por</dt><dd>${sourceNote()}</dd>
        </dl>
      </section>
      <p class="faint" style="font-size:13px">La foto no está en la cadena: solo sus huellas. Que el acta sea válida prueba quién la tomó, cuándo y que no cambió; no prueba que la escena sea real.</p>
    </div>`;

    unbind = bindDrop(root, f => compare(f, p));
    if (carried?.id === id) {
      showCompare(carried.file, p);
      carried = null;
    }
    drawLocation(p, r);

    const set = (sel: string, html: string) => { const el = root.querySelector(sel); if (el && !dead) el.innerHTML = html; };
    const results: Tone[] = [];
    const done = (sel: string, tone: Tone, title: string, detail = '') => { results.push(tone); set(sel, row(tone, title, detail)); };

    (async () => {
      const sigOk = await verifyReceiptSig(bytes, p.sig, p.pubkey);
      done('#c-sig', sigOk ? 'ok' : 'bad', sigOk ? 'Firma válida' : 'Firma inválida', sigOk ? 'sr25519 sobre el recibo guardado en la cadena.' : 'El recibo no fue firmado por la llave que declara.');

      const mismatch = [
        r.id !== id && 'el id',
        r.sha256.toLowerCase() !== p.imageHash.toLowerCase() && 'la huella exacta',
        r.dhash !== dhashHex(p.visualHash) && 'la huella visual',
        r.block.n !== p.anchorBlock && 'el bloque previo',
        r.genesis.toLowerCase() !== ASSET_HUB_GENESIS && 'la red',
      ].filter(Boolean);
      done('#c-data', mismatch.length ? 'bad' : 'ok', mismatch.length ? 'El acta no coincide con su recibo' : 'El acta coincide con su recibo', mismatch.length ? `Difiere ${mismatch.join(', ')}.` : 'Id, huellas, bloque y red.');

      const whoEl = root.querySelector('#who');
      if (r.who) {
        try {
          const owner = await usernameOwner(r.who);
          const okId = !!owner && owner.toLowerCase() === p.pubkey.toLowerCase();
          done('#c-id', okId ? 'ok' : 'bad', okId ? `Tomada por ${esc(r.who)}` : 'Identidad falsa', okId ? 'La llave que firmó es la dueña de ese username en People chain.' : `El recibo dice ${esc(r.who)}, pero ese username no es de la llave que firmó.`);
          if (whoEl && okId) whoEl.innerHTML = `Tomada por <b>${esc(r.who)}</b>`;
        } catch (e) {
          done('#c-id', 'warn', `Dice ser de ${esc(r.who)}`, `No se pudo consultar People chain (${esc((e as Error).message)}): sin comprobar, no falso.`);
        }
      } else {
        done('#c-id', 'ok', 'Tomada con seudónimo', `Firmó ${esc(shortAddr(addressOf(p.pubkey)))}, una cuenta que a propósito no está ligada a ningún nombre.`);
        if (whoEl) whoEl.textContent = 'Tomada con seudónimo';
      }

      const onchain = await hashAtHeight(r.block.n).catch(() => null);
      if (!onchain) done('#c-blk', 'warn', `Bloque ${fmtBlock(r.block.n)} sin comprobar`, 'La red no respondió la consulta por altura: sin comprobar, no falso.');
      else if (onchain.toLowerCase() === r.block.hash.toLowerCase()) done('#c-blk', 'ok', `El bloque ${fmtBlock(r.block.n)} existe`, 'El teléfono lo vio antes del disparo: la foto no pudo existir antes.');
      else done('#c-blk', 'bad', 'Bloque inventado', `El hash del recibo no es el del bloque ${fmtBlock(r.block.n)} en Asset Hub.`);

      if (dead) return;
      const bad = results.includes('bad');
      const v = root.querySelector('#verdict')!;
      v.className = `card verdict ${bad ? 'bad' : 'ok'}`;
      v.querySelector('h1')!.textContent = bad ? 'Acta inválida' : 'Acta válida';
    })();
  }

  async function compare(f: File, p: OnChainPhoto) {
    const cmp = root.querySelector('#cmp')!;
    cmp.innerHTML = row('wait', 'Calculando las huellas de tu copia…');
    try {
      showCompare(await hashFile(f), p);
    } catch (e) {
      cmp.innerHTML = row('bad', 'No se pudo leer la imagen', esc((e as Error).message));
    }
  }

  function showCompare(h: FileHashes, p: OnChainPhoto) {
    const m = compareHashes({ sha256: p.imageHash, visual: p.visualHash }, { sha256: h.sha256, visual: h.visual });
    root.querySelector('#cmp')!.innerHTML = matchRow(m.kind, m.distance) +
      `<p class="faint" style="font-size:13px">Tu copia: ${h.w}×${h.h} · ${fmtBytes(h.size)}${h.exif.gps ? ' · trae GPS en su EXIF: no viene tal cual de Proof of Cam' : ''}.</p>`;
  }

  function drawLocation(p: OnChainPhoto, r: Receipt) {
    const box = root.querySelector<HTMLElement>('#loc')!;
    if (!r.loc) {
      box.innerHTML = `<h3>${icon('eyeSlash')} Sin ubicación</h3><p class="muted" style="font-size:14px">Quien la tomó no guardó ningún dato de lugar.</p>`;
      return;
    }
    let revealed = '';
    if (locParam) {
      const proof = decodeProof(locParam);
      const chk = proof ? verifyProof(proof, r.loc.root) : { ok: false as const, reason: 'el enlace está dañado' };
      if (chk.ok) {
        const c = chk.cell.center;
        const osm = `https://www.openstreetmap.org/?mlat=${c.lat.toFixed(5)}&mlon=${c.lon.toFixed(5)}#map=${[0, 7, 10, 14, 17][chk.level]}/${c.lat.toFixed(5)}/${c.lon.toFixed(5)}`;
        revealed = row('ok', `Nivel revelado: ${chk.label}`, `Celda de ${chk.size} alrededor de ${c.lat.toFixed(3)}, ${c.lon.toFixed(3)}. Lo declaró el teléfono al tomarla; los niveles más finos siguen ocultos.`) +
          `<a class="btn sm" href="${osm}" target="_blank" rel="noopener noreferrer" style="margin-top:6px">${icon('mapPin')}Ver la zona en OpenStreetMap</a>
           <p class="faint" style="font-size:12px;margin-top:6px">Abrir el mapa le dice a OpenStreetMap qué zona miras.</p>`;
      } else {
        revealed = row('bad', 'La ubicación del enlace no es la de esta foto', esc(chk.reason));
      }
    }
    box.innerHTML = `<h3>${icon('lockSimple')} Ubicación sellada</h3>
      <p class="muted" style="font-size:14px">Se guardó cifrada. Solo quien tomó la foto puede revelar un nivel: región, ciudad, barrio o punto.</p>
      <div style="margin-top:10px">${revealed}</div>
      ${isInsideContainerSync() ? `<button class="btn sm" id="owner" style="margin-top:10px">${icon('user')}¿La tomaste tú? Revela un nivel</button><div id="owner-out"></div>` : ''}`;
    box.querySelector('#owner')?.addEventListener('click', () => ownerReveal(p, r));
  }

  async function ownerReveal(p: OnChainPhoto, r: Receipt) {
    const out = root.querySelector<HTMLElement>('#owner-out')!;
    out.innerHTML = row('wait', 'Comprobando que la tomaste tú…');
    try {
      await connectWallet();
      const mine = [hasIdentity() ? authorFor('identity').pubkey : null, authorFor('app').pubkey].some(k => k?.toLowerCase() === p.pubkey.toLowerCase());
      if (!mine) {
        out.innerHTML = row('bad', 'No la tomó esta cuenta', 'Solo quien la firmó puede abrir su ubicación.');
        return;
      }
      const master = await locationMaster();
      const secret = openLocation(master, id, r.loc!);
      if (!secret) {
        out.innerHTML = row('bad', 'La llave no abre esta ubicación', 'Puede haberse sellado desde otra cuenta raíz.');
        return;
      }
      out.innerHTML = `<div class="levels" style="margin-top:10px">${LEVELS.map(l => `<button class="btn sm" data-level="${l.n}" ${l.n > secret.m ? 'disabled' : ''}>${l.label}</button>`).join('')}</div>
        <p class="faint" style="font-size:12px;margin-top:6px">Cada botón copia un enlace que revela solo ese nivel.</p>`;
      out.querySelectorAll<HTMLButtonElement>('[data-level]').forEach(b => b.addEventListener('click', () => {
        const proof = makeProof(master, id, r.loc!, Number(b.dataset.level) as Level);
        copyText(`${verifyUrl(id)}?loc=${encodeProof(proof)}`, `Enlace con nivel ${LEVELS[proof.i - 1].label} copiado`);
      }));
    } catch (e) {
      out.innerHTML = row('bad', 'No se pudo abrir', esc((e as Error).message));
    }
  }

  return () => { dead = true; unbind(); };
}

// ─────────────────────────────── buscador ───────────────────────────────

export function renderFinder(root: HTMLElement): Cleanup {
  root.innerHTML = `${topbar()}<main class="page"><div class="shell">
    <section class="card"><h1 style="font-size:36px">Verificar una foto</h1>
      <p class="muted" style="margin:8px 0 16px">Suelta la foto que recibiste. Si se tomó con Proof of Cam, encontramos su acta aunque haya perdido el QR o la haya recomprimido un chat.</p>
      ${dropzone('Elegir la foto')}
      <div id="out" style="margin-top:12px"></div>
    </section>
    <section class="card"><h3>¿Tienes el enlace?</h3>
      <form id="by-id" style="display:flex;gap:8px;margin-top:8px"><input class="input" id="idin" placeholder="Enlace o id de 16 letras" autocomplete="off" autocapitalize="off" spellcheck="false"><button class="btn primary">${icon('arrowRight')}</button></form>
    </section>
  </div></main>`;
  const out = root.querySelector<HTMLElement>('#out')!;

  const unbind = bindDrop(root, async f => {
    out.innerHTML = row('wait', 'Calculando huellas y buscando en el registro…');
    if (!registryDeployed()) return (out.innerHTML = row('warn', 'El registro de fotos todavía no está desplegado'));
    try {
      const h = await hashFile(f);
      const exifNote = h.exif.gps ? ' Ojo: esta copia trae GPS en su EXIF (no viene de Proof of Cam, que siempre lo quita).' : '';
      const exact = await withReadClient(c => idOfImage(c, h.sha256));
      if (exact) {
        carried = { id: exact, file: h };
        location.hash = `#/f/${exact}`;
        return;
      }
      if (isWeakVisual(h.visual)) {
        out.innerHTML = row('warn', 'Sin acta para esta copia exacta', `Esta imagen tiene muy poco detalle para buscarla por parecido. Si tienes su enlace o el QR, úsalo.${exifNote}`);
        return;
      }
      const all = await withReadClient(c => allVisualHashes(c));
      const best = all.filter(x => !isWeakVisual(x.visual)).map(x => ({ ...x, d: hamming(x.visual, h.visual) })).sort((a, b) => a.d - b.d)[0];
      if (best && best.d <= SIMILAR_MAX) {
        carried = { id: best.id, file: h };
        out.innerHTML = row(best.d <= 6 ? 'ok' : 'warn', 'Encontramos una foto sellada que se parece', `Diferencia visual ${best.d} de 64.${exifNote}`) +
          `<a class="btn primary" href="#/f/${best.id}" style="margin-top:8px">${icon('shieldCheck')}Ver su acta</a>`;
        return;
      }
      out.innerHTML = row('bad', 'Sin acta', `Esta imagen no se selló con Proof of Cam, o cambió demasiado (recorte, edición). Revisamos ${all.length} fotos selladas.${exifNote}`);
    } catch (e) {
      out.innerHTML = row('bad', 'No se pudo revisar', esc((e as Error).message));
    }
  });

  root.querySelector('#by-id')!.addEventListener('submit', ev => {
    ev.preventDefault();
    const v = root.querySelector<HTMLInputElement>('#idin')!.value.trim();
    const m = /([a-z2-7]{16})(?:\?loc=([\w-]+))?\s*$/.exec(v);
    if (!m || !isId(m[1])) return toast('No encontré un id de Proof of Cam en eso');
    location.hash = `#/f/${m[1]}${m[2] ? `?loc=${m[2]}` : ''}`;
  });

  return unbind;
}

