/**
 * Ubicación privada por defecto, revelable por niveles.
 *
 * Lo que va en el recibo público de una foto con ubicación:
 *
 * - `root`: huella de cuatro compromisos, uno por nivel (región, ciudad,
 *   barrio, punto). Cada compromiso es sha256 del prefijo del geohash de ese
 *   nivel más una sal de 32 bytes. Sin la sal no se puede adivinar el lugar,
 *   ni siquiera probando todas las ciudades del mundo.
 * - `box`: el geohash cifrado (XChaCha20-Poly1305). Solo su dueño puede
 *   abrirlo, para revelar un nivel más adelante desde cualquier teléfono.
 *
 * La llave maestra no se guarda en ningún lado: el host la deriva de la cuenta
 * del usuario para esta app (`deriveEntropy`, RFC 0007). De ella salen la llave
 * de cifrado y las sales de cada foto. Mismo usuario, misma app: misma llave.
 *
 * Revelar un nivel es entregar su prefijo y su sal (y los cuatro compromisos,
 * que por sí solos no dicen nada). El verificador recalcula ese compromiso y la
 * raíz; los otros niveles siguen ocultos. Es el principio de SD-JWT sin JWT.
 *
 * La precisión máxima que se guarda es el nivel 4 (geohash de 8 caracteres,
 * una celda de ~38×19 m): la app nunca conserva las coordenadas exactas.
 */
import { blake2b } from '@noble/hashes/blake2b';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, hexToBytes, concatBytes, utf8ToBytes } from '@noble/hashes/utils';
import { xchacha20poly1305 } from '@noble/ciphers/chacha';
import { decodeGeohash, fmtMeters, isGeohash } from './geohash.ts';

export const LEVELS = [
  { n: 1, chars: 3, label: 'Región' },
  { n: 2, chars: 4, label: 'Ciudad' },
  { n: 3, chars: 6, label: 'Barrio' },
  { n: 4, chars: 8, label: 'Punto' },
] as const;

export type Level = 1 | 2 | 3 | 4;

/** Contexto para `deriveEntropy`: 14 bytes (el host acepta hasta 32). */
export const ENTROPY_CONTEXT = 'testigo/loc/v1';
const TAG = 'testigo/loc/v1';

export interface SealedLocation {
  /** sha256 de los cuatro compromisos concatenados. */
  root: `0x${string}`;
  /** base64url(nonce de 24 bytes ‖ geohash cifrado). */
  box: string;
}

export interface LocationProof {
  v: 1;
  /** Nivel revelado. */
  i: Level;
  /** Prefijo del geohash de ese nivel. */
  g: string;
  /** Sal de ese nivel, hex. */
  s: string;
  /** Los cuatro compromisos, hex. */
  c: string[];
}

function sub(master: Uint8Array, label: string): Uint8Array {
  if (master.length !== 32) throw new Error('la llave maestra debe tener 32 bytes');
  return blake2b(utf8ToBytes(label), { key: master, dkLen: 32 });
}

export const saltFor = (master: Uint8Array, id: string, level: Level) => sub(master, `salt|${id}|${level}`);
const encKey = (master: Uint8Array, id: string) => sub(master, `enc|${id}`);

export function commitment(level: Level, prefix: string, salt: Uint8Array): Uint8Array {
  return sha256(concatBytes(utf8ToBytes(`${TAG}|${level}|${prefix}|`), salt));
}

const rootOf = (cs: Uint8Array[]) => `0x${bytesToHex(sha256(concatBytes(...cs)))}` as const;

/**
 * Nivel más fino que la precisión del GPS permite afirmar sin exagerar. Un
 * teléfono que dice ±500 m no puede prometer el punto exacto.
 */
export function maxLevelFor(accuracyM: number): Level {
  if (accuracyM <= 100) return 4;
  if (accuracyM <= 2000) return 3;
  if (accuracyM <= 30_000) return 2;
  return 1;
}

interface Secret {
  /** Geohash de 8 caracteres. */
  g: string;
  /** Nivel más fino revelable. */
  m: Level;
}

/**
 * Los cuatro compromisos. Los niveles más finos que `maxLevel` se llenan con
 * un valor derivado de la llave maestra: para cualquier otro es indistinguible
 * de un compromiso real, nunca se puede revelar como lugar, y su dueño lo
 * puede recalcular para armar pruebas de los otros niveles.
 */
