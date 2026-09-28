/**
 * Guardar la foto en el teléfono. Nada se sube: la foto sale de la app solo
 * hacia donde la persona elija.
 *
 * Dentro de Polkadot App no está medido qué funciona, así que se ofrecen tres
 * caminos y el diagnóstico mide cada uno: la hoja de compartir del sistema
 * (Web Share con archivos, "Guardar imagen"), la descarga, y mantener
 * presionada la foto en pantalla.
 */
export type SaveResult = 'shared' | 'cancelled' | 'unsupported' | 'downloaded';

export const fileName = (id: string) => `testigo-${id}.jpg`;

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
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  return 'downloaded';
}
