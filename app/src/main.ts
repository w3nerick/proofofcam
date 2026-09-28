import '@fontsource-variable/dm-sans';
import '@fontsource/dm-serif-display/400.css';
import '@fontsource/space-mono/400.css';
import '@fontsource/space-mono/700.css';
import './style.css';
import { renderHome } from './views/home';
import { renderCamera } from './views/camera';
import { renderActa, renderFinder } from './views/verify';
import { renderDiagnostics } from './views/diagnostics';
import { requestHostPermissions } from './lib/permissions';
import { isId } from './lib/ids.ts';
import type { Cleanup } from './ui';

const root = document.getElementById('app')!;
let cleanup: Cleanup | undefined;

/**
 * Rutas por hash: la app se sirve desde su content hash y una ruta profunda sin
 * fallback daría 404. `#/f/<id>` es la que lleva el QR de cada foto; `?loc=`
 * trae una prueba de ubicación y vive en el fragmento, que el navegador nunca
 * manda a ningún servidor.
 */
function route() {
  cleanup?.();
  window.scrollTo(0, 0);
  const [path, query = ''] = location.hash.replace(/^#\/?/, '').split('?');
  const acta = /^f\/([a-z2-7]{16})$/.exec(path);
  if (path === 'camara') cleanup = renderCamera(root);
  else if (path === 'verificar') cleanup = renderFinder(root);
  else if (path === 'diagnostico') cleanup = renderDiagnostics(root);
  else if (acta && isId(acta[1])) cleanup = renderActa(root, acta[1], new URLSearchParams(query).get('loc'));
  else cleanup = renderHome(root);
}

requestHostPermissions();
window.addEventListener('hashchange', route);
route();
