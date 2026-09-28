/**
 * Diagnóstico: mide en ESTE teléfono cada pieza que Proof of Cam necesita y deja un
 * reporte copiable. Nada de lo que mide se guarda ni se envía; el reporte solo
 * sale si tú lo copias. No muestra coordenadas: de la ubicación solo dice si
 * llegó y con qué precisión.
 */
import { deriveEntropy, isInsideContainerSync } from '@parity/product-sdk-host';
import { Binary } from 'polkadot-api';
import { utf8ToBytes, bytesToHex } from '@noble/hashes/utils';
import { icon } from '../lib/icons';
import { waitForHost, withTimeout, TIMED_OUT, describeError, HOST_QUERY_MS, HOST_SUBMIT_MS } from '../lib/host';
import { subscribeFinalized, chainSource, getClient, withReadClient } from '../lib/chain';
import { openCamera, grabFrame } from '../lib/camera';
import { exifSummary } from '../lib/photo';
import { currentPosition } from '../lib/geo';
import { ENTROPY_CONTEXT, LEVELS, maxLevelFor } from '../lib/loc.ts';
import { verifyReceiptSig } from '../lib/receipt.ts';
import { connectWallet, authorFor, hasIdentity, connectedUsername, identityUnavailableReason, signBytes, txSignerFor, addressFor } from '../lib/signer';
import { askChainSubmit } from '../lib/permissions';
import { registryDeployed, totalPhotos, freeBalance, isMapped, simulateSeal, pas } from '../lib/registry';
import { canShareFiles, sharePhoto, downloadPhoto } from '../lib/save';
import { newId } from '../lib/ids.ts';
import { esc, topbar, tag, toast, shortAddr, type Tone, type Cleanup } from '../ui';

type Status = 'yes' | 'no' | 'skip' | 'run';
interface Line { name: string; status: Status; detail: string; ms?: number }
const TONE: Record<Status, Tone> = { yes: 'ok', no: 'bad', skip: 'warn', run: 'wait' };

const sdkLine = () => `product-sdk-host ${__SDK__.host} · signer ${__SDK__.signer} · truapi ${__SDK__.truapi} (protocolo ${__SDK__.codec})`;

/** Imagen de prueba (un degradado con texto), en JPEG. */
async function testJpeg(): Promise<Blob> {
  const c = document.createElement('canvas');
  c.width = 480;
  c.height = 320;
  const ctx = c.getContext('2d')!;
  const g = ctx.createLinearGradient(0, 0, 480, 320);
  g.addColorStop(0, '#d6402a');
  g.addColorStop(1, '#141414');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 480, 320);
  ctx.fillStyle = '#fff';
  ctx.font = '700 36px monospace';
  ctx.fillText('proof of cam · prueba', 40, 170);
  return new Promise((res, rej) => c.toBlob(b => (b ? res(b) : rej(new Error('sin JPEG'))), 'image/jpeg', 0.9));
}

