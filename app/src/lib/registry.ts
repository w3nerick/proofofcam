/**
 * PhotoRegistry en pallet-revive: leer sin firmar (simulación de la runtime API
 * ReviveApi.call), simular el sello y enviarlo. Misma receta que testalk
 * probó en Polkadot Desktop 0.1.3: mapeo una vez, simulación, peso 2× y
 * espera hasta `finalized`.
 */
import { Binary, type PolkadotClient, type PolkadotSigner } from 'polkadot-api';
import { decodeErrorResult, decodeFunctionResult, encodeFunctionData, type Abi } from 'viem';
import abiJson from './PhotoRegistry.abi.json' with { type: 'json' };
import { REGISTRY_ADDRESS } from './network';
import { bytes16ToId, idToBytes16 } from './ids';

const abi = abiJson as Abi;

/** Cualquier cuenta sirve de origen para una lectura; esta es la pública de desarrollo. */
const READ_ORIGIN = '5DfhGyQdFobKM8NsWvEeAKk5EQQgYe9AydgJ7rMB6E1EqRzV';

export const registryDeployed = () => /^0x[0-9a-f]{40}$/i.test(REGISTRY_ADDRESS);

function address(): `0x${string}` {
  if (!registryDeployed()) throw new Error('el registro de fotos todavía no está desplegado');
  return REGISTRY_ADDRESS as `0x${string}`;
}

type CallResult = {
  weight_required: { ref_time: bigint; proof_size: bigint };
  storage_deposit?: { type: string; value: bigint };
  result?: { success: boolean; value: { flags: number; data: Uint8Array | string } | unknown };
};

async function dryRun(client: PolkadotClient, origin: string, data: `0x${string}`): Promise<CallResult> {
  // `dest` es [u8; 20]: en polkadot-api 2.2 va como texto hex; los Vec<u8> son Uint8Array.
  return (await client.getUnsafeApi().apis.ReviveApi.call(origin, address(), 0n, undefined, undefined, Binary.fromHex(data))) as CallResult;
}

const toHex = (d: Uint8Array | string) => (typeof d === 'string' ? d : Binary.toHex(d)) as `0x${string}`;

async function read<T>(client: PolkadotClient, functionName: string, args: unknown[]): Promise<T> {
  const r = await dryRun(client, READ_ORIGIN, encodeFunctionData({ abi, functionName, args }));
  const v = r?.result?.success ? (r.result.value as { flags: number; data: Uint8Array | string }) : null;
  if (!v || v.flags) throw new Error('el registro no respondió');
  return decodeFunctionResult({ abi, functionName, data: toHex(v.data) }) as T;
}

export interface OnChainPhoto {
  imageHash: `0x${string}`;
  pubkey: `0x${string}`;
  visualHash: bigint;
  anchorBlock: number;
  blockNumber: bigint;
  sealedAt: bigint;
  submitter: `0x${string}`;
  sig: `0x${string}`;
  receipt: `0x${string}`;
}

/** Acta de una foto, `null` si no existe, o lanza si no se pudo consultar. */
export async function readPhoto(client: PolkadotClient, id: string): Promise<OnChainPhoto | null> {
  const p = await read<OnChainPhoto>(client, 'get', [idToBytes16(id)]);
  return /^0x0{40}$/i.test(p.submitter) ? null : p;
}

/** Id del acta de una copia exacta, o `null`. */
export async function idOfImage(client: PolkadotClient, sha256: string): Promise<string | null> {
  const b = await read<`0x${string}`>(client, 'idOf', [sha256]);
  return /^0x0{32}$/i.test(b) ? null : bytes16ToId(b);
}

export async function totalPhotos(client: PolkadotClient): Promise<number> {
  return Number(await read<bigint>(client, 'total', []));
}

/** Todas las huellas visuales, para reconocer una copia que perdió el QR. */
export async function allVisualHashes(client: PolkadotClient, max = 5000): Promise<{ id: string; visual: bigint }[]> {
  const n = Math.min(await totalPhotos(client), max);
  const out: { id: string; visual: bigint }[] = [];
  for (let start = 0; start < n; start += 200) {
    const [ids, visual] = await read<[`0x${string}`[], bigint[]]>(client, 'page', [BigInt(start), 200n]);
    ids.forEach((b, i) => {
      const id = bytes16ToId(b);
      if (id) out.push({ id, visual: visual[i] });
    });
  }
  return out;
}

export const pas = (planck: bigint) => `${(Number(planck) / 1e10).toFixed(4)} PAS`;

export async function freeBalance(client: PolkadotClient, ss58: string): Promise<bigint> {
  const acc = (await client.getUnsafeApi().query.System.Account.getValue(ss58)) as { data?: { free?: bigint } } | undefined;
  return BigInt(acc?.data?.free ?? 0n);
}

/** pallet-revive solo acepta llamadas de cuentas mapeadas (`Revive.map_account`, una sola vez). */
export async function isMapped(client: PolkadotClient, ss58: string): Promise<boolean> {
  const api = client.getUnsafeApi();
  const h160 = (await api.apis.ReviveApi.address(ss58)) as string | Uint8Array;
  const key = typeof h160 === 'string' ? h160 : Binary.toHex(h160);
  return (await api.query.Revive.OriginalAccount.getValue(key)) != null;
}

