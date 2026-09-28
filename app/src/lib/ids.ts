/**
 * Identificador de una foto: 16 caracteres base32 (80 bits al azar).
 *
 * Va en el QR estampado en la foto y es la llave del acta en el contrato: sus
 * 16 bytes ASCII caben justo en un `bytes16`. Se genera antes del disparo
 * porque el QR forma parte de la imagen que se firma.
 */
const ALPHABET = 'abcdefghijklmnopqrstuvwxyz234567';
export const ID_LENGTH = 16;

export function newId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  let value = 0;
  let bits = 0;
  let out = '';
  for (const b of bytes) {
    value = ((value << 8) | b) & 0xfff;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  return out;
}

export function isId(s: string): boolean {
  return /^[a-z2-7]{16}$/.test(s);
}

export function idToBytes16(id: string): `0x${string}` {
  if (!isId(id)) throw new Error(`id inválido: ${id}`);
  return `0x${[...id].map(c => c.charCodeAt(0).toString(16).padStart(2, '0')).join('')}`;
}

export function bytes16ToId(hex: string): string | null {
  const h = hex.replace(/^0x/, '');
  if (h.length !== 32) return null;
  let s = '';
  for (let i = 0; i < 32; i += 2) s += String.fromCharCode(parseInt(h.slice(i, i + 2), 16));
  return isId(s) ? s : null;
}
