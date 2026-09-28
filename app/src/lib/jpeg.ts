/** Metadatos de JPEG: quitarlos y detectarlos. Sin DOM, para poder probarlo en Node. */

/**
 * Quita del JPEG todo bloque de metadatos: EXIF y XMP (APP1), IPTC (APP13),
 * comentarios y cualquier otro APPn. Conserva solo lo que hace falta para verla
 * bien: JFIF (APP0), el perfil de color (APP2) y Adobe (APP14).
 *
 * El canvas no conoce el GPS ni la cámara, pero el codificador de Apple que usa
 * el iPhone igual agrega un EXIF (espacio de color y tamaño) y un bloque IPTC;
 * medido el 28 sep 2026. Con esto la foto sale igual de limpia en todos lados.
 */
export function stripMetadata(bytes: Uint8Array): Uint8Array {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return bytes;
  const keep = new Set([0xe0, 0xe2, 0xee]);
  const parts: Uint8Array[] = [bytes.subarray(0, 2)];
  let i = 2;
  while (i + 4 <= bytes.length) {
    if (bytes[i] !== 0xff) return bytes; // estructura inesperada: no se toca
    const marker = bytes[i + 1];
    if (marker === 0xff) { i++; continue; } // relleno
    if (marker === 0xda) { parts.push(bytes.subarray(i)); break; } // desde aquí, datos de imagen
    const len = (bytes[i + 2] << 8) | bytes[i + 3];
    const end = i + 2 + len;
    if (len < 2 || end > bytes.length) return bytes;
    const isApp = marker >= 0xe0 && marker <= 0xef;
    if ((!isApp && marker !== 0xfe) || keep.has(marker)) parts.push(bytes.subarray(i, end));
    i = end;
  }
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

export interface ExifSummary {
  exif: boolean;
  gps: boolean;
}

/**
 * ¿El JPEG trae EXIF, y dentro de él GPS? Solo mira si están, no los lee: el
 * diagnóstico lo usa para contar qué deja pasar el sistema, sin mostrar datos.
 */
export function exifSummary(bytes: Uint8Array): ExifSummary {
  const out = { exif: false, gps: false };
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return out;
  let i = 2;
  while (i + 4 < bytes.length && i < 1 << 20) {
    if (bytes[i] !== 0xff) break;
    const marker = bytes[i + 1];
    const len = (bytes[i + 2] << 8) | bytes[i + 3];
    if (marker === 0xe1 && String.fromCharCode(...bytes.slice(i + 4, i + 8)) === 'Exif') {
      out.exif = true;
      // Etiqueta GPSInfo (0x8825) en cualquiera de los dos órdenes de bytes.
      const seg = bytes.slice(i + 4, i + 2 + len);
      for (let j = 0; j + 1 < seg.length; j++) {
        if ((seg[j] === 0x88 && seg[j + 1] === 0x25) || (seg[j] === 0x25 && seg[j + 1] === 0x88)) {
          out.gps = true;
          break;
        }
      }
    }
    if (marker === 0xda) break;
    i += 2 + len;
  }
  return out;
}
