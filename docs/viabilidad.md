# ¿Es viable? ¿Para qué sirve?

Estado al 28 sep 2026. Veredicto corto: **técnicamente viable, y probado en un
iPhone**. La primera foto real se tomó y se selló desde Polkadot App en iOS:
acta `ckaaqtce3u7gukpz`, bloque 13,814,797, verificada con `npm run verify`.

## Lo que está probado

| Pieza | Evidencia |
|---|---|
| **Todo el flujo en iPhone** | Polkadot App iOS, 28 sep 2026: el host conecta con el códec 1, la cámara funciona dentro de la app, la firma y la transacción al contrato también. Acta `ckaaqtce3u7gukpz`: firma válida, coincide con su recibo, bloque previo #13,814,764 existe |
| Cuenta de producto con saldo | En iOS, la cuenta de producto de `proofofcam.dot` ya tenía 5,000 PAS en el devnet: el modo seudónimo no necesitó faucet |
| Contrato `PhotoRegistry` | Desplegado en el Asset Hub del devnet: `0xa0d30345400061439517417fc0a202adfe3ebb27`, bloque 13,812,904. Un sello simulado con un recibo de ~700 bytes pasa: depósito de 0.087 PAS y 6.8 G de peso |
| Firma con la identidad `.dot` y transacción a un contrato desde una app | Probado en Polkadot Desktop 0.1.3 con [testalk](https://github.com/w3nerick/testalk) (27 y 28 sep 2026). Proof of Cam usa el mismo camino: [`firma-y-cuentas.md`](firma-y-cuentas.md) |
| Cámara dentro de Polkadot App en Android | `getUserMedia` funciona dentro de un producto ([products-devnet-issues #7](https://github.com/Polkadot-Community-Foundation/products-devnet-issues/issues/7), Pixel 10 Pro XL, ago 2026); el host concede la cámara (`ProductWebChromeClient.onPermissionRequest` en la app Android) |
| La app completa en un navegador | Chrome con cámara simulada: la cámara se apaga al disparar; la foto sale sin EXIF; el QR estampado se lee en el original y en una copia recomprimida; la huella visual cambia 0–1 bits de 64 incluso reducida al 30 %; cero peticiones externas al abrir la app y al tomar una foto con ubicación |
| Pruebas | App: 7 (ids, geohash, huellas, ubicación, recibo). Contrato: 15 en EVM local. Ambas en CI |
| Sin Bulletin | El recibo va entero al contrato, así que el fallo de subida de archivos en Android ([#13](https://github.com/Polkadot-Community-Foundation/products-devnet-issues/issues/13)) no le afecta |

## Lo que falta probar

1. **Guardar la foto en la galería del iPhone.** En la primera prueba, la
   descarga (`<a download>`) no descargó: el WebView abrió la imagen encima de la
   app, sin forma de volver, y **la foto se perdió** (el acta quedó bien). Ahora
   en iPhone no se ofrece la descarga; se guarda con la hoja de compartir o
   manteniendo presionada la foto en un visor dentro de la app, y la app pide
   confirmación antes de soltar una foto sin guardar. Falta confirmar en el iPhone
   cuál de los dos caminos funciona.
2. **Android.** Mismo código; la cámara ya está medida por otros (#7).
3. **Ubicación.** Rota en Android (#7, el WebView del host no implementa el
   permiso de geolocalización) y sin medir en iOS. Es opcional: sin ella la app
   funciona igual.
4. **Protocolo a futuro.** La app habla el códec 1. El códec 2 no es compatible
   con el 1 (RFC 0027); cuando Polkadot App lo adopte, hará falta subir el SDK.

Todo esto lo mide `#/diagnostico` en cada teléfono y deja un reporte copiable.

**Peor caso:** aunque el celular falle, en Polkadot Desktop funciona hoy con la
cámara de la laptop. Como demo es viable en cualquier escenario.

## Límites del producto

- **No prueba que la escena sea real.** Una foto de una pantalla con una imagen
  hecha por IA queda firmada como cualquier otra: es el "agujero analógico", y
  tampoco lo resuelven C2PA, Leica ni el Pixel 10. Proof of Cam prueba quién,
  cuándo y que no cambió; la confianza en la escena viene de la reputación de
  quien firma.
- **No es un detector.** No dice nada de fotos que no se tomaron con la app.
- **El seudónimo no es anonimato** (ver [`privacidad.md`](privacidad.md#contra-quién-protege)).
- **Costo en mainnet.** Cada foto deja un depósito de almacenamiento. El
  contrato no borra actas, así que ese depósito queda bloqueado para siempre. En
  el devnet no importa; en producción hay que decidir quién lo paga o si las
  actas caducan.
- **Adopción.** Sirve si quien recibe la foto quiere verificarla. El QR
  estampado baja la fricción, pero hay que explicarlo.

## Para qué sirve

| Uso | Cómo se usa |
|---|---|
| **Periodismo y reportes ciudadanos** | Seudónimo, ubicación revelada solo a nivel ciudad. El acta prueba que la foto existía antes de que alguien diga que es falsa |
| **Evidencia de eventos** (por ejemplo, la UANL) | Firma con identidad y QR en la foto: quien la vea en redes sabe quién la tomó y cuándo |
| **Seguros, peritajes, avance de obra** | Identidad y ubicación revelada al nivel "punto" solo a la aseguradora o al cliente; la cota de tiempo sale de la cadena, no del teléfono |
| **Derechos humanos** | Seudónimo fondeado desde el faucet y ubicación apagada o a nivel región. Es el uso de ProofMode, con identidad opcional y verificación sin instalar nada |
| **Fact-checking con Firefly** | Firefly (Parity) es verificación anónima de hechos por humanos verificados. Proof of Cam puede ser su cámara de evidencia; con alias de Individuality, cada foto la firmaría un humano real sin decir quién |

## Frente a lo que ya existe

| | Identidad | Instalar | Verificar | Ubicación |
|---|---|---|---|---|
| [ProofMode](https://guardianproject.info/apps/org.witness.proofmode/) | Llave PGP del teléfono | App Android/iOS | Herramientas propias | Guardada en claro en los metadatos |
| [Capture / ProofSnap](https://captureapp.xyz/) | Cuenta de Numbers | App | Su plataforma | En metadatos C2PA |
| [Pixel 10](https://blog.google/security/pixel-android-trusted-images-c2pa-content-credentials/) (C2PA) | Anónima (certificado del teléfono) | Viene en el teléfono | Visores C2PA | En EXIF, si está activa |
| **Proof of Cam** | Username `.dot` verificable, o seudónimo | Nada: vive dentro del wallet | Un QR, en cualquier navegador | Cifrada; su dueño revela un nivel a la vez |

Lo que aporta Proof of Cam: un nombre humano en lugar de una llave suelta, cero
instalación, verificación sin intermediarios y la ubicación por niveles, que no
hace ninguno de los otros.

Lo que tienen los otros: el Pixel 10 firma con una llave en el chip de seguridad
del teléfono (C2PA nivel 2), algo que una app web no puede hacer. Proof of Cam
confía en el host.

## Plan

1. ~~Deploy de la app y primera foto en iPhone~~ (hecho el 28 sep 2026).
   Falta: confirmar cómo se guarda la foto en iPhone y probar en Android.
2. **Prueba con gente real**, por ejemplo fotos del evento de la UANL: si los
   estudiantes entienden el QR y el acta sin explicación.
3. **Individuality y Coinage** cuando estén en el devnet: alias de persona única
   y pagos sin rastro. Con los dos, el seudónimo pasa a anonimato real.
4. **Firefly**: explorar la integración como cámara de evidencia.
5. **Mainnet**: decidir el modelo de costo (quién paga el depósito, si las
   actas caducan).
6. **Contra el agujero analógico** (fase 2, sin prometer nada): detección de
   pantallas (moiré), o una ráfaga con movimiento y giroscopio.
