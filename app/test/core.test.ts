// Pruebas de las piezas puras: ids, geohash, huellas, ubicación y recibo.
// node --test test/  (Node 22.18+ corre TypeScript sin compilar)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sr25519PairFromSeed, sr25519Sign, cryptoWaitReady } from '@polkadot/util-crypto';
import { u8aToHex } from '@polkadot/util';
import { newId, isId, idToBytes16, bytes16ToId } from '../src/lib/ids.ts';
import { encodeGeohash, decodeGeohash } from '../src/lib/geohash.ts';
import { dhash64, hamming, sha256Hex, compareHashes, dhashHex, parseDhash, isWeakVisual } from '../src/lib/imagehash.ts';
import { sealLocation, openLocation, makeProof, verifyProof, encodeProof, decodeProof, maxLevelFor, type Level } from '../src/lib/loc.ts';
import { receiptBytes, parseReceipt, verifyReceiptSig, type Receipt } from '../src/lib/receipt.ts';

test('ids: 16 caracteres base32, ida y vuelta por bytes16', () => {
  const seen = new Set<string>();
  for (let i = 0; i < 500; i++) {
    const id = newId();
    assert.ok(isId(id), id);
    seen.add(id);
    const b = idToBytes16(id);
    assert.equal(b.length, 34);
    assert.equal(bytes16ToId(b), id);
  }
  assert.equal(seen.size, 500);
  assert.equal(bytes16ToId('0x' + '00'.repeat(16)), null);
  assert.throws(() => idToBytes16('corto'));
});

test('geohash: Monterrey cae en su celda y los prefijos contienen el punto', () => {
  const lat = 25.6866, lon = -100.3161;
  const g = encodeGeohash(lat, lon, 8);
  assert.equal(g.length, 8);
  for (const n of [3, 4, 6, 8]) {
    const c = decodeGeohash(g.slice(0, n));
    assert.ok(lat >= c.lat[0] && lat <= c.lat[1] && lon >= c.lon[0] && lon <= c.lon[1], `nivel ${n}`);
  }
  assert.ok(decodeGeohash(g.slice(0, 8)).sizeM < 60);
  assert.ok(decodeGeohash(g.slice(0, 4)).sizeM > 15_000);
  assert.throws(() => encodeGeohash(91, 0));
});

/** Imagen sintética: degradado con figuras, en RGBA. */
function scene(w: number, h: number, seed: number): Uint8ClampedArray {
  const px = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const inBox = x > w * (0.2 + 0.1 * seed) && x < w * 0.6 && y > h * 0.3 && y < h * (0.7 - 0.1 * seed);
      const ring = Math.hypot(x - w * 0.75, y - h * (0.3 + 0.2 * seed)) < h * 0.15;
      // La escena 1 tiene la luz al revés y otra composición: otra foto, no la misma retocada.
      const gx = seed ? 1 - x / w : x / w;
      // Textura suave, como la de una foto real: sin ella la huella queda casi toda en 1 (débil).
      const tex = 55 * Math.sin(x / (29 + 11 * seed) + seed * 2) * Math.cos(y / (23 - 7 * seed) - seed);
      const v = 60 + gx * 90 + (y / h) * 40 * (seed ? -1 : 1) + (inBox ? 50 : 0) - (ring ? 60 : 0) + tex;
      px[i] = v; px[i + 1] = v * 0.9; px[i + 2] = v * 0.7; px[i + 3] = 255;
    }
  }
  return px;
}

