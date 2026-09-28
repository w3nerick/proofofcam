/**
 * Geohash: una ubicación como texto donde cada carácter más afina la celda.
 * Cortar el texto es bajar la precisión, que es justo lo que necesita la
 * divulgación por niveles (ver loc.ts). Se calcula en el teléfono: las
 * coordenadas no se mandan a ningún servicio.
 */
const BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz';

export function encodeGeohash(lat: number, lon: number, precision = 8): string {
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    throw new Error('coordenadas fuera de rango');
  }
  const la = [-90, 90];
  const lo = [-180, 180];
  let out = '';
  let bit = 0;
  let ch = 0;
  let even = true;
  while (out.length < precision) {
    const r = even ? lo : la;
    const v = even ? lon : lat;
    const mid = (r[0] + r[1]) / 2;
    if (v >= mid) {
      ch = (ch << 1) | 1;
      r[0] = mid;
    } else {
      ch <<= 1;
      r[1] = mid;
    }
    even = !even;
    if (++bit === 5) {
      out += BASE32[ch];
      bit = 0;
      ch = 0;
    }
  }
  return out;
}

export interface GeoCell {
  lat: [number, number];
  lon: [number, number];
  center: { lat: number; lon: number };
  /** Lado aproximado de la celda, en metros (el mayor de los dos). */
  sizeM: number;
}

export function isGeohash(s: string): boolean {
  return /^[0-9bcdefghjkmnpqrstuvwxyz]{1,12}$/.test(s);
}

export function decodeGeohash(hash: string): GeoCell {
  if (!isGeohash(hash)) throw new Error('geohash inválido');
  const la: [number, number] = [-90, 90];
  const lo: [number, number] = [-180, 180];
  let even = true;
  for (const c of hash) {
    const v = BASE32.indexOf(c);
    for (let b = 4; b >= 0; b--) {
      const r = even ? lo : la;
      const mid = (r[0] + r[1]) / 2;
      if ((v >> b) & 1) r[0] = mid;
      else r[1] = mid;
      even = !even;
    }
  }
  const center = { lat: (la[0] + la[1]) / 2, lon: (lo[0] + lo[1]) / 2 };
  const mPerDeg = 111_320;
  const h = (la[1] - la[0]) * mPerDeg;
  const w = (lo[1] - lo[0]) * mPerDeg * Math.cos((center.lat * Math.PI) / 180);
  return { lat: la, lon: lo, center, sizeM: Math.max(h, w) };
}

/** "~40 km", "~600 m". */
export function fmtMeters(m: number): string {
  if (m >= 10_000) return `~${Math.round(m / 1000)} km`;
  if (m >= 1000) return `~${(m / 1000).toFixed(1)} km`;
  return `~${Math.round(m)} m`;
}