export interface SealArgs {
  id: string;
  imageHash: `0x${string}`;
  visualHash: bigint;
  pubkey: `0x${string}`;
  anchorBlock: number;
  sig: `0x${string}`;
  receipt: `0x${string}`;
}

const sealCallData = (a: SealArgs) =>
  encodeFunctionData({ abi, functionName: 'seal', args: [idToBytes16(a.id), a.imageHash, a.visualHash, a.pubkey, a.anchorBlock, a.sig, a.receipt] });

export type SealSimulation =
  | { ok: true; weight: { ref_time: bigint; proof_size: bigint }; deposit: bigint }
  | { ok: false; why: string };

const ERRORS_ES: Record<string, string> = {
  AlreadySealed: 'ese id ya tiene acta',
  ImageAlreadySealed: 'esta misma foto ya está sellada',
  BadReceiptLength: 'el recibo es demasiado grande',
  BadSignatureLength: 'la firma no mide 64 bytes',
};

/** Simula `seal()` desde `origin`, sin firmar ni gastar. */
export async function simulateSeal(client: PolkadotClient, origin: string, a: SealArgs): Promise<SealSimulation> {
  const r = await dryRun(client, origin, sealCallData(a));
  const res = r?.result;
  if (!res?.success) return { ok: false, why: describeDispatch(res?.value) };
  const v = res.value as { flags: number; data: Uint8Array | string };
  if (v.flags) {
    try {
      const e = decodeErrorResult({ abi, data: toHex(v.data) });
      return { ok: false, why: ERRORS_ES[e.errorName] ?? `el contrato rechazó: ${e.errorName}` };
    } catch {
      return { ok: false, why: 'el contrato rechazó el sello' };
    }
  }
  return { ok: true, weight: r.weight_required, deposit: r.storage_deposit?.type === 'Charge' ? BigInt(r.storage_deposit.value) : 0n };
}

const DISPATCH_ES: Record<string, string> = {
  'Revive.AccountUnmapped': 'la cuenta no está registrada en pallet-revive',
  'Revive.StorageDepositNotEnoughFunds': 'el saldo no alcanza para el depósito',
  'Revive.OutOfGas': 'se quedó sin peso',
};

const WEIGHT_CAP = { ref_time: 900_000_000_000n, proof_size: 3_000_000n };

interface TxEvent {
  type: string;
  found?: boolean;
  ok?: boolean;
  txHash?: string;
  block?: { number: number };
  dispatchError?: unknown;
}

function submit(tx: { signSubmitAndWatch(s: PolkadotSigner): { subscribe(o: object): { unsubscribe(): void } } }, signer: PolkadotSigner, onSigned: () => void): Promise<{ block: number; txHash: string }> {
  return new Promise((resolve, reject) => {
    const sub = tx.signSubmitAndWatch(signer).subscribe({
      next: (e: TxEvent) => {
        if (e.type === 'signed') onSigned();
        if (e.type === 'txBestBlocksState' && e.found && e.ok === false) {
          sub.unsubscribe();
          reject(new Error(describeDispatch(e.dispatchError)));
        }
        if (e.type === 'finalized') {
          sub.unsubscribe();
          if (e.ok) resolve({ block: e.block?.number ?? 0, txHash: e.txHash ?? '' });
          else reject(new Error(describeDispatch(e.dispatchError)));
        }
      },
      error: (err: unknown) => reject(err instanceof Error ? err : new Error(String(err))),
    });
  });
}

export function mapAccount(client: PolkadotClient, signer: PolkadotSigner, onSigned: () => void) {
  return submit(client.getUnsafeApi().tx.Revive.map_account(), signer, onSigned);
}

/** Envía `seal()` con peso y depósito de la simulación, con margen (lo que sobra se devuelve). */
export function submitSeal(client: PolkadotClient, signer: PolkadotSigner, a: SealArgs, sim: { weight: { ref_time: bigint; proof_size: bigint }; deposit: bigint }, onSigned: () => void) {
  const cap = (x: bigint, max: bigint) => (x * 2n < max ? x * 2n : max);
  const tx = client.getUnsafeApi().tx.Revive.call({
    dest: address(),
    value: 0n,
    weight_limit: { ref_time: cap(sim.weight.ref_time, WEIGHT_CAP.ref_time), proof_size: cap(sim.weight.proof_size, WEIGHT_CAP.proof_size) },
    storage_deposit_limit: (sim.deposit * 3n) / 2n + 10n ** 9n,
    data: Binary.fromHex(sealCallData(a)),
  });
  return submit(tx, signer, onSigned);
}

function describeDispatch(e: unknown): string {
  const m = e as { type?: string; value?: { type?: string; value?: { type?: string } } } | undefined;
  if (m?.type === 'Module' && m.value?.type) {
    const name = `${m.value.type}.${m.value.value?.type ?? '?'}`;
    return DISPATCH_ES[name] ?? name;
  }
  return m?.type ?? 'la simulación falló';
}
