/**
 * Permisos del contenedor.
 *
 * Al arrancar solo se piden los de red (RPC públicos de respaldo para Asset
 * Hub y People chain) y el portapapeles. Cámara y ubicación se piden en el
 * momento de usarlas, nunca antes: quien abre un QR para verificar no tiene
 * por qué ver una petición de cámara.
 */
import { isInsideContainerSync, requestDevicePermission, requestPermission } from '@parity/product-sdk-host';
import { waitForHost, withTimeout, TIMED_OUT, HOST_SUBMIT_MS } from './host';
import { PEOPLE_WS, PUBLIC_WS } from './network';

const host = (u: string) => new URL(u).hostname;
export const REMOTE_DOMAINS = [...PUBLIC_WS.map(host), ...PEOPLE_WS.map(host)];

let asked: Promise<void> | null = null;

export function requestHostPermissions(): Promise<void> {
  asked ??= (async () => {
    if (!isInsideContainerSync() || !(await waitForHost())) return;
    await Promise.race([
      Promise.all([
        requestPermission({ tag: 'Remote', value: { domains: REMOTE_DOMAINS } }).catch(() => undefined),
        requestDevicePermission('Clipboard').catch(() => undefined),
      ]),
      new Promise(r => setTimeout(r, 4000)),
    ]);
  })().catch(() => undefined);
  return asked;
}

export type DeviceAnswer = 'granted' | 'denied' | 'no-host' | 'timeout';

/**
 * Pide al host un permiso de dispositivo. Fuera del contenedor no hay host y
 * decide el navegador: eso es `no-host`, no una negativa.
 */
export async function askDevice(kind: 'Camera' | 'Location' | 'OpenUrl'): Promise<DeviceAnswer> {
  if (!isInsideContainerSync()) return 'no-host';
  if (!(await waitForHost())) return 'no-host';
  const r = await withTimeout(requestDevicePermission(kind), HOST_SUBMIT_MS).catch(() => null);
  if (r === TIMED_OUT) return 'timeout';
  if (!r || !r.ok) return 'no-host';
  return r.value === false ? 'denied' : 'granted';
}

/** Permiso para mandar transacciones; sin él la hoja de firma no aparece. */
export async function askChainSubmit(): Promise<void> {
  const perm = await withTimeout(requestPermission({ tag: 'ChainSubmit', value: undefined }), HOST_SUBMIT_MS);
  if (perm === TIMED_OUT) throw new Error('el host no respondió al permiso para enviar transacciones');
  if (!perm.ok || !perm.value) throw new Error('permiso para enviar transacciones denegado');
}