function commitmentsFor(master: Uint8Array, id: string, geohash8: string, maxLevel: Level): Uint8Array[] {
  return LEVELS.map(l =>
    l.n <= maxLevel ? commitment(l.n, geohash8.slice(0, l.chars), saltFor(master, id, l.n)) : sub(master, `pad|${id}|${l.n}`),
  );
}

/** Sella una ubicación: solo compromisos y el geohash cifrado; nada legible. */
export function sealLocation(master: Uint8Array, id: string, geohash8: string, maxLevel: Level): SealedLocation {
  if (!isGeohash(geohash8) || geohash8.length !== 8) throw new Error('se esperaba un geohash de 8 caracteres');
  const cs = commitmentsFor(master, id, geohash8, maxLevel);
  const nonce = crypto.getRandomValues(new Uint8Array(24));
  const secret: Secret = { g: geohash8, m: maxLevel };
  const ct = xchacha20poly1305(encKey(master, id), nonce).encrypt(utf8ToBytes(JSON.stringify(secret)));
  return { root: rootOf(cs), box: b64url(concatBytes(nonce, ct)) };
}

/** Abre la ubicación de una foto propia. `null` si la llave no es la de su dueño. */
export function openLocation(master: Uint8Array, id: string, sealed: SealedLocation): Secret | null {
  try {
    const raw = unb64url(sealed.box);
    const pt = xchacha20poly1305(encKey(master, id), raw.slice(0, 24)).decrypt(raw.slice(24));
    const s = JSON.parse(new TextDecoder().decode(pt)) as Secret;
    if (!isGeohash(s.g) || s.g.length !== 8 || ![1, 2, 3, 4].includes(s.m)) return null;
    return s;
  } catch {
    return null;
  }
}

/** Prueba de un nivel, armada por el dueño de la foto. */
export function makeProof(master: Uint8Array, id: string, sealed: SealedLocation, level: Level): LocationProof {
  const secret = openLocation(master, id, sealed);
  if (!secret) throw new Error('esta ubicación no se abre con tu llave');
  if (level > secret.m) throw new Error('la precisión del GPS no alcanzó para ese nivel');
  const cs = commitmentsFor(master, id, secret.g, secret.m);
  if (rootOf(cs) !== sealed.root) throw new Error('los compromisos no dan la raíz sellada');
  return {
    v: 1,
    i: level,
    g: secret.g.slice(0, LEVELS[level - 1].chars),
    s: bytesToHex(saltFor(master, id, level)),
    c: cs.map(c => bytesToHex(c)),
  };
}

export type ProofCheck =
  | { ok: true; level: Level; label: string; prefix: string; cell: ReturnType<typeof decodeGeohash>; size: string }
  | { ok: false; reason: string };

export function verifyProof(p: LocationProof, root: string): ProofCheck {
  if (!p || p.v !== 1 || ![1, 2, 3, 4].includes(p.i)) return { ok: false, reason: 'prueba con otro formato' };
  const lvl = LEVELS[p.i - 1];
  if (typeof p.g !== 'string' || !isGeohash(p.g) || p.g.length !== lvl.chars) return { ok: false, reason: 'el prefijo no corresponde al nivel' };
  if (!Array.isArray(p.c) || p.c.length !== 4 || !p.c.every(c => /^[0-9a-f]{64}$/.test(c))) return { ok: false, reason: 'faltan compromisos' };
  if (!/^[0-9a-f]{64}$/.test(p.s)) return { ok: false, reason: 'sal inválida' };
  if (bytesToHex(commitment(p.i, p.g, hexToBytes(p.s))) !== p.c[p.i - 1]) return { ok: false, reason: 'el lugar no coincide con lo sellado' };
  if (rootOf(p.c.map(hexToBytes)) !== root.toLowerCase()) return { ok: false, reason: 'la prueba es de otra foto' };
  const cell = decodeGeohash(p.g);
  return { ok: true, level: p.i, label: lvl.label, prefix: p.g, cell, size: fmtMeters(cell.sizeM) };
}

export const encodeProof = (p: LocationProof) => b64url(utf8ToBytes(JSON.stringify(p)));

export function decodeProof(s: string): LocationProof | null {
  try {
    return JSON.parse(new TextDecoder().decode(unb64url(s))) as LocationProof;
  } catch {
    return null;
  }
}

export function b64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function unb64url(s: string): Uint8Array {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
  return Uint8Array.from(b, c => c.charCodeAt(0));
}
