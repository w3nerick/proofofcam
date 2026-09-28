/**
 * El recibo de una foto: lo que se firma y lo que queda en la cadena para
 * siempre.
 *
 * Lleva solo lo necesario para verificar la foto y nada que ayude a rastrear a
 * quien la tomó: ni resolución, tamaño o cámara (dirían qué teléfono es y se
 * leen de la foto misma), ni sistema, ni zona horaria (la hora va en UTC), ni
 * coordenadas (la ubicación, si se activa, va como compromisos y cifrada).
 *
 * Los bytes que se firman son exactamente los que se guardan en el contrato,
 * así que verificar no depende de reordenar claves: se verifica la firma sobre
 * esos bytes y después se leen.
 */
import { cryptoWaitReady, signatureVerify, encodeAddress } from '@polkadot/util-crypto';
import { hexToU8a } from '@polkadot/util';
import { isId } from './ids.ts';
import type { SealedLocation } from './loc.ts';

export type SignMode = 'identity' | 'pseudonym' | 'rehearsal';
export type Facing = 'back' | 'front' | 'unknown';

export interface Receipt {
  v: 1;
  app: 'proofofcam';
  id: string;
  /** sha256 de los bytes exactos de la foto. */
  sha256: string;
  /** dHash de 64 bits, 16 caracteres hex. */
  dhash: string;
  /** Si la foto lleva el QR estampado. */
  stamp: boolean;
  /** Hora del disparo según el teléfono, UTC, sin milisegundos. La cadena da las cotas reales. */
  taken: string;
  /** Último bloque finalizado que vio el teléfono antes del disparo. */
  block: { n: number; hash: string };
  loc?: SealedLocation;
  /** Username en People chain; vacío en modo seudónimo. */
  who: string;
  mode: SignMode;
  net: string;
  genesis: string;
}

/** Bytes canónicos: claves siempre en el mismo orden. */
export function receiptBytes(r: Receipt): Uint8Array {
  const ordered = {
    v: r.v,
    app: r.app,
    id: r.id,
    sha256: r.sha256,
    dhash: r.dhash,
    stamp: r.stamp,
    taken: r.taken,
    block: { n: r.block.n, hash: r.block.hash },
    ...(r.loc ? { loc: { root: r.loc.root, box: r.loc.box } } : {}),
    who: r.who,
    mode: r.mode,
    net: r.net,
    genesis: r.genesis,
  };
  return new TextEncoder().encode(JSON.stringify(ordered));
}

export const utcSeconds = (d = new Date()) => d.toISOString().replace(/\.\d{3}Z$/, 'Z');

const HEX32 = /^0x[0-9a-f]{64}$/i;

/** Lee un recibo guardado. Devuelve el recibo o el motivo por el que no lo es. */
export function parseReceipt(bytes: Uint8Array): Receipt | string {
  let r: Record<string, unknown>;
  try {
    r = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return 'no es JSON';
  }
  if (!r || typeof r !== 'object' || Array.isArray(r)) return 'no es un objeto';
  if (r.v !== 1 || r.app !== 'proofofcam') return 'no es un recibo de Proof of Cam v1';
  if (typeof r.id !== 'string' || !isId(r.id)) return 'id inválido';
  if (typeof r.sha256 !== 'string' || !HEX32.test(r.sha256)) return 'huella exacta inválida';
  if (typeof r.dhash !== 'string' || !/^[0-9a-f]{16}$/.test(r.dhash)) return 'huella visual inválida';
  for (const k of ['taken', 'who', 'mode', 'net', 'genesis']) if (typeof r[k] !== 'string') return `"${k}" no es texto`;
  if (typeof r.stamp !== 'boolean') return '"stamp" no es sí/no';
  const b = r.block as Record<string, unknown> | undefined;
  if (!b || !Number.isInteger(b.n) || typeof b.hash !== 'string' || !HEX32.test(b.hash)) return 'bloque inválido';
  if (r.loc !== undefined) {
    const l = r.loc as Record<string, unknown>;
    if (!l || typeof l.root !== 'string' || !HEX32.test(l.root) || typeof l.box !== 'string') return 'ubicación inválida';
  }
  return r as unknown as Receipt;
}

/** ¿`sig` es una firma sr25519 de `pubkey` sobre estos bytes? Acepta el envoltorio <Bytes>. */
export async function verifyReceiptSig(bytes: Uint8Array, sig: string, pubkey: string): Promise<boolean> {
  await cryptoWaitReady();
  try {
    return signatureVerify(bytes, hexToU8a(sig), hexToU8a(pubkey)).isValid;
  } catch {
    return false;
  }
}

export const addressOf = (pubkey: string) => encodeAddress(hexToU8a(pubkey), 42);
