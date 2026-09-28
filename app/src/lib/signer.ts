/**
 * Quién firma la foto.
 *
 * Dentro de Polkadot App hay dos llaves:
 *
 * - **identity**: la cuenta dueña del username en People chain. Ata la foto a
 *   una persona con nombre: el verificador consulta el mismo registro.
 * - **app** (modo seudónimo): la cuenta de producto que el host deriva para
 *   esta app. Firma igual de bien, pero en la cadena nadie puede ligarla a un
 *   username. Para que siga sin ligarse, paga su propia transacción: si pagara
 *   la identidad, la transacción misma delataría a quién pertenece.
 *
 * Fuera del contenedor: cuenta de desarrollo, para ensayar en un navegador; la
 * foto sale marcada como ensayo y no se sella en la cadena.
 *
 * Mismo camino probado en testalk en Polkadot Desktop 0.1.3 (27 sep 2026).
 */
import { getAccountsProvider, isInsideContainerSync } from '@parity/product-sdk-host';
// Import estático: en el gateway dev-dot.li un chunk dinámico falló al pulsar "Conectar" (testalk).
import { SignerManager, type SignerManager as SM } from '@parity/product-sdk-signer';
import type { PolkadotSigner } from 'polkadot-api';
import { hexToU8a, u8aToHex } from '@polkadot/util';
import { encodeAddress } from '@polkadot/util-crypto';
import { waitForHost, withTimeout, describeError, TIMED_OUT, HOST_QUERY_MS, HOST_SUBMIT_MS } from './host';
import { APP_DOTNS } from './network';
import { usernameOwner } from './people';
import type { SignMode } from './receipt';

export type SignerKind = 'identity' | 'app' | 'rehearsal';

export interface Author {
  address: string;
  pubkey: string;
  /** Username del host; solo va en el recibo si firma la identidad. */
  username: string | null;
  kind: SignerKind;
}

interface Key {
  address: string;
  pubkey: string;
}

let manager: SM | null = null;
let appKey: Key | null = null;
let identity: (Key & { signer: PolkadotSigner }) | null = null;
let username: string | null = null;
let identityNote: string | null = null;
let connected = false;
let connecting: Promise<void> | null = null;

export const isConnected = () => connected;
export const hasIdentity = () => identity !== null;
export const connectedUsername = () => username;
/** Por qué no se puede firmar con la identidad, para decirlo en pantalla. */
export const identityUnavailableReason = () => identityNote;

export const modeOf = (k: SignerKind): SignMode => (k === 'identity' ? 'identity' : k === 'app' ? 'pseudonym' : 'rehearsal');

/** Abre el diálogo del wallet: llamar desde un gesto del usuario. */
export function connectWallet(): Promise<void> {
  connecting ??= (async () => {
    const inside = isInsideContainerSync();
    if (inside && !(await waitForHost())) throw new Error(`No hay canal con Polkadot App. Abre ${APP_DOTNS} desde la app.`);
    manager ??= new SignerManager({ dappName: APP_DOTNS });
    const r = await withTimeout(manager.connect(inside ? 'host' : 'dev'), HOST_SUBMIT_MS);
    if (r === TIMED_OUT) throw new Error('El wallet no respondió a tiempo.');
    if (!r.ok) throw new Error(describeError(r.error));
    const acc = r.value[0];
    if (!acc) throw new Error(inside ? 'El host no entregó ninguna cuenta. Abre la app desde Polkadot App o Desktop: en el navegador no se puede firmar.' : 'No hay cuenta de ensayo.');
    manager.selectAccount(acc.address);
    appKey = { address: acc.address, pubkey: u8aToHex(acc.publicKey) };
    connected = true;
    if (!inside) return;

    const u = await withTimeout(manager.getUserId(), HOST_QUERY_MS).catch(() => null);
    username = u && u !== TIMED_OUT && u.ok ? u.value.primaryUsername || null : null;
    identity = null;
    identityNote = null;
    if (!username) {
      identityNote = 'tu cuenta no tiene username';
      return;
    }
    try {
      const owner = await usernameOwner(username);
      if (!owner) {
        identityNote = `${username} no aparece en People chain`;
        return;
      }
      const ap = await withTimeout(getAccountsProvider(), HOST_QUERY_MS);
      if (ap === TIMED_OUT || !ap) {
        identityNote = 'el host no entregó el proveedor de cuentas';
        return;
      }
      const publicKey = hexToU8a(owner);
      identity = { address: encodeAddress(publicKey, 42), pubkey: owner, signer: ap.getLegacyAccountSigner({ publicKey, name: username }) };
    } catch (e) {
      identityNote = `no se pudo consultar People chain (${(e as Error).message})`;
    }
  })();
  connecting.catch(() => { connecting = null; });
  return connecting;
}

/** Autor para un modo. Fuera del contenedor siempre es el de ensayo. */
export function authorFor(kind: 'identity' | 'app'): Author {
  if (!appKey) throw new Error('Conecta tu wallet primero.');
  if (!isInsideContainerSync()) return { ...appKey, username: null, kind: 'rehearsal' };
  if (kind === 'identity') {
    if (!identity) throw new Error(identityNote ? `No se puede firmar con tu identidad: ${identityNote}.` : 'No se puede firmar con tu identidad.');
    return { address: identity.address, pubkey: identity.pubkey, username, kind: 'identity' };
  }
  return { ...appKey, username: null, kind: 'app' };
}

/** Firma bytes con la llave del autor. Devuelve hex. */
export async function signBytes(bytes: Uint8Array, kind: SignerKind): Promise<string> {
  if (!manager) throw new Error('Conecta tu wallet antes de sellar.');
  if (kind === 'identity') {
    if (!identity) throw new Error('Sin firma con identidad.');
    let sig: Uint8Array | typeof TIMED_OUT;
    try {
      sig = await withTimeout(identity.signer.signBytes(bytes), HOST_SUBMIT_MS);
    } catch (e) {
      throw new Error(`Firma rechazada: ${describeError(e instanceof Error ? e.message : e)}`);
    }
    if (sig === TIMED_OUT) throw new Error('La firma no llegó a tiempo. Revisa Polkadot App.');
    return u8aToHex(sig);
  }
  const r = await withTimeout(manager.signRaw(bytes), HOST_SUBMIT_MS);
  if (r === TIMED_OUT) throw new Error('La firma no llegó a tiempo. Revisa Polkadot App.');
  if (!r.ok) throw new Error(`Firma rechazada: ${describeError(r.error)}`);
  return u8aToHex(r.value);
}

export function addressFor(kind: SignerKind): string | null {
  return kind === 'identity' ? identity?.address ?? null : appKey?.address ?? null;
}

/** Firmante de transacciones: cada modo paga con su propia cuenta. */
export function txSignerFor(kind: SignerKind): PolkadotSigner | null {
  if (kind === 'identity') return identity?.signer ?? null;
  return manager?.getSigner() ?? null;
}