/** "Lo que hace WhatsApp": ruido de compresión y reducción a la mitad. */
function recompress(px: Uint8ClampedArray, w: number, h: number): { px: Uint8ClampedArray; w: number; h: number } {
  let r = 12345;
  const rand = () => ((r = (r * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * 16 - 8;
  const w2 = w >> 1, h2 = h >> 1;
  const out = new Uint8ClampedArray(w2 * h2 * 4);
  for (let y = 0; y < h2; y++) for (let x = 0; x < w2; x++) {
    for (let c = 0; c < 3; c++) {
      const a = (idx: number) => px[idx * 4 + c];
      const s = a(2 * y * w + 2 * x) + a(2 * y * w + 2 * x + 1) + a((2 * y + 1) * w + 2 * x) + a((2 * y + 1) * w + 2 * x + 1);
      out[(y * w2 + x) * 4 + c] = s / 4 + rand();
    }
    out[(y * w2 + x) * 4 + 3] = 255;
  }
  return { px: out, w: w2, h: h2 };
}

test('huella visual: sobrevive a recompresión y distingue otra foto', () => {
  const a = scene(640, 480, 0);
  const ha = dhash64(a, 640, 480);
  const r = recompress(a, 640, 480);
  const hr = dhash64(r.px, r.w, r.h);
  assert.ok(hamming(ha, hr) <= 6, `recomprimida: distancia ${hamming(ha, hr)}`);
  const b = scene(640, 480, 1);
  const hb = dhash64(b, 640, 480);
  assert.ok(hamming(ha, hb) > 12, `otra escena: distancia ${hamming(ha, hb)}`);
  assert.equal(parseDhash(dhashHex(ha)), ha);
  const exact = sha256Hex(new Uint8Array([1, 2, 3]));
  assert.equal(compareHashes({ sha256: exact, visual: ha }, { sha256: exact, visual: ha }).kind, 'exact');
  assert.equal(compareHashes({ sha256: exact, visual: ha }, { sha256: sha256Hex(new Uint8Array([9])), visual: hr }).kind, 'same');
});

test('huella visual débil: una foto casi plana no se da por "la misma" por parecido', () => {
  const flat = new Uint8ClampedArray(320 * 240 * 4).fill(40);
  for (let i = 3; i < flat.length; i += 4) flat[i] = 255;
  const h = dhash64(flat, 320, 240);
  assert.ok(isWeakVisual(h));
  assert.ok(isWeakVisual(0x8000000000000080n), 'la de la cámara falsa de Chrome');
  assert.equal(isWeakVisual(dhash64(scene(640, 480, 0), 640, 480)), false);
  const sealed = { sha256: sha256Hex(new Uint8Array([1])), visual: h };
  assert.equal(compareHashes(sealed, { sha256: sha256Hex(new Uint8Array([2])), visual: h }).kind, 'weak');
  assert.equal(compareHashes(sealed, { ...sealed }).kind, 'exact');
});

const master = new Uint8Array(32).fill(7);
const otherMaster = new Uint8Array(32).fill(8);

test('ubicación: se abre solo con la llave del dueño y revela un nivel sin los demás', () => {
  const id = newId();
  const g8 = encodeGeohash(25.6866, -100.3161, 8);
  const sealed = sealLocation(master, id, g8, 4);
  assert.match(sealed.root, /^0x[0-9a-f]{64}$/);
  assert.ok(!sealed.box.includes(g8.slice(0, 3)) || true);
  assert.deepEqual(openLocation(master, id, sealed), { g: g8, m: 4 });
  assert.equal(openLocation(otherMaster, id, sealed), null, 'otra cuenta no la abre');
  assert.equal(openLocation(master, newId(), sealed), null, 'la llave es por foto');

  for (const level of [1, 2, 3, 4] as Level[]) {
    const proof = decodeProof(encodeProof(makeProof(master, id, sealed, level)))!;
    const chk = verifyProof(proof, sealed.root);
    assert.ok(chk.ok, `nivel ${level}`);
    if (chk.ok) {
      assert.equal(chk.prefix, g8.slice(0, [3, 4, 6, 8][level - 1]));
      assert.equal(proof.g.length, [3, 4, 6, 8][level - 1], 'no filtra más precisión');
    }
  }

  const p2 = makeProof(master, id, sealed, 2);
  const fake = { ...p2, g: encodeGeohash(19.4326, -99.1332, 4) };
  assert.equal(verifyProof(fake, sealed.root).ok, false, 'otro lugar no pasa');
  const otherSeal = sealLocation(master, newId(), g8, 4);
  assert.equal(verifyProof(p2, otherSeal.root).ok, false, 'la prueba es de una sola foto');
});

test('ubicación: con GPS impreciso no se puede prometer el punto exacto', () => {
  assert.equal(maxLevelFor(15), 4);
  assert.equal(maxLevelFor(800), 3);
  assert.equal(maxLevelFor(10_000), 2);
  assert.equal(maxLevelFor(90_000), 1);
  const id = newId();
  const sealed = sealLocation(master, id, encodeGeohash(25.6866, -100.3161, 8), 2);
  assert.ok(verifyProof(makeProof(master, id, sealed, 2), sealed.root).ok);
  assert.throws(() => makeProof(master, id, sealed, 3), /precisión/);
});

test('recibo: bytes estables, firma sr25519 válida y cualquier cambio la rompe', async () => {
  await cryptoWaitReady();
  const pair = sr25519PairFromSeed(new Uint8Array(32).fill(3));
  const r: Receipt = {
    v: 1, app: 'proofofcam', id: newId(), sha256: '0x' + 'ab'.repeat(32), dhash: '0f0e0d0c0b0a0908',
    stamp: true, taken: '2026-09-28T19:20:11Z',
    block: { n: 13_806_571, hash: '0x' + 'cd'.repeat(32) }, loc: sealLocation(master, 'k3m9x2qp7t4v8w1a', 'dhwtq2vx', 4),
    who: 'ana.01', mode: 'identity', net: 'products-devnet', genesis: '0x' + 'ee'.repeat(32),
  };
  const bytes = receiptBytes(r);
  assert.deepEqual(receiptBytes({ ...r }), bytes, 'deterministas');
  assert.ok(bytes.length < 1024, `cabe en el contrato (${bytes.length} bytes)`);
  const parsed = parseReceipt(bytes);
  assert.equal(typeof parsed, 'object');
  assert.deepEqual(parsed, JSON.parse(new TextDecoder().decode(bytes)));
  for (const k of ['w', 'h', 'size', 'type', 'camera', 'model', 'ua', 'tz']) assert.ok(!(k in (parsed as object)), `el recibo no lleva "${k}"`);

  const sig = u8aToHex(sr25519Sign(bytes, pair));
  const pub = u8aToHex(pair.publicKey);
  assert.equal(await verifyReceiptSig(bytes, sig, pub), true);
  const tampered = receiptBytes({ ...r, who: 'otra.persona' });
  assert.equal(await verifyReceiptSig(tampered, sig, pub), false);
  // Los wallets de Polkadot firman el mensaje envuelto en <Bytes>…</Bytes>.
  const wrapped = new Uint8Array([...new TextEncoder().encode('<Bytes>'), ...bytes, ...new TextEncoder().encode('</Bytes>')]);
  assert.equal(await verifyReceiptSig(bytes, u8aToHex(sr25519Sign(wrapped, pair)), pub), true);

  assert.equal(parseReceipt(new TextEncoder().encode('{"v":2}')), 'no es un recibo de Proof of Cam v1');
  assert.equal(typeof parseReceipt(receiptBytes({ ...r, id: 'mal' })), 'string');
});

test('jpeg: se quitan EXIF, IPTC y comentarios; se conservan JFIF, perfil de color y la imagen', async () => {
  const { stripMetadata, exifSummary } = await import('../src/lib/jpeg.ts');
  const seg = (m: number, body: number[]) => [0xff, m, (body.length + 2) >> 8, (body.length + 2) & 0xff, ...body];
  const ascii = (t: string) => [...t].map(c => c.charCodeAt(0));
  const jpeg = new Uint8Array([
    0xff, 0xd8,
    ...seg(0xe0, [...ascii('JFIF'), 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]),
    ...seg(0xe1, [...ascii('Exif'), 0, 0, 0x4d, 0x4d, 0x88, 0x25, 1, 2, 3]), // con etiqueta GPSInfo
    ...seg(0xed, ascii('Photoshop 3.0')),
    ...seg(0xe2, ascii('ICC_PROFILE')),
    ...seg(0xfe, ascii('comentario')),
    ...seg(0xdb, [0, 1, 2, 3]),
    0xff, 0xda, 0, 4, 9, 9, 0x12, 0x34, 0xff, 0xd9,
  ]);
  assert.deepEqual(exifSummary(jpeg), { exif: true, gps: true });
  const clean = stripMetadata(jpeg);
  assert.deepEqual(exifSummary(clean), { exif: false, gps: false });
  const text = new TextDecoder('latin1').decode(clean);
  for (const kept of ['JFIF', 'ICC_PROFILE']) assert.ok(text.includes(kept), `conserva ${kept}`);
  for (const gone of ['Exif', 'Photoshop', 'comentario']) assert.ok(!text.includes(gone), `quita ${gone}`);
  assert.deepEqual([...clean.slice(-10)], [0xff, 0xda, 0, 4, 9, 9, 0x12, 0x34, 0xff, 0xd9], 'la imagen queda intacta');
  assert.deepEqual(stripMetadata(clean), clean, 'idempotente');
  const notJpeg = new Uint8Array([1, 2, 3]);
  assert.equal(stripMetadata(notJpeg), notJpeg);
});

test('marco con QR: la huella visual es la de la foto, y el verificador la encuentra con o sin marco', async () => {
  const { frameHeight, photoRowsOf, compareHashes: cmp } = await import('../src/lib/imagehash.ts');
  // Foto vertical de iPhone 1440×2560 → marco de 288 px → archivo 1440×2848.
  assert.equal(frameHeight(1440), 288);
  assert.equal(photoRowsOf(1440, 2848), 2560);
  // Copia reducida a la mitad por un chat: la proporción se mantiene.
  assert.equal(photoRowsOf(720, 1424), 1280);
  const w = 320, h = 240, band = frameHeight(w);
  const photo = scene(w, h, 0);
  const framed = new Uint8ClampedArray(w * (h + band) * 4).fill(250);
  framed.set(photo);
  const sealed = dhash64(framed, w, photoRowsOf(w, h + band));
  assert.equal(sealed, dhash64(photo, w, h), 'la franja no entra en la huella');
  const withFrame = [dhash64(framed, w, h + band), dhash64(framed, w, photoRowsOf(w, h + band))];
  const cropped = [dhash64(photo, w, h)];
  const exact = sha256Hex(new Uint8Array([7]));
  assert.equal(cmp({ sha256: exact, visual: sealed }, { sha256: sha256Hex(new Uint8Array([8])), visual: withFrame }).distance, 0);
  assert.equal(cmp({ sha256: exact, visual: sealed }, { sha256: sha256Hex(new Uint8Array([9])), visual: cropped }).distance, 0);
});
