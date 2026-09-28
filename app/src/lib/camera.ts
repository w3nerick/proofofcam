/**
 * Cámara dentro de la app (`getUserMedia`).
 *
 * Es el único camino que prueba que la foto se tomó aquí: el selector de
 * archivos también deja elegir fotos de la galería, incluidas las hechas con
 * IA. En Polkadot App el host concede la cámara al producto (RFC 0002;
 * Android: `onPermissionRequest` → Camera) y cada `getUserMedia` consume esa
 * autorización.
 *
 * Nada se graba: el visor solo se muestra en pantalla. Al disparar se toma un
 * cuadro y la cámara se apaga de inmediato (se apaga también el indicador del
 * sistema).
 */
import { askDevice } from './permissions';
import type { Facing } from './receipt';

export interface CameraInfo {
  width: number;
  height: number;
  facing: Facing;
  /** El navegador ofrece ImageCapture.takePhoto (resolución completa del sensor). */
  imageCapture: boolean;
}

export interface OpenCamera {
  stream: MediaStream;
  track: MediaStreamTrack;
  info: CameraInfo;
  stop(): void;
}

type ImageCaptureCtor = new (t: MediaStreamTrack) => { takePhoto(): Promise<Blob> };
const ImageCaptureApi = (globalThis as unknown as { ImageCapture?: ImageCaptureCtor }).ImageCapture;

export async function openCamera(facing: 'environment' | 'user'): Promise<OpenCamera> {
  const answer = await askDevice('Camera');
  if (answer === 'denied') throw new Error('Polkadot App no dio permiso para la cámara. Actívalo en los ajustes de la app.');
  if (answer === 'timeout') throw new Error('El host no respondió al permiso de cámara.');
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('Este contenedor no da acceso a la cámara.');
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: { ideal: facing }, width: { ideal: 3840 }, height: { ideal: 2160 } },
    audio: false,
  });
  const track = stream.getVideoTracks()[0];
  if (!track) {
    stream.getTracks().forEach(t => t.stop());
    throw new Error('La cámara no entregó video.');
  }
  const s = track.getSettings();
  const fm = s.facingMode;
  return {
    stream,
    track,
    info: {
      width: s.width ?? 0,
      height: s.height ?? 0,
      facing: fm === 'environment' ? 'back' : fm === 'user' ? 'front' : facing === 'environment' ? 'back' : 'front',
      imageCapture: typeof ImageCaptureApi === 'function',
    },
    stop: () => stream.getTracks().forEach(t => t.stop()),
  };
}

/** Lado mayor de la foto. Suficiente como evidencia y liviano para compartir. */
export const MAX_SIDE = 2560;

/**
 * Un cuadro de la cámara, en un canvas. Prueba primero `takePhoto` (sensor
 * completo, en Android); si no, el cuadro del video. Cualquier metadato que
 * trajera la cámara se pierde al pasar por el canvas: la foto sale limpia.
 */
export async function grabFrame(cam: OpenCamera, video: HTMLVideoElement): Promise<HTMLCanvasElement> {
  let source: CanvasImageSource | null = null;
  let w = 0;
  let h = 0;
  if (ImageCaptureApi) {
    try {
      const blob = await new ImageCaptureApi(cam.track).takePhoto();
      const bmp = await createImageBitmap(blob);
      source = bmp;
      w = bmp.width;
      h = bmp.height;
    } catch {
      source = null;
    }
  }
  if (!source) {
    w = video.videoWidth;
    h = video.videoHeight;
    if (!w || !h) throw new Error('La cámara todavía no entrega imagen.');
    source = video;
  }
  const scale = Math.min(1, MAX_SIDE / Math.max(w, h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Este navegador no da un canvas.');
  ctx.imageSmoothingQuality = 'high';
  // La cámara frontal se ve en espejo en el visor, pero la foto sale como es.
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  if ('close' in source && typeof source.close === 'function') source.close();
  return canvas;
}