export function renderDiagnostics(root: HTMLElement): Cleanup {
  const lines: Line[] = [];
  let dead = false;
  const inside = isInsideContainerSync();
  let testUrl = '';

  root.innerHTML = `${topbar()}<main class="page"><div class="shell">
    <section class="card">
      <h1 style="font-size:36px">Diagnóstico</h1>
      <p class="muted" style="margin:8px 0 16px">Mide en este teléfono cada pieza que necesita Proof of Cam. Pide cámara, ubicación y dos firmas; no envía ninguna transacción ni gasta nada.</p>
      <div class="actions"><button class="btn accent" id="run">${icon('lightning')}Probar todo</button><button class="btn" id="copy" disabled>${icon('copy')}Copiar reporte</button></div>
    </section>
    <p class="faint" style="font-size:13px">El reporte solo sale si lo copias. Lleva la versión de tu navegador y el resultado de cada prueba; no lleva ubicación, fotos ni direcciones completas.</p>
    <section class="card"><div id="out">${`<div class="chk">${tag('idle')}<div><b>Sin ejecutar</b><p>Pulsa Probar todo.</p></div></div>`}</div></section>
    <section class="card">
      <h3>Guardar la foto en el teléfono</h3>
      <p class="muted" style="font-size:14px;margin-bottom:12px">Estas pruebas necesitan que las toques tú. Anota cuál funcionó: el resultado entra al reporte.</p>
      <div class="actions">
        <button class="btn sm" id="t-share">${icon('shareNetwork')}Compartir</button>
        <button class="btn sm" id="t-dl">${icon('downloadSimple')}Descargar</button>
        <label class="btn sm">${icon('image')}Selector de archivos<input type="file" accept="image/*" id="t-file" hidden></label>
      </div>
      <p class="faint" style="font-size:13px;margin:12px 0 8px">Mantén presionada esta imagen: ¿aparece "Guardar imagen"?</p>
      <img id="t-img" alt="Imagen de prueba" style="width:200px;border-radius:10px;border:1px solid var(--line)">
      <div class="actions" style="margin-top:8px"><button class="btn sm" data-lp="yes">Sí apareció</button><button class="btn sm" data-lp="no">No apareció</button></div>
    </section>
  </div></main>`;

  const out = root.querySelector<HTMLElement>('#out')!;
  const copy = root.querySelector<HTMLButtonElement>('#copy')!;
  const draw = () => {
    out.innerHTML = lines.map(l => `<div class="chk">${tag(TONE[l.status])}<div><b>${esc(l.name)}${l.ms !== undefined ? ` <span class="faint mono" style="font-weight:400">${l.ms} ms</span>` : ''}</b><p>${esc(l.detail)}</p></div></div>`).join('');
  };
  const record = (name: string, status: Status, detail: string) => {
    const old = lines.find(l => l.name === name);
    if (old) Object.assign(old, { status, detail });
    else lines.push({ name, status, detail });
    draw();
    copy.disabled = false;
  };
  const step = async (name: string, fn: () => Promise<[Status, string]>) => {
    if (dead) return;
    const l: Line = { name, status: 'run', detail: '…' };
    lines.push(l);
    draw();
    const t0 = performance.now();
    try {
      const [status, detail] = await fn();
      Object.assign(l, { status, detail, ms: Math.round(performance.now() - t0) });
    } catch (e) {
      Object.assign(l, { status: 'no', detail: describeError(e instanceof Error ? e.message : e), ms: Math.round(performance.now() - t0) });
    }
    draw();
  };

  testJpeg().then(b => { testUrl = URL.createObjectURL(b); const img = root.querySelector<HTMLImageElement>('#t-img'); if (img) img.src = testUrl; });

  async function runAll() {
    const btn = root.querySelector<HTMLButtonElement>('#run')!;
    btn.disabled = true;
    lines.length = 0;
    try {
      await step('Contenedor', async () => [inside ? 'yes' : 'skip', inside ? 'dentro de Polkadot App / Desktop' : 'navegador normal: modo ensayo']);
      if (inside) await step('Canal con el host', async () => ((await waitForHost()) ? ['yes', `connected · ${sdkLine()}`] : ['no', `no llegó a connected en 12 s · ${sdkLine()} (¿otro protocolo?)`]));
      await step('Capacidades', async () => {
        const f = (ok: boolean, name: string) => `${ok ? '✓' : '✗'} ${name}`;
        const w = globalThis as unknown as { ImageCapture?: unknown; Worker?: unknown };
        return ['yes', [
          f(isSecureContext, 'contexto seguro'), f(!!navigator.mediaDevices?.getUserMedia, 'getUserMedia'),
          f(typeof w.ImageCapture === 'function', 'ImageCapture'), f(canShareFiles(), 'compartir archivos'),
          f(!!navigator.geolocation, 'geolocalización'), f(typeof w.Worker === 'function', 'Web Workers'),
          f(!!crypto.subtle, 'WebCrypto'),
        ].join(' · ')];
      });
      await step('Asset Hub', () => new Promise(resolve => {
        let stop: (() => void) | undefined;
        const timer = setTimeout(() => { stop?.(); resolve(['no', 'sin bloques en 30 s']); }, 30_000);
        subscribeFinalized(b => {
          clearTimeout(timer);
          stop?.();
          const s = chainSource();
          resolve(['yes', `bloque #${b.number.toLocaleString('en-US')} · por ${s.source === 'host' ? 'el host' : `RPC público${s.hostProblem ? ` (${s.hostProblem})` : ''}`}`]);
        }, e => { clearTimeout(timer); resolve(['no', describeError(e)]); }).then(s => { stop = s; });
      }));
      await step('Registro de fotos', async () => {
        if (!registryDeployed()) return ['skip', 'todavía no desplegado'];
        return ['yes', `${await withReadClient(c => totalPhotos(c))} fotos selladas`];
      });

      await step('Cámara', async () => {
        const cam = await openCamera('environment');
        const video = document.createElement('video');
        video.muted = true;
        video.playsInline = true;
        video.srcObject = cam.stream;
        await video.play().catch(() => undefined);
        await new Promise(r => setTimeout(r, 900));
        try {
          const frame = await grabFrame(cam, video);
          const res = `${frame.width}×${frame.height}`;
          const blob = await new Promise<Blob | null>(r => frame.toBlob(r, 'image/jpeg', 0.92));
          frame.width = frame.height = 0;
          const ex = blob ? exifSummary(new Uint8Array(await blob.arrayBuffer())) : null;
          return ['yes', `cámara ${cam.info.facing === 'back' ? 'trasera' : cam.info.facing} · visor ${cam.info.width}×${cam.info.height} · foto ${res}${cam.info.imageCapture ? ' (takePhoto)' : ''} · ${ex && !ex.exif ? 'sale sin EXIF' : 'TRAE EXIF'}`];
        } finally {
          cam.stop();
        }
      });

      await step('Llave derivada (deriveEntropy)', async () => {
        if (!inside) return ['skip', 'solo dentro de Polkadot App'];
        const a = await withTimeout(deriveEntropy(utf8ToBytes(`${ENTROPY_CONTEXT}/diag`)), HOST_QUERY_MS);
        const b = await withTimeout(deriveEntropy(utf8ToBytes(`${ENTROPY_CONTEXT}/diag`)), HOST_QUERY_MS);
        if (a === TIMED_OUT || b === TIMED_OUT) return ['no', 'el host no respondió'];
        if (!a.ok || !b.ok) return ['no', describeError(!a.ok ? a.error : (b as { error: unknown }).error)];
        const same = bytesToHex(a.value) === bytesToHex(b.value);
        return [same && a.value.length === 32 ? 'yes' : 'no', `${a.value.length} bytes · ${same ? 'estable' : 'CAMBIA entre llamadas'} (el valor no se muestra)`];
      });

      await step('Ubicación', async () => {
        const p = await currentPosition(20_000);
        const max = maxLevelFor(p.accuracy);
        return ['yes', `llegó con precisión ±${Math.round(p.accuracy)} m → se podría revelar hasta "${LEVELS[max - 1].label}" (coordenadas no mostradas)`];
      });

      await step('Wallet', async () => {
        await connectWallet();
        const u = connectedUsername();
        return ['yes', `${u ?? 'sin username'} · identidad: ${hasIdentity() ? 'sí' : `no (${identityUnavailableReason() ?? '?'})`}`];
      });

      const kinds: ('identity' | 'app')[] = inside ? (hasIdentity() ? ['identity', 'app'] : ['app']) : [];
      const label = (k: 'identity' | 'app') => (k === 'identity' ? 'identidad' : 'seudónimo');
      for (const k of kinds) {
        await step(`Firma de un recibo (${label(k)})`, async () => {
          const a = authorFor(k);
          const msg = utf8ToBytes(`proofofcam diagnóstico ${newId()}`);
          const sig = await signBytes(msg, a.kind);
          const ok = await verifyReceiptSig(msg, sig, a.pubkey);
          return [ok ? 'yes' : 'no', ok ? `firma válida de ${shortAddr(a.address)}` : 'la firma no verifica'];
        });
      }
      if (!inside) {
        await step('Firma', async () => {
          const a = authorFor('app');
          const msg = utf8ToBytes('proofofcam ensayo');
          const ok = await verifyReceiptSig(msg, await signBytes(msg, a.kind), a.pubkey);
          return [ok ? 'yes' : 'no', 'cuenta de ensayo (en Polkadot App firma la tuya)'];
        });
      }

      for (const k of kinds) {
        const addr = addressFor(k);
        if (!addr) continue;
        await step(`Saldo y registro (${label(k)})`, async () => {
          const [b, m] = await Promise.all([withReadClient(c => freeBalance(c, addr)), withReadClient(c => isMapped(c, addr))]);
          return [b > 10n ** 9n ? 'yes' : 'skip', `${pas(b)} · ${m ? 'registrada en pallet-revive' : 'sin registrar: la primera vez pedirá una firma extra'} · ${shortAddr(addr)}`];
        });
      }

      if (inside && registryDeployed() && kinds.length) {
        const k = kinds[0];
        await step(`Simulación del sello (${label(k)})`, async () => {
          const a = authorFor(k);
          const mapped = await withReadClient(c => isMapped(c, a.address));
          const r = await withReadClient(c => simulateSeal(c, mapped ? a.address : '5DfhGyQdFobKM8NsWvEeAKk5EQQgYe9AydgJ7rMB6E1EqRzV', {
            id: newId(), imageHash: `0x${bytesToHex(crypto.getRandomValues(new Uint8Array(32)))}`, visualHash: 1n,
            pubkey: a.pubkey as `0x${string}`, anchorBlock: 1, sig: `0x${'00'.repeat(64)}`, receipt: `0x${'7b'.repeat(640)}`,
          }));
          return r.ok ? ['yes', `pasaría · depósito ${pas(r.deposit)} · peso ${(Number(r.weight.ref_time) / 1e9).toFixed(1)} G`] : ['no', r.why];
        });
        await step(`El host firma una transacción (${label(k)}, no se envía)`, async () => {
          await askChainSubmit();
          const signer = txSignerFor(k);
          if (!signer) return ['no', 'sin firmante de transacciones'];
          const tx = (await getClient()).getUnsafeApi().tx.System.remark({ remark: Binary.fromText('proofofcam diagnóstico') });
          const signed = await withTimeout(tx.sign(signer), HOST_SUBMIT_MS);
          if (signed === TIMED_OUT) return ['no', 'la firma no llegó a tiempo'];
          const o = signed as unknown as string | Uint8Array;
          return ['yes', `firmó ${typeof o === 'string' ? (o.length - 2) / 2 : o.length} bytes; no se envió, no costó nada`];
        });
      }
    } finally {
      btn.disabled = false;
      copy.disabled = false;
    }
  }

  root.querySelector('#run')!.addEventListener('click', runAll);
  root.querySelector('#t-share')!.addEventListener('click', async () => {
    const r = await sharePhoto(await testJpeg(), 'diagnostico');
    record('Guardar: compartir', r === 'shared' ? 'yes' : r === 'cancelled' ? 'skip' : 'no', { shared: 'se abrió la hoja y se compartió', cancelled: 'se abrió la hoja y se canceló', unsupported: 'este contenedor no comparte archivos', downloaded: '' }[r]);
  });
  root.querySelector('#t-dl')!.addEventListener('click', async () => {
    downloadPhoto(await testJpeg(), 'diagnostico');
    record('Guardar: descargar', 'run', 'se pidió la descarga: ¿llegó el archivo? (anótalo al compartir el reporte)');
  });
  root.querySelector('#t-file')!.addEventListener('change', async ev => {
    const f = (ev.target as HTMLInputElement).files?.[0];
    if (!f) return record('Selector de archivos', 'no', 'no devolvió ningún archivo');
    const ex = exifSummary(new Uint8Array(await f.arrayBuffer()));
    record('Selector de archivos', 'yes', `abrió y devolvió ${f.type || 'un archivo'} de ${Math.round(f.size / 1024)} KB · EXIF: ${ex.exif ? 'sí' : 'no'} · GPS en EXIF: ${ex.gps ? 'SÍ' : 'no'} (no se leen los valores)`);
  });
  root.querySelectorAll<HTMLButtonElement>('[data-lp]').forEach(b => b.addEventListener('click', () => {
    record('Guardar: mantener presionada', b.dataset.lp === 'yes' ? 'yes' : 'no', b.dataset.lp === 'yes' ? 'aparece "Guardar imagen"' : 'no aparece menú');
  }));
  copy.addEventListener('click', () => {
    const txt = [`proofofcam diagnóstico ${new Date().toISOString()}`, navigator.userAgent, sdkLine(), '']
      .concat(lines.map(l => `[${l.status.toUpperCase().padEnd(4)}] ${l.name}${l.ms !== undefined ? ` (${l.ms} ms)` : ''}: ${l.detail}`))
      .join('\n');
    navigator.clipboard?.writeText(txt).then(() => toast('Reporte copiado'), () => toast('No se pudo copiar'));
  });

  return () => {
    dead = true;
    if (testUrl) URL.revokeObjectURL(testUrl);
  };
}
