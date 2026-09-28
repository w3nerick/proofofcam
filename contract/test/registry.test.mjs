// Pruebas de lógica de PhotoRegistry en una EVM local (@ethereumjs/vm).
//
// El destino real es pallet-revive (PolkaVM, compilado con resolc). Esto solo
// cubre la lógica del contrato: duplicados, validaciones, getters y paginado.
// El bytecode PolkaVM se prueba aparte con `npm run simulate` contra el devnet.
import { readFileSync } from 'node:fs';
import { createVM } from '@ethereumjs/vm';
import { createBlock } from '@ethereumjs/block';
import { createAddressFromString, hexToBytes, bytesToHex } from '@ethereumjs/util';
import { encodeFunctionData, decodeFunctionResult, decodeErrorResult, toHex } from 'viem';
import assert from 'node:assert/strict';

const abi = JSON.parse(readFileSync(new URL('../out-evm/PhotoRegistry.abi', import.meta.url)));
const bin = '0x' + readFileSync(new URL('../out-evm/PhotoRegistry.bin', import.meta.url), 'utf8').trim();

const vm = await createVM();
const block = createBlock({ header: { number: 13_900_000n, timestamp: 1_790_100_000n, gasLimit: 30_000_000n } }, { common: vm.common });
const alice = createAddressFromString('0x' + '11'.repeat(20));
const bob = createAddressFromString('0x' + '22'.repeat(20));

const deploy = await vm.evm.runCall({ data: hexToBytes(bin), gasLimit: 10_000_000n, caller: alice, block });
assert.equal(deploy.execResult.exceptionError, undefined, 'deploy');
const to = deploy.createdAddress;

async function call(fn, args, caller = alice) {
  const r = await vm.evm.runCall({ to, caller, data: hexToBytes(encodeFunctionData({ abi, functionName: fn, args })), gasLimit: 5_000_000n, block });
  const ret = bytesToHex(r.execResult.returnValue);
  if (r.execResult.exceptionError) {
    const err = ret !== '0x' ? decodeErrorResult({ abi, data: ret }) : { errorName: String(r.execResult.exceptionError.error) };
    return { reverted: err.errorName, args: err.args };
  }
  return { value: ret === '0x' ? undefined : decodeFunctionResult({ abi, functionName: fn, data: ret }) };
}

// El id de la app son 16 caracteres base32: sus bytes ASCII caben justo en un bytes16.
const id = s => toHex(new TextEncoder().encode(s));
const id1 = id('k3m9x2qp7t4v8w1a');
const id2 = id('abcdefghijklmnop');
const img1 = '0x' + 'ab'.repeat(32);
const img2 = '0x' + 'cd'.repeat(32);
const pub = '0x' + 'd4'.repeat(32);
const sig = '0x' + '5a'.repeat(64);
const receipt = toHex(new TextEncoder().encode('{"v":1,"app":"proofofcam","id":"k3m9x2qp7t4v8w1a"}'));
const ZERO16 = '0x' + '00'.repeat(16);
let passed = 0;
const ok = (name) => { passed++; console.log('  ✓', name); };

console.log('PhotoRegistry');

assert.deepEqual((await call('total', [])).value, 0n); ok('empieza vacío');
assert.equal((await call('MAX_RECEIPT', [])).value, 1024n); ok('recibo de hasta 1024 bytes');

let r = await call('seal', [id1, img1, 0x0f0e0d0c0b0a0908n, pub, 13_899_000, sig, receipt]);
assert.equal(r.reverted, undefined); ok('sella una foto');

r = await call('get', [id1]);
assert.equal(r.value.imageHash, img1);
assert.equal(r.value.pubkey, pub);
assert.equal(r.value.visualHash, 0x0f0e0d0c0b0a0908n);
assert.equal(r.value.anchorBlock, 13_899_000);
assert.equal(r.value.blockNumber, 13_900_000n);
assert.equal(r.value.sealedAt, 1_790_100_000n);
assert.equal(r.value.submitter.toLowerCase(), alice.toString());
assert.equal(r.value.sig, sig);
assert.equal(r.value.receipt, receipt); ok('get devuelve el acta completa, con bloque y hora del sello');

assert.equal((await call('idOf', [img1])).value, id1); ok('idOf encuentra el acta por la huella exacta');
assert.equal((await call('idOf', [img2])).value, ZERO16); ok('idOf de una foto desconocida: cero');

r = await call('seal', [id1, img2, 1n, pub, 1, sig, receipt], bob);
assert.equal(r.reverted, 'AlreadySealed');
assert.equal((await call('get', [id1])).value.submitter.toLowerCase(), alice.toString()); ok('el mismo id no se sobrescribe: el primero gana');

assert.equal((await call('seal', [id2, img1, 1n, pub, 1, sig, receipt])).reverted, 'ImageAlreadySealed'); ok('la misma foto no se sella dos veces con otro id');

r = await call('get', [id2]);
assert.equal(r.value.submitter, '0x0000000000000000000000000000000000000000'); ok('id desconocido: submitter en cero');

assert.equal((await call('seal', [ZERO16, img2, 1n, pub, 1, sig, receipt])).reverted, 'EmptyId'); ok('rechaza id vacío');
assert.equal((await call('seal', [id2, '0x' + '00'.repeat(32), 1n, pub, 1, sig, receipt])).reverted, 'EmptyHash'); ok('rechaza huella vacía');
assert.equal((await call('seal', [id2, img2, 1n, pub, 1, '0x' + '00'.repeat(63), receipt])).reverted, 'BadSignatureLength'); ok('rechaza firmas que no son de 64 bytes');
assert.equal((await call('seal', [id2, img2, 1n, pub, 1, sig, '0x'])).reverted, 'BadReceiptLength'); ok('rechaza recibo vacío');
assert.equal((await call('seal', [id2, img2, 1n, pub, 1, sig, '0x' + '7b'.repeat(1025)])).reverted, 'BadReceiptLength'); ok('rechaza recibo de más de 1024 bytes');

assert.equal((await call('seal', [id2, img2, 77n, pub, 7, sig, receipt], bob)).reverted, undefined);
assert.equal((await call('total', [])).value, 2n);
let p = (await call('page', [0n, 10n])).value;
assert.deepEqual(p, [[id1, id2], [0x0f0e0d0c0b0a0908n, 77n]]);
p = (await call('page', [1n, 10n])).value;
assert.deepEqual(p, [[id2], [77n]]);
p = (await call('page', [5n, 10n])).value;
assert.deepEqual(p, [[], []]); ok('total y page listan ids y huellas visuales en orden de sellado');

console.log(`\n${passed} pruebas pasaron`);
