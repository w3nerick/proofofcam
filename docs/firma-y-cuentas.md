# Cómo se firma una foto: identidad y cuentas de producto

La duda más común: cuando firmas en Proof of Cam, ¿queda tu username o una
dirección? La respuesta corta: **siempre firma una dirección**. El username no
es una llave, es una etiqueta pública que apunta a una dirección.

## Dos tipos de cuenta en Polkadot App

```
                 Tu frase secreta (solo en tu teléfono, en Polkadot App)
                                   │
             ┌─────────────────────┴──────────────────────┐
             ▼                                            ▼
    CUENTA DE IDENTIDAD                         CUENTAS DE PRODUCTO
    5Fid…                                       una distinta por cada app:
    la misma en todas las apps                   proofofcam.dot   → 5Gaa…
             │                                   otra-app.dot     → 5Hbb…
             ▼                                   tercera-app.dot  → 5Fcc…
    People chain:
    "ana.01" → 5Fid…
```

**Cuenta de identidad.** Es la dueña de tu username. En People chain queda
registrado que `ana.01` pertenece a `5Fid…`, y cualquiera puede consultarlo
(`Resources.UsernameOwnerOf`).

**Cuentas de producto.** Polkadot App deriva de tu frase secreta una dirección
distinta para cada app, según su dominio (RFC 0022). Por defecto una app **solo
ve su propia cuenta de producto**, nunca tu identidad: así ninguna app puede
seguirte de una a otra. Para firmar con tu identidad, la app se lo pide al host
(`getLegacyAccountSigner`) y tú lo apruebas en Polkadot App.

## Qué queda guardado en Proof of Cam

Al sellar eliges con qué firmar:

| | Con mi identidad | Con seudónimo |
|---|---|---|
| Llave que firma | Tu identidad (`5Fid…`) | La cuenta de producto de `proofofcam.dot` (`5Gaa…`) |
| Username en el recibo | `ana.01` | Vacío |
| Quién paga el sello | Tu identidad | La cuenta de producto, con su propio saldo |
| Qué ve quien verifica | "Tomada por **ana.01** ✓" | "Tomada con seudónimo `5Gaa…`" |
| ¿Se liga a tu nombre? | Sí, a propósito | No |
| ¿Tus fotos se ligan entre sí? | Sí | Sí: todas tus fotos seudónimas usan la misma dirección |

En la cadena (`PhotoRegistry`) quedan la llave que firmó, la firma, el recibo y
la cuenta que mandó la transacción. El username, si lo hay, va dentro del
recibo.

**Por qué el seudónimo paga su propia transacción:** si la pagara tu identidad,
la transacción misma diría de quién es el seudónimo. Por la misma razón, no hay
que mandarle saldo desde tu identidad: esa transferencia también los ligaría.

## Cómo se comprueba el nombre

El recibo *dice* `ana.01`, pero eso lo podría escribir cualquiera. El
verificador hace dos comprobaciones:

1. **La firma**: que el recibo esté firmado por la llave guardada (sr25519).
2. **El dueño del nombre**: le pregunta a People chain de quién es `ana.01`.
   Si contesta esa misma llave, marca ✓. Si contesta otra, marca
   **"Identidad falsa"**. Si no responde, marca "sin comprobar", no "falso".

Es el mismo mecanismo de [testalk](https://github.com/w3nerick/testalk),
probado en Polkadot Desktop el 28 sep 2026.

## El tercer tipo de cuenta: alias de persona única

Polkadot está construyendo **Individuality**: prueba de persona sin biometría,
con ring-VRF sobre Bandersnatch (`create_account_proof`, RFC 0004). Da a cada
humano verificado un **alias distinto en cada contexto**. Firmar una foto con un
alias así probaría "la tomó un humano real" sin decir quién ni ligar una foto
con otra. Es el seudónimo ideal para Proof of Cam; todavía no funciona en el
devnet. Ver [`privacidad.md`](privacidad.md#lo-que-falta-para-cerrar-los-huecos).
