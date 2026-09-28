# Modelo de privacidad

Proof of Cam parte de una regla: **probar sin exponer**. Cada dato que la app toca
tiene que justificar por qué sale del teléfono; si no puede, no sale.

## Qué sale del teléfono y qué no

| Dato | ¿Sale? | Cómo |
|---|---|---|
| La foto | **No** | Se queda en memoria hasta que la guardas; al salir de la pantalla se suelta la URL local |
| EXIF (GPS, modelo, serie) | **No existe** | La foto pasa por un canvas, que no copia metadatos. El diagnóstico lo comprueba en cada teléfono |
| Huella exacta (sha256) | Sí, al contrato | No permite reconstruir la foto; solo confirmar una copia idéntica |
| Huella visual (dHash, 64 bits) | Sí, al contrato | Resume una cuadrícula de 9×8 tonos; no permite reconstruir nada reconocible |
| Hora | Sí, en UTC y sin milisegundos | Sin zona horaria, que revelaría la región |
| Bloque previo | Sí | Es la cota inferior de tiempo; es público por naturaleza |
| Quién | Username `.dot` **o** nada | En modo seudónimo firma la cuenta de producto de la app |
| Resolución, tamaño, cámara | **No** | Dirían qué teléfono es, y quien tenga la foto los lee de ella. Una prueba del repo falla si vuelven al recibo |
| Ubicación | Solo si la activas, y nunca en claro | Ver abajo |

La app no tiene servidor, no carga fuentes ni scripts de terceros, no guarda
nada en el navegador (ni `localStorage` ni cookies) y no usa analítica. Medido
el 28 sep 2026 con Chrome: abrir la app hace **cero** peticiones externas, y
tomar una foto con ubicación tampoco. Las únicas conexiones son a la cadena y,
si el usuario lo pide, a OpenStreetMap para ver una zona.

**Por dónde se lee la cadena.** Dentro de Polkadot App, Polkadot Desktop o el
gateway `.dev-dot.li`, por el cliente ligero del host: sin un intermediario que
vea qué consultas. En un navegador normal, o si el host falla, por un RPC
público: su operador ve la IP y qué acta se consulta. El acta dice en cada caso
por dónde se consultó. El fragmento del enlace (`#/f/<id>?loc=…`) nunca llega a
ningún servidor, ni siquiera al gateway.

## Ubicación por niveles

Si se activa, el teléfono pide la posición al sistema y la convierte en un
geohash de 8 caracteres (una celda de ~38×19 m). Las coordenadas se descartan
en ese momento.

En el recibo público van dos cosas:

- **`root`**: sha256 de cuatro compromisos, uno por nivel (región: 3
  caracteres, ciudad: 4, barrio: 6, punto: 8). Cada compromiso es
  `sha256("proofofcam/loc/v1|nivel|prefijo|" ‖ sal)` con una sal de 32 bytes.
  Sin la sal no se puede comprobar ninguna ciudad candidata: probar todas las
  ciudades del mundo no sirve.
- **`box`**: el geohash cifrado con XChaCha20-Poly1305.

La **llave maestra** no se guarda: el host la deriva de la cuenta raíz del
usuario y del dominio de la app (`deriveEntropy`, RFC 0007). De ella salen, por
foto, la llave de cifrado y las sales de cada nivel (BLAKE2b con llave). Mismo
usuario y misma app, en cualquier teléfono: misma llave. Otra app no puede
calcularla.

**Revelar un nivel** es entregar su prefijo, su sal y los cuatro compromisos
(que por sí solos no dicen nada). El verificador recalcula ese compromiso y la
raíz. Los otros niveles siguen ocultos, porque sus sales son distintas. La
prueba viaja en el fragmento del enlace (`#/f/<id>?loc=…`), que el navegador no
manda a ningún servidor.

Si el GPS es impreciso, la app no deja prometer más de lo que sabe: con ±500 m
el nivel "punto" no se puede revelar. Los niveles imposibles se rellenan con
valores derivados de la llave, indistinguibles de un compromiso real.

## El registro es público

`PhotoRegistry` no tiene dueño, administrador ni forma de borrar o censurar un
acta. La otra cara es que es público: cualquiera puede listar las actas, y con
ellas cuántas fotos firmó una identidad y cuándo (no qué fotos: sin la foto, las
huellas no dicen nada). Si no quieres eso, usa el seudónimo.

## Seudónimo

La cuenta de producto que el host deriva para `proofofcam.dot` firma igual
que la identidad, pero nadie puede ligarla a un username. Lo que sí queda ligado
es una foto seudónima con otra: comparten llave y la misma cuenta paga. Para que
el seudónimo siga sin ligarse a tu nombre:

- **Paga su propia transacción.** Si la pagara la identidad, la transacción
  misma diría de quién es. Por eso necesita su propio saldo.
- **No la fondees desde tu identidad.** Esa transferencia también las ligaría.
  Mejor el faucet.

## Qué no protege

- **La foto misma.** Si la foto muestra una cara, una placa o una calle, eso
  viaja con ella a quien la compartas. Proof of Cam prueba su origen; no la anonimiza.
- **El host.** Polkadot App y Desktop ven lo que la app les pide firmar y la
  cámara que concedieron. Es el mismo modelo de confianza que el wallet.
- **Correlación por tiempo.** El bloque del sello es público; quien vea que
  alguien selló a cierta hora puede relacionar eventos. El seudónimo reduce esto,
  pero no lo elimina.
- **La llave raíz.** Si alguien obtiene tu frase semilla puede derivar la
  llave de ubicación y abrir todas tus ubicaciones selladas.
- **El servicio de ubicación del sistema.** Al activar la ubicación, el
  teléfono puede consultar a Apple o Google para calcularla. Eso pasa fuera de
  la app; por eso viene apagada.
- **El agujero analógico.** Una foto de una pantalla queda firmada como
  cualquier otra. La firma prueba quién y cuándo, no que la escena sea real.

## Lo que falta para cerrar los huecos

Dos piezas del stack de Polkadot resuelven lo que hoy queda abierto. Ninguna
funciona todavía en el devnet:

- **Alias de persona única** (Individuality, ring-VRF sobre Bandersnatch;
  `create_account_proof`, RFC 0004). Firmar como "un humano verificado",
  distinto en cada contexto: prueba que la foto no la sacó un bot, sin decir
  quién ni ligar una foto con otra. Es el seudónimo ideal.
- **Pagos con Coinage** (RFC 0017). El sello lo pagaría una moneda que no
  deja rastro de quién la gastó, así la cuenta que paga dejaría de ligar las
  fotos seudónimas entre sí.
