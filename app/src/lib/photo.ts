/**
 * De un cuadro de cámara a una foto sellable: marco con QR, JPEG y huellas.
 *
 * La foto no se toca: el QR va en un marco tipo Polaroid debajo de ella y
 * apunta a su acta, así viaja con la imagen aunque la reenvíen o le tomen
 * captura. Por eso el id se genera antes del disparo y la huella exacta se
 * calcula sobre el archivo con marco; la visual, solo sobre la foto.
 */
import QRCode from 'qrcode';
import { dhash64, sha256Hex, frameHeight, photoRowsOf } from './imagehash.ts';
import { exifSummary, stripMetadata, type ExifSummary } from './jpeg.ts';

export { exifSummary, stripMetadata, type ExifSummary };
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

/**
 * Marco tipo Polaroid: la foto queda intacta y debajo va una franja con el QR
 * de su acta, el nombre de la app, el id, la hora UTC del disparo y la
 * invitación a verificarla. Solo lleva lo que se sabe antes de firmar: el
 * bloque del sello se decide después.
 */
export function frameCanvas(photo: HTMLCanvasElement, id: string, takenUtc: string): HTMLCanvasElement {
  const w = photo.width;
  const band = frameHeight(w);
  const out = document.createElement('canvas');
  out.width = w;
  out.height = photo.height + band;
  const ctx = out.getContext('2d')!;
  ctx.drawImage(photo, 0, 0);
  ctx.fillStyle = '#faf9f5';
  ctx.fillRect(0, photo.height, w, band);

  const pad = Math.round(band * 0.1);
  const qr = QRCode.create(verifyUrl(id), { errorCorrectionLevel: 'M' });
  const n = qr.modules.size + 4; // dos módulos de zona blanca por lado
  const cell = Math.floor((band - pad * 2) / n);
  const side = cell * n;
  const qx = pad;
  const qy = photo.height + Math.round((band - side) / 2);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(qx, qy, side, side);
  ctx.fillStyle = '#141414';
  for (let r = 0; r < qr.modules.size; r++) {
    for (let c = 0; c < qr.modules.size; c++) {
      if (qr.modules.get(r, c)) ctx.fillRect(qx + (c + 2) * cell, qy + (r + 2) * cell, cell, cell);
    }
  }

  const tx = qx + side + Math.round(pad * 1.2);
  const mono = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';
  const line = (text: string, size: number, color: string, weight: number, y: number) => {
    ctx.font = `${weight} ${Math.round(size)}px ${mono}`;
    ctx.fillStyle = color;
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(text, tx, photo.height + y, w - tx - pad);
  };
  line('PROOF OF CAM', band * 0.15, '#141414', 700, band * 0.3);
  line(`Acta ${id}`, band * 0.095, '#56544e', 400, band * 0.5);
  line(`Tomada ${takenUtc.replace('T', ' ').replace(/:\d\dZ$/, '')} UTC`, band * 0.095, '#56544e', 400, band * 0.66);
  line('Escanea para verificar', band * 0.095, '#d6402a', 700, band * 0.84);
  return out;
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

export async function finishShot(photo: HTMLCanvasElement, o: { id: string; stamp: boolean; camera: Facing; taken: string }): Promise<Shot> {
  const out = o.stamp ? frameCanvas(photo, o.id, o.taken) : photo;
  const bytes = stripMetadata(new Uint8Array(await (await toBlob(out, 'image/jpeg', 0.92)).arrayBuffer()));
  const blob = new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'image/jpeg' });
  const px = await pixelsOf(blob);
  // Huella visual solo de la foto: las filas de arriba, sin la franja del marco.
  const rows = o.stamp ? Math.round(photo.height * (px.h / out.height)) : px.h;
  const shot = {
    id: o.id,
    blob,
    bytes,
    url: URL.createObjectURL(blob),
    sha256: sha256Hex(bytes),
    visual: dhash64(px.data, px.w, rows),
    w: out.width,
    h: out.height,
    stamp: o.stamp,
    camera: o.camera,
  };
  if (out !== photo) out.width = out.height = 0;
  return shot;
}

export interface FileHashes {
  sha256: `0x${string}`;
  /** Candidatas: la copia entera y, si puede traer marco, la copia sin la franja. */
  visual: bigint[];
  w: number;
  h: number;
  size: number;
  exif: ExifSummary;
}

/** Huellas de un archivo que alguien quiere comprobar. Todo pasa en este navegador. */
export async function hashFile(file: Blob): Promise<FileHashes> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const px = await pixelsOf(file);
  const visual = [dhash64(px.data, px.w, px.h)];
  const rows = Math.round(photoRowsOf(px.origW, px.origH) * (px.h / px.origH));
  if (rows >= 8 && frameHeight(px.origW) < px.origH) visual.push(dhash64(px.data, px.w, rows));
  return { sha256: sha256Hex(bytes), visual, w: px.origW, h: px.origH, size: bytes.length, exif: exifSummary(bytes) };
}
