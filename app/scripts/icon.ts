/**
 * Ícono de Proof of Cam: las esquinas del visor de una cámara, el lente y el
 * punto del sello en rojo. La marca de la barra superior (src/ui.ts, MARK) es el
 * mismo dibujo en currentColor.
 *
 *   npm run icon
 *
 * Salida: icon.png (512 px, manifest de pad), public/icon.png,
 * public/brand/favicon.svg y public/brand/favicon-32.png.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import resvg from '@resvg/resvg-js';

const APP = join(dirname(fileURLToPath(import.meta.url)), '..');
const INK = '#141414';
const PAPER = '#f3f0e8';
const SEAL = '#d6402a';

const svg = (size: number, radius: number) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 32 32">
  <rect width="32" height="32" rx="${radius}" fill="${INK}"/>
  <g fill="none" stroke="${PAPER}" stroke-width="2" stroke-linecap="round">
    <path d="M6 10.5V6h4.5M21.5 6H26v4.5M26 21.5V26h-4.5M10.5 26H6v-4.5"/>
    <circle cx="16" cy="16" r="6.4"/>
  </g>
  <circle cx="16" cy="16" r="3" fill="${SEAL}"/>
</svg>`;

mkdirSync(join(APP, 'public/brand'), { recursive: true });
const big = new resvg.Resvg(svg(512, 7), { fitTo: { mode: 'width', value: 512 } }).render().asPng();
writeFileSync(join(APP, 'icon.png'), big);
writeFileSync(join(APP, 'public/icon.png'), big);
writeFileSync(join(APP, 'public/brand/favicon.svg'), svg(32, 7));
writeFileSync(join(APP, 'public/brand/favicon-32.png'), new resvg.Resvg(svg(32, 7), { fitTo: { mode: 'width', value: 32 } }).render().asPng());
console.log('icon.png, public/icon.png, public/brand/favicon.svg, public/brand/favicon-32.png');
