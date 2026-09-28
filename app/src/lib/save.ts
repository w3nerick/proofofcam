/**
 * Guardar la foto en el teléfono. Nada se sube: la foto sale de la app solo
 * hacia donde la persona elija.
 *
 * Caminos: la hoja de compartir del sistema (Web Share con archivos, que en
 * iPhone trae "Guardar imagen"), la descarga, y mantener presionada la foto en
 * un visor dentro de la app.
 *
 * Medido en Polkadot App iOS (28 sep 2026): la descarga con `<a download>` no
 * descarga. El WebView abre la imagen encima de la app, sin forma de volver, y
 * la foto se pierde. Por eso en iPhone no se ofrece, y en todos lados el enlace
 * de descarga abre aparte (`target=_blank`), nunca en lugar de la app.
 */
export type SaveResult = 'shared' | 'cancelled' | 'unsupported' | 'downloaded';

export const fileName = (id: string) => `proofofcam-${id}.jpg`;

/** iPhone o iPad, incluido el iPad que se presenta como Mac. */
export function isIOS(): boolean {
  return /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Mac/.test(navigator.platform));
}

export function canShareFiles(): boolean {
  try {
    const f = new File([new Uint8Array(1)], 'x.jpg', { type: 'image/jpeg' });
    return !!navigator.canShare?.({ files: [f] });
  } catch {
    return false;
  }
}

export async function sharePhoto(blob: Blob, id: string): Promise<SaveResult> {
  const file = new File([blob], fileName(id), { type: 'image/jpeg' });
  if (!navigator.canShare?.({ files: [file] })) return 'unsupported';
  try {
    // Solo el archivo: ni texto ni enlace que el destino pueda registrar aparte.
    await navigator.share({ files: [file] });
    return 'shared';
  } catch (e) {
    return (e as Error)?.name === 'AbortError' ? 'cancelled' : 'unsupported';
  }
}

export function downloadPhoto(blob: Blob, id: string): SaveResult {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = fileName(id);
  a.target = '_blank';
  a.rel = 'noopener';
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  return 'downloaded';
}
