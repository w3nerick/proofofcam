/**
 * Verificador independiente de un acta de Proof of Cam, sin la app ni el host.
 *
 *   npm run verify -- <id>                 comprueba el acta
 *   npm run verify -- <id> foto.jpg        además compara el archivo (copia exacta)
 *
 * Lee PhotoRegistry y los bloques por RPC público de Asset Hub y el dueño del
 * username por People chain. Todo lo demás se calcula aquí. Sale con 0 si el
 * acta es válida (y la foto, si se dio, es idéntica), con 1 si el acta no es
 * válida y con 3 si el acta es válida pero la foto no es una copia exacta.
 */
import { readFileSync } from 'node:fs';
import { createClient, Binary } from 'polkadot-api';
import { getWsProvider } from 'polkadot-api/ws';
import { decodeFunctionResult, encodeFunctionData, type Abi } from 'viem';
import { decodeAddress } from '@polkadot/util-crypto';
import { hexToU8a, u8aToHex } from '@polkadot/util';
import { sha256Hex, dhashHex } from '../src/lib/imagehash.ts';
import { parseReceipt, verifyReceiptSig, addressOf } from '../src/lib/receipt.ts';
import { idToBytes16, isId } from '../src/lib/ids.ts';
import { ASSET_HUB_GENESIS, PUBLIC_WS, PEOPLE_WS, REGISTRY_ADDRESS } from '../src/lib/network.ts';

const abi = JSON.parse(readFileSync(new URL('../src/lib/PhotoRegistry.abi.json', import.meta.url), 'utf8')) as Abi;
const READ_ORIGIN = '5DfhGyQdFobKM8NsWvEeAKk5EQQgYe9AydgJ7rMB6E1EqRzV';
const tty = process.stdout.isTTY;
const c = {
  ok: (s: string) => (tty ? `\x1b[32m${s}\x1b[0m` : s),
  bad: (s: string) => (tty ? `\x1b[31m${s}\x1b[0m` : s),
  warn: (s: string) => (tty ? `\x1b[33m${s}\x1b[0m` : s),
  bold: (s: string) => (tty ? `\x1b[1m${s}\x1b[0m` : s),
};

const [id, file] = process.argv.slice(2);
if (!id || !isId(id)) {
  console.error('Uso: npm run verify -- <id de 16 letras> [foto.jpg]');
  process.exit(2);
}

const hub = createClient(getWsProvider(PUBLIC_WS));
const done = (code: number) => { hub.destroy(); process.exit(code); };
let ok = true;

type Photo = { imageHash: string; pubkey: string; visualHash: bigint; anchorBlock: number; blockNumber: bigint; sealedAt: bigint; submitter: string; sig: string; receipt: string };
const data = encodeFunctionData({ abi, functionName: 'get', args: [idToBytes16(id)] });
const r = (await hub.getUnsafeApi().apis.ReviveApi.call(READ_ORIGIN, REGISTRY_ADDRESS, 0n, undefined, undefined, Binary.fromHex(data))) as { result?: { success: boolean; value: { flags: number; data: Uint8Array | string } } };
if (!r.result?.success || r.result.value.flags) { console.error(c.bad('No se pudo leer el registro.')); done(1); }
const raw = r.result!.value.data;
const p = decodeFunctionResult({ abi, functionName: 'get', data: (typeof raw === 'string' ? raw : Binary.toHex(raw)) as `0x${string}` }) as unknown as Photo;
if (/^0x0{40}$/i.test(p.submitter)) { console.log(c.bad(`Sin acta para ${id}.`)); done(1); }

const bytes = hexToU8a(p.receipt);
const receipt = parseReceipt(bytes);
if (typeof receipt === 'string') { console.log(c.bad(`El recibo no se puede leer: ${receipt}`)); done(1); }
const rc = receipt as Exclude<typeof receipt, string>;

console.log(`\n${c.bold(`Acta ${id}`)}`);
console.log(`Sellada en el bloque #${Number(p.blockNumber).toLocaleString('en-US')} (${new Date(Number(p.sealedAt) * 1000).toISOString()})`);
console.log(`Firmó ${addressOf(p.pubkey)}${rc.who ? ` · dice ser ${rc.who}` : ' · seudónimo'}\n`);

const check = (pass: boolean | null, good: string, bad: string) => {
  if (pass === null) console.log(c.warn(`? ${bad}`));
  else if (pass) console.log(c.ok(`✓ ${good}`));
  else { ok = false; console.log(c.bad(`✗ ${bad}`)); }
};

check(await verifyReceiptSig(bytes, p.sig, p.pubkey), 'Firma válida (sr25519 sobre el recibo guardado)', 'Firma inválida');
const coherent = rc.id === id && rc.sha256.toLowerCase() === p.imageHash.toLowerCase() && rc.dhash === dhashHex(p.visualHash) && rc.block.n === p.anchorBlock && rc.genesis.toLowerCase() === ASSET_HUB_GENESIS;
check(coherent, 'El acta coincide con su recibo (id, huellas, bloque, red)', 'El acta no coincide con su recibo');

if (rc.who) {
  const people = createClient(getWsProvider(PEOPLE_WS));
  try {
    const owner = (await people.getUnsafeApi().query.Resources.UsernameOwnerOf.getValue(new TextEncoder().encode(rc.who))) as string | undefined;
    const ownerHex = owner ? u8aToHex(decodeAddress(owner)) : null;
    check(ownerHex?.toLowerCase() === p.pubkey.toLowerCase(), `Identidad: la llave es la dueña de ${rc.who} en People chain`, `Identidad falsa: ${rc.who} no es de la llave que firmó`);
  } catch (e) {
    check(null, '', `Identidad sin comprobar (${(e as Error).message})`);
  } finally {
    people.destroy();
  }
} else {
  console.log('· Seudónimo: la llave no está ligada a ningún username, a propósito');
}

let onchain: string | null = null;
try {
  const h = await hub._request<string[] | string | null>('archive_v1_hashByHeight', [rc.block.n]);
  onchain = Array.isArray(h) ? h[0] : h;
} catch {
  onchain = await hub._request<string | null>('chain_getBlockHash', [rc.block.n]).catch(() => null);
}
check(onchain ? onchain.toLowerCase() === rc.block.hash.toLowerCase() : null, `El bloque previo #${rc.block.n.toLocaleString('en-US')} existe: la foto no pudo existir antes`, onchain ? 'Bloque previo inventado' : 'Bloque previo sin comprobar');
console.log(`· Ventana: entre el bloque #${rc.block.n.toLocaleString('en-US')} y el #${Number(p.blockNumber).toLocaleString('en-US')} (${Number(p.blockNumber) - rc.block.n} bloques)`);
console.log(`· Ubicación: ${rc.loc ? 'sellada y cifrada (solo su dueño puede revelar un nivel)' : 'sin ubicación'}`);

console.log(ok ? c.ok('\nACTA VÁLIDA\n') : c.bad('\nACTA INVÁLIDA\n'));

// La copia es otra pregunta: una copia distinta no vuelve inválida el acta.
let copyOk = true;
if (file) {
  const sha = sha256Hex(new Uint8Array(readFileSync(file)));
  copyOk = sha.toLowerCase() === p.imageHash.toLowerCase();
  console.log(copyOk
    ? c.ok(`✓ ${file} es idéntica a la foto sellada`)
    : c.warn(`? ${file} no es idéntica byte a byte. Si pasó por un chat o se copió entre teléfonos, es normal: compárala en la página del acta, que reconoce copias recomprimidas.`));
  console.log('');
}
done(ok ? (copyOk ? 0 : 3) : 1);
