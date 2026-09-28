/**
 * Las dos huellas de una foto.
 *
 * - **Exacta** (sha256 de los bytes del archivo): cambia si cambia un solo
 *   byte. Prueba que una copia es idéntica a la sellada.
 * - **Visual** (dHash de 64 bits): resume la foto en una cuadrícula de 9×8
 *   tonos de gris y guarda si cada celda es más clara que la de su derecha.
 *   Sobrevive a que WhatsApp la recomprima o le cambie el tamaño; no prueba
 *   igualdad, solo parecido.
 *
 * La cuadrícula se calcula promediando píxeles aquí, no con el reescalado del
 * navegador: así el teléfono que sella y el navegador que verifica llegan a la
 * misma huella aunque sean motores distintos.
 */
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';

export function sha256Hex(bytes: Uint8Array): `0x${string}` {
  return `0x${bytesToHex(sha256(bytes))}`;
}

const COLS = 9;
const ROWS = 8;

/** dHash de 64 bits a partir de píxeles RGBA. */
export function dhash64(rgba: Uint8ClampedArray | Uint8Array, width: number, height: number): bigint {
  if (width < COLS || height < ROWS) throw new Error('imagen demasiado pequeña');
  const sum = new Float64Array(COLS * ROWS);
  const count = new Float64Array(COLS * ROWS);
  const colOf = new Uint8Array(width);
  for (let x = 0; x < width; x++) colOf[x] = Math.min(COLS - 1, Math.floor((x * COLS) / width));
  for (let y = 0; y < height; y++) {
    const row = Math.min(ROWS - 1, Math.floor((y * ROWS) / height)) * COLS;
    let i = y * width * 4;
    for (let x = 0; x < width; x++, i += 4) {
      const cell = row + colOf[x];
      sum[cell] += rgba[i] * 299 + rgba[i + 1] * 587 + rgba[i + 2] * 114;
      count[cell]++;
    }
  }
  let h = 0n;
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS - 1; c++) {
      const a = sum[r * COLS + c] / count[r * COLS + c];
      const b = sum[r * COLS + c + 1] / count[r * COLS + c + 1];
      h = (h << 1n) | (a > b ? 1n : 0n);
    }
  }
  return h;
}

export const dhashHex = (h: bigint): string => h.toString(16).padStart(16, '0');

export function parseDhash(hex: string): bigint | null {
  return /^[0-9a-f]{16}$/.test(hex) ? BigInt(`0x${hex}`) : null;
}

export function hamming(a: bigint, b: bigint): number {
  let x = a ^ b;
  let n = 0;
  while (x) {
    n += Number(x & 1n);
    x >>= 1n;
  }
  return n;
}

export type MatchKind = 'exact' | 'same' | 'similar' | 'different' | 'weak';

/**
 * Umbrales de parecido. Recomprimir o reescalar mueve unos pocos bits (0 a 6);
 * dos fotos distintas difieren en ~32 de 64 al azar.
 */
export const SAME_MAX = 6;
export const SIMILAR_MAX = 12;

/**
 * Una foto con poco detalle (cielo, pared, pantalla negra) da una huella casi
 * toda en 0 o en 1, y dos fotos así distintas se parecen. Con menos de 10 bits
 * del lado minoritario la huella visual no se usa para decir "es la misma":
 * solo vale la comparación exacta.
 */
export const WEAK_BELOW = 10;

export function isWeakVisual(h: bigint): boolean {
  const ones = hamming(h, 0n);
  return Math.min(ones, 64 - ones) < WEAK_BELOW;
}

export function compareHashes(
  sealed: { sha256: string; visual: bigint },
  copy: { sha256: string; visual: bigint },
): { kind: MatchKind; distance: number } {
  const distance = hamming(sealed.visual, copy.visual);
  if (sealed.sha256.toLowerCase() === copy.sha256.toLowerCase()) return { kind: 'exact', distance: 0 };
  if (isWeakVisual(sealed.visual)) return { kind: 'weak', distance };
  if (distance <= SAME_MAX) return { kind: 'same', distance };
  if (distance <= SIMILAR_MAX) return { kind: 'similar', distance };
  return { kind: 'different', distance };
}
