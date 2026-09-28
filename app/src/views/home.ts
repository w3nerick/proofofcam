import { icon } from '../lib/icons';
import { topbar, type Cleanup } from '../ui';

export function renderHome(root: HTMLElement): Cleanup {
  root.innerHTML = `${topbar()}
  <main>
    <section class="shell hero">
      <span class="kicker">Prueba de origen en Polkadot</span>
      <h1>Fotos con <em>acta de nacimiento.</em></h1>
      <p class="lead">Cada foto que tomas aquí sale firmada por ti y anclada a un bloque de Polkadot, con un QR para verificarla. La foto se queda en tu teléfono: en la cadena solo queda su huella.</p>
      <div class="actions">
        <a class="btn accent big" href="#/camara">${icon('camera')}Abrir la cámara</a>
        <a class="btn big" href="#/verificar">${icon('magnifyingGlass')}Verificar una foto</a>
      </div>
    </section>

    <section class="shell grid3">
      <div class="card feature">
        ${icon('lockSimple')}
        <h3>Tu foto no sale de tu teléfono</h3>
        <p>No se sube a ningún servidor ni a la cadena. Se sellan dos huellas: una exacta y una visual, que reconoce la foto aunque un chat la recomprima.</p>
      </div>
      <div class="card feature">
        ${icon('eyeSlash')}
        <h3>Sin ubicación, salvo que tú quieras</h3>
        <p>Viene apagada. Si la activas, se sella cifrada y tú decides después qué revelar: región, ciudad, barrio o punto. Nadie más puede abrirla.</p>
      </div>
      <div class="card feature">
        ${icon('detective')}
        <h3>Con tu nombre o con un seudónimo</h3>
        <p>Firma con tu identidad <span class="mono">.dot</span>, o con la cuenta de esta app, que nadie puede ligar a tu nombre. Sin EXIF, sin modelo de teléfono, hora en UTC.</p>
      </div>
    </section>

    <section class="shell proves">
      <div class="card">
        <h3>Qué prueba</h3>
        <ul>
          <li>Quién la tomó: tu firma, comprobada en People chain.</li>
          <li>Cuándo: después de un bloque que el teléfono vio al disparar y antes del bloque del sello.</li>
          <li>Que no cambió: ni un píxel desde que se firmó.</li>
          <li>Que salió de la cámara de la app: aquí no se puede sellar una foto de la galería.</li>
        </ul>
      </div>
      <div class="card">
        <h3>Qué no prueba</h3>
        <ul>
          <li>Que la escena sea real: una foto de una pantalla con una imagen hecha por IA también queda firmada.</li>
          <li>El lugar: el GPS lo declara el teléfono; se prueba que tú lo dijiste en ese momento.</li>
          <li>Nada sobre fotos que no se tomaron aquí: esto es un acta de nacimiento, no un detector.</li>
        </ul>
      </div>
    </section>

    <footer class="shell foot">
      <span>Proof of Cam · Products Devnet</span>
      <a href="#/diagnostico">Diagnóstico del dispositivo</a>
    </footer>
  </main>`;
  return () => undefined;
}
