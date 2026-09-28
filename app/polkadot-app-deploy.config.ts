/**
 * Config de producto para `pad`. Sin este archivo el deploy sube el contenido
 * pero no escribe el manifest ni los text records en DotNS.
 * `icon` es obligatorio y solo acepta png o jpeg.
 */
export default {
  domain: 'proofofcam.dot',
  displayName: 'Proof of Cam',
  description: 'Fotos con acta de nacimiento: firmadas por ti, ancladas a Polkadot y verificables con un QR. La foto se queda en tu teléfono.',
  icon: { path: './icon.png', format: 'png' },
  executables: [
    { kind: 'app', path: './dist', appVersion: [0, 1, 0] },
  ],
};
