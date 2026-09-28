/**
 * Ubicación: opcional, apagada por defecto, y nunca en claro.
 *
 * Las coordenadas se piden al sistema, se convierten a geohash en el teléfono
 * y se descartan. Lo que se sella son compromisos y el geohash cifrado (loc.ts).
 * La llave sale de la cuenta del usuario vía `deriveEntropy` (RFC 0007), así
 * que no hay nada que guardar ni que perder.
 *
 * Medido por otros: en Polkadot App Android la geolocalización falla sin
 * preguntar (products-devnet-issues #7). El diagnóstico lo mide en cada
 * teléfono.
 */
import { deriveEntropy, isInsideContainerSync } from '@parity/product-sdk-host';
import { blake2b } from '@noble/hashes/blake2b';
import { utf8ToBytes } from '@noble/hashes/utils';
import { waitForHost, withTimeout, TIMED_OUT, describeError, HOST_QUERY_MS } from './host';
import { askDevice } from './permissions';
import { ENTROPY_CONTEXT } from './loc.ts';

let master: Promise<Uint8Array> | null = null;

/** Llave maestra de ubicación de esta cuenta en esta app. */
export function locationMaster(): Promise<Uint8Array> {
  master ??= (async () => {
    if (!isInsideContainerSync()) {
      // Ensayo en un navegador: llave fija y pública. Esas fotos no se sellan.
      return blake2b(utf8ToBytes('proofofcam-ensayo-no-es-secreta'), { dkLen: 32 });
    }
    if (!(await waitForHost())) throw new Error('sin canal con el host');
    const r = await withTimeout(deriveEntropy(utf8ToBytes(ENTROPY_CONTEXT)), HOST_QUERY_MS);
    if (r === TIMED_OUT) throw new Error('el host no respondió a la derivación de llave');
    if (!r.ok) throw new Error(`el host no derivó la llave (${describeError(r.error)})`);
    if (r.value.length !== 32) throw new Error('el host devolvió una llave de otro tamaño');
    return r.value;
  })();
  master.catch(() => { master = null; });
  return master;
}

export interface Position {
  lat: number;
  lon: number;
  accuracy: number;
}

export async function currentPosition(timeoutMs = 20_000): Promise<Position> {
  const answer = await askDevice('Location');
  if (answer === 'denied') throw new Error('Polkadot App no dio permiso de ubicación.');
  if (!navigator.geolocation) throw new Error('este contenedor no ofrece ubicación');
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      p => resolve({ lat: p.coords.latitude, lon: p.coords.longitude, accuracy: p.coords.accuracy }),
      e => reject(new Error(
        e.code === e.PERMISSION_DENIED ? 'el sistema negó la ubicación (en Polkadot App Android falla sin preguntar)'
          : e.code === e.TIMEOUT ? 'el GPS no respondió a tiempo' : 'no se pudo obtener la ubicación',
      )),
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 0 },
    );
  });
}
