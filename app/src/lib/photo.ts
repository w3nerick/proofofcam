/**
 * De un cuadro de cámara a una foto sellable: QR estampado, JPEG y huellas.
 *
 * El QR va dentro de la imagen, en una esquina, y apunta al acta de la foto:
 * viaja con ella aunque la reenvíen o le tomen captura de pantalla. Por eso el
 * id se genera antes del disparo y la huella se calcula después de estampar.
 */
import QRCode from 'qrcode';
import { dhash64, sha256Hex } from './imagehash.ts';
import { WEB_GATEWAY } from './network';
import type { Facing } from './receipt.ts';

export const verifyUrl = (id: string) => `${WEB_GATEWAY}/#/f/${id}`;

export interface Shot {
  id: string;
  blob: Blob;
  bytes: Uint8Array;
  /** URL local (blob:) para mostrarla; se revoca al salir. */
  url: string;
  sha256: `0x${string}`;
  visual: bigint;
  w: number;
  h: number;
  stamp: boolean;
  camera: Facing;
}

/** Tarjeta blanca con el QR y la palabra "testigo", abajo a la derecha. */
export function drawStamp(canvas: HTMLCanvasElement, url: string): void {
  const ctx = canvas.getContext('2d')!;
  const qr = QRCode.create(url, { errorCorrectionLevel: 'M' });
  const n = qr.modules.size;
  const quiet = 3;
  const short = Math.min(canvas.width, canvas.height);
  const cell = Math.max(5, Math.floor((short * 0.22) / (n + quiet * 2)));
  const side = cell * (n + quiet * 2);
  const label = Math.round(cell * 3.2);
  const margin = Math.round(short * 0.025);
  const x = canvas.width - side - margin;
  const y = canvas.height - side - label - margin;
  const r = cell * 1.5;

  ctx.save();
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.roundRect(x, y, side, side + label, r);
  ctx.fill();
  ctx.fillStyle = '#111111';
  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) {
      if (qr.modules.get(row, col)) ctx.fillRect(x + (col + quiet) * cell, y + (row + quiet) * cell, cell, cell);
    }
  }
  ctx.font = `700 ${Math.round(cell * 1.9)}px ui-monospace, "SF Mono", Menlo, monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('TESTIGO · VERIFICA', x + side / 2, y + side + label * 0.38);
  ctx.restore();
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
  return new Promise((res, rej) => canvas.toBlob(b => (b ? res(b) : rej(new Error('no se pudo codificar la foto'))), type, quality));
}

/**
 * Píxeles de una imagen codificada. Se decodifica el archivo (no se reusa el
 * canvas) para que quien sella y quien verifica calculen la huella visual
 * sobre lo mismo: el JPEG.
 */
export async function pixelsOf(blob: Blob): Promise<{ data: Uint8ClampedArray; w: number; h: number; origW: number; origH: number }> {
  const bmp = await createImageBitmap(blob);
  const origW = bmp.width;
  const origH = bmp.height;
  const scale = Math.min(1, 4096 / Math.max(origW, origH));
  const w = Math.round(origW * scale);
  const h = Math.round(origH * scale);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close();
  const data = ctx.getImageData(0, 0, w, h).data;
  c.width = c.height = 0;
  return { data, w, h, origW, origH };
}

export async function finishShot(canvas: HTMLCanvasElement, o: { id: string; stamp: boolean; camera: Facing }): Promise<Shot> {
  if (o.stamp) drawStamp(canvas, verifyUrl(o.id));
  const blob = await toBlob(canvas, 'image/jpeg', 0.92);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const px = await pixelsOf(blob);
  return {
    id: o.id,
    blob,
    bytes,
    url: URL.createObjectURL(blob),
    sha256: sha256Hex(bytes),
    visual: dhash64(px.data, px.w, px.h),
    w: canvas.width,
    h: canvas.height,
    stamp: o.stamp,
    camera: o.camera,
  };
}

export interface FileHashes {
  sha256: `0x${string}`;
  visual: bigint;
  w: number;
  h: number;
  size: number;
  exif: ExifSummary;
}

/** Huellas de un archivo que alguien quiere comprobar. Todo pasa en este navegador. */
export async function hashFile(file: Blob): Promise<FileHashes> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const px = await pixelsOf(file);
  return { sha256: sha256Hex(bytes), visual: dhash64(px.data, px.w, px.h), w: px.origW, h: px.origH, size: bytes.length, exif: exifSummary(bytes) };
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
