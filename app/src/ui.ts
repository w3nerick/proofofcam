import { icon } from './lib/icons';

/** Escapa texto para interpolarlo en HTML. Todo lo que viene de la cadena o de un archivo pasa por aquí. */
export function esc(s: unknown): string {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

export function $<T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document): T {
  const el = root.querySelector<T>(sel);
  if (!el) throw new Error(`falta ${sel}`);
  return el;
}

export const MARK = `<svg class="mark" viewBox="0 0 32 32" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M3 10V3h7M22 3h7v7M29 22v7h-7M10 29H3v-7"/><circle cx="16" cy="16" r="7.5"/></g><circle cx="16" cy="16" r="3.4" fill="var(--accent)"/></svg>`;

export function topbar(): string {
  const at = location.hash.replace(/^#\/?/, '').split('?')[0];
  const link = (path: string, label: string) =>
    `<a href="#/${path}"${at === path ? ' class="active" aria-current="page"' : ''}>${label}</a>`;
  return `
  <header class="topbar">
    <div class="shell topbar-in">
      <a class="brand" href="#/">${MARK}<span>proof of cam</span></a>
      <nav class="nav">${link('camara', 'Cámara')}${link('verificar', 'Verificar')}</nav>
    </div>
  </header>`;
}

export type Tone = 'ok' | 'bad' | 'warn' | 'wait' | 'idle';

export function tag(tone: Tone): string {
  const label = { ok: ' OK ', bad: 'FALLA', warn: ' !! ', wait: '', idle: ' -- ' }[tone];
  return `<span class="tag ${tone}" aria-hidden="true">[${tone === 'wait' ? '<i class="spin"></i>' : label}]</span>`;
}

export function row(tone: Tone, title: string, detail = ''): string {
  return `<div class="chk ${tone}">${tag(tone)}<div><b>${title}</b>${detail ? `<p>${detail}</p>` : ''}</div></div>`;
}

export const shortAddr = (a: string) => (a.length > 14 ? `${a.slice(0, 6)}…${a.slice(-6)}` : a);
export const shortHash = (h: string) => (h.length > 16 ? `${h.slice(0, 10)}…${h.slice(-6)}` : h);

export function toast(msg: string): void {
  document.querySelector('.toast')?.remove();
  const t = document.createElement('div');
  t.className = 'toast';
  t.setAttribute('role', 'status');
  t.textContent = msg;
  document.body.append(t);
  setTimeout(() => t.remove(), 2600);
}

/** Copia texto (permiso Clipboard pedido al arrancar). */
export async function copyText(text: string, done: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    toast(done);
  } catch {
    toast('No se pudo copiar: mantén presionado el texto para copiarlo');
  }
}

export const fmtBytes = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(2)} MB` : `${Math.round(n / 1e3)} KB`);
export const fmtBlock = (n: number | bigint) => `#${Number(n).toLocaleString('en-US')}`;

export function fmtDate(ms: number): string {
  return new Date(ms).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'medium' });
}

export function backLink(href: string, label: string): string {
  return `<a class="back" href="${href}">${icon('arrowLeft')}${label}</a>`;
}

export type Cleanup = () => void;
