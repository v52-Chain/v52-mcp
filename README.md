# v52-mcp

Servidor MCP (Model Context Protocol) de Vector52 para clientes **locales**, con transporte `stdio`.

> Estado: preparado para desarrollo y pruebas en **Avalanche Fuji**. No uses claves ni fondos reales.

## Qué incluye

- Transporte MCP `stdio` (entrada/salida estándar): el cliente MCP lanza el proceso y habla JSON-RPC por `stdin`/`stdout`.
- Herramientas de producto: `vector52_status` y `vector52_wallet_flow`.
- Herramientas gratuitas del contrato MCP: `case_status`, `evidence_get`, `anchor_lookup` y `package_verify`.
- Herramientas de diagnóstico: `avalanche_x402_status` y `avalanche_x402_fetch`.
- Política local que valida red, token, precio, destinatario y URL antes de firmar.

## Arquitectura

```text
Cliente MCP local (Claude Desktop, Codex CLI, etc.)
        |
        | stdio (stdin/stdout, JSON-RPC)
        v
v52-mcp ── vector52_wallet_flow ──> v52-backend
   |                                      |
   |                                      | HTTP 402 + PAYMENT-REQUIRED
   |                                      v
   └── wallet de agente ──> facilitator ──> Avalanche Fuji
                                               |
                                               v
                                          HTTP 200 + reporte
```

El proceso `v52-mcp` no abre ningún puerto ni acepta conexiones de red entrantes: el cliente MCP lo lanza como subproceso local y se comunica exclusivamente por `stdin`/`stdout`. Las únicas conexiones de red que hace el propio proceso son salientes: hacia el backend de Vector52, el facilitator x402 y el RPC de Avalanche Fuji.

La demo vende un reporte por `0.01 USDC` de prueba. El cliente recibe un `HTTP 402 Payment Required` (saliente, hacia el backend o el facilitator), valida localmente las condiciones y solo después firma una autorización EIP-3009. El facilitator verifica y liquida la operación en Fuji; la clave privada nunca se envía al facilitator ni a ningún tercero.

## Requisitos

- Node.js 22 o superior.
- npm.
- Una wallet EVM de **desarrollo** con AVAX Fuji (gas) y USDC Fuji de prueba para pagar.
- Una dirección pública Fuji receptora para `X402_MERCHANT_ADDRESS` (solo necesaria para la demo local de pago).

## Instalación y arranque

Este servidor **no se ejecuta sobre HTTP**: no escuches ni abras ningún puerto para usarlo. Un cliente MCP local lo inicia como subproceso (ver "Conectar el MCP a un cliente local"). Hay dos formas de obtenerlo:

**Opción A — vía npm (recomendada para usuarios finales), sin clonar el repo:**

```bash
npx -y v52-mcp
```

Un cliente MCP normalmente no lo ejecutas tú a mano: solo configuras `command: "npx", args: ["-y", "v52-mcp"]` en tu cliente (ver "Conectar el MCP a un cliente local") y él lo descarga y lanza automáticamente.

**Opción B — clonando el repositorio (para desarrollo):**

```bash
git clone https://github.com/v52-Chain/v52-mcp.git
cd v52-mcp
cp .env.example .env
npm install
npm run build
```

Para probarlo manualmente desde una terminal (sin cliente MCP), puedes enviarle mensajes JSON-RPC delimitados por línea por `stdin`:

```bash
node dist/index.js
```

El proceso se queda a la espera leyendo `stdin`. Los logs de diagnóstico (si `X402_DEBUG=true`) y el aviso de arranque se escriben en `stderr`, nunca en `stdout`, para no interferir con el protocolo JSON-RPC.

## Configuración (variables de entorno)

`.env` es privado y está ignorado por Git. Parte siempre de [`.env.example`](.env.example). Todas las claves y parámetros sensibles se leen del entorno del proceso; el servidor nunca acepta una llave privada u otro secreto a través de una petición.

**En la práctica, solo existe una variable que de verdad necesitas configurar:**

```dotenv
X402_AGENT_PRIVATE_KEY=0x...
```

Sin ella, el servidor arranca igual y todas las tools gratuitas funcionan (`saludar`, `estado_servidor`, `case_status`, `evidence_get`, `anchor_lookup`, `package_verify`); solo quedan deshabilitadas las que pagan (`vector52_wallet_flow`, `avalanche_x402_fetch`).

Red, chain ID, el contrato USDC de Fuji **y el backend de Vector52** no son configurables: están fijos en el código porque solo existe un valor válido/soportado para cada uno. No son variables de entorno "inútiles" que sobrevivieron por descuido — directamente no existen.

| Variable | Propósito | Requerida |
| --- | --- | --- |
| `X402_AGENT_PRIVATE_KEY` | Clave privada que firma los pagos x402. Este servidor es el **cliente/pagador** (el agente), nunca el backend: la firma tiene que ocurrir aquí porque x402 es no-custodial y nadie firma en tu nombre. Debe pertenecer solo a una wallet de prueba. | **Sí**, es la única variable que necesitas para pagar (`vector52_wallet_flow`, `avalanche_x402_fetch`). |
| `AVALANCHE_RPC_URL` | RPC de Fuji. | No — tiene un endpoint público por defecto; solo cámbialo si está limitado o quieres tu propio proveedor. |
| `X402_MAX_PAYMENT_USDC` / `X402_MAX_SESSION_SPEND_USDC` | Topes de seguridad por pago / por proceso. | No, ya tienen default (`0.05` / `0.10`). |
| `X402_ALLOWED_HOSTS` | Hosts HTTPS externos (además del backend de Vector52) que `avalanche_x402_fetch` puede pagar. | No, vacío por defecto (nada externo permitido). |
| `X402_ALLOW_LOCALHOST` | Permite `localhost` como destino de pago — solo relevante para el fixture local de abajo. | No. |
| `X402_DEBUG` | Escribe trazas de diagnóstico x402 en `stderr` (nunca en `stdout`). | No. |

El backend que consumen todas las tools de Vector52 (`case_status`, `evidence_get`, `anchor_lookup`, `package_verify`, `vector52_wallet_flow`, `vector52_status`) es siempre `https://v52-backend.onrender.com` — hardcodeado en `src/vector52/backend.ts`, no lo elige el prompt del agente ni una variable de entorno.

**Solo si vas a correr el fixture local de pruebas** (`npm run x402:demo` / `x402:test`, ver la siguiente sección) — nunca los usa el servidor MCP ni sus tools:

| Variable | Propósito |
| --- | --- |
| `X402_FACILITATOR_URL` | Facilitator que verifica y liquida el pago **del fixture local**. En producción, `v52-backend` habla con su propio facilitator del lado servidor; este MCP nunca se conecta a uno directamente — solo firma y reenvía la petición HTTP. |
| `X402_MERCHANT_ADDRESS` | Dirección que recibe el pago **en el fixture local**. En el flujo real el `payTo` lo entrega dinámicamente `v52-backend` en su respuesta `402`; nunca sale de tu `.env`. |
| `X402_DEMO_URL` / `X402_DEMO_PORT` | Dónde escucha el fixture local. |

El contrato USDC de Fuji usado internamente es `0x5425890298aed601595a70AB815c96711a31Bc65` (6 decimales, hardcodeado). Los tokens de testnet no tienen valor real; consulta la [documentación de Circle](https://developers.circle.com/stablecoins/usdc-contract-addresses).

## Herramientas MCP

| Herramienta | Entrada | Efecto |
| --- | --- | --- |
| `saludar` | `{ "nombre": "Ana" }` | Devuelve un saludo. |
| `estado_servidor` | `{}` | Devuelve estado y timestamp. |
| `vector52_status` | `{}` | Verifica MCP, backend, precio y saldo sin pagar. |
| `vector52_wallet_flow` | `{ "targetAddress": "0x…", "limit": 25 }` | Descubre el precio y ejecuta una investigación pagada por x402. |
| `avalanche_x402_status` | `{}` | Muestra configuración pública, dirección del agente y balances. No firma ni paga. |
| `avalanche_x402_fetch` | `{ "url": "…", "maxPaymentUsdc": "0.01" }` | Solicita un recurso x402 permitido y puede efectuar un pago. |
| `case_status` | `{ "caseId": "v52_..." }` | Llama `GET /v1/cases/{case_id}` en el backend de Vector52. Gratuito, sin pago. |
| `evidence_get` | `{ "caseId": "v52_..." }` | Llama `GET /v1/cases/{case_id}/evidence` en el backend de Vector52. Gratuito, sin pago. |
| `anchor_lookup` | `{ "manifestRoot": "0x..." }` | Llama `GET /v1/anchors/{manifest_root}` en el backend de Vector52. Consulta pública sobre HSK, gratuita, sin pago ni llave firmante. |
| `package_verify` | `{ "fileBase64": "...", "fileName": "case.v52.zip" }` | Sube el `.v52.zip` (Base64) a `POST /v1/verify` en el backend de Vector52 y devuelve `PASS`/`FAIL` con los errores de integridad. Gratuito, sin pago. |

`maxPaymentUsdc` es opcional, pero solo puede disminuir el tope configurado en el servidor; nunca aumentarlo. Para integración de producto usa `vector52_wallet_flow`: la herramienta genérica queda solo para diagnóstico.

De los 6 tools documentados en `CONTRATO-INTEGRACION.md` ("MCP mapping"), `edge_explain` y `claim_audit` **no** están implementados todavía: el backend no expone `GET /v1/cases/{id}/graph` ni un `POST /v1/paid/claim-audit` protegido con x402 (ver `v52-backend/docs/X402_MCP.md` §1, Nivel 3 "documentado pero no implementado en código"). Se agregarán cuando esos endpoints existan del lado del backend.

## Probar x402 localmente (sin un cliente MCP)

El servidor MCP en sí no expone HTTP, así que hay un pequeño fixture separado (`src/scripts/serve-x402-demo.ts`) solo para pruebas manuales del flujo de pago x402.

En una terminal, levanta el fixture de pago:

```bash
npm run x402:demo
```

En otra terminal, comprueba el challenge sin pagar:

```bash
curl -i http://localhost:8080/demo/x402/premium-report
```

La respuesta correcta es `HTTP/1.1 402 Payment Required` e incluye el header `PAYMENT-REQUIRED`.

Cuando la wallet de agente tenga AVAX Fuji y USDC Fuji de prueba, realiza el recorrido completo (con el fixture anterior aún corriendo):

```bash
npm run x402:test
```

Esta orden firma y liquida **0.01 USDC de prueba**. Una ejecución correcta termina con `TEST PASSED`, un `HTTP 200` y, cuando el facilitator lo devuelve, un hash de transacción.

## Conectar el MCP a un cliente local

Este servidor habla `stdio`: el cliente MCP lo lanza como subproceso y le habla por `stdin`/`stdout`. No hay URL ni puerto que configurar. La forma recomendada para cualquier usuario (sin clonar el repo) es vía `npx`.

### Claude Desktop / Claude Code / Codex, vía npx (recomendado)

Edita la configuración de servidores MCP del cliente (`claude_desktop_config.json`, o el `[mcp_servers]` de Codex) y añade:

```json
{
  "mcpServers": {
    "v52_mcp": {
      "command": "npx",
      "args": ["-y", "v52-mcp"],
      "env": {
        "X402_AGENT_PRIVATE_KEY": "0x..."
      }
    }
  }
}
```

`npx` descarga y cachea la versión publicada de `v52-mcp` la primera vez y la reutiliza después; no necesitas instalar nada a mano ni mantener una ruta local. Sin `X402_AGENT_PRIVATE_KEY` el servidor arranca igual: solo quedan deshabilitadas las tools que pagan (`vector52_wallet_flow`, `avalanche_x402_fetch`), el resto funciona sin configuración.

Reinicia la aplicación después de guardar.

### Desde el repositorio clonado (desarrollo)

Si estás desarrollando sobre este repo en vez de usar el paquete publicado, apunta directo al `dist/index.js` compilado:

```json
{
  "mcpServers": {
    "v52_mcp": {
      "command": "node",
      "args": ["/ruta/absoluta/a/v52-mcp/dist/index.js"],
      "env": {
        "X402_AGENT_PRIVATE_KEY": "0x..."
      }
    }
  }
}
```

Recuerda correr `npm run build` cada vez que cambies el código, para que `dist/index.js` quede actualizado.

### Codex CLI (`config.toml`)

Codex también admite servidores MCP locales lanzados por comando. Añade en `~/.codex/config.toml` (o en `.codex/config.toml` del proyecto):

```toml
[mcp_servers.v52_mcp]
command = "npx"
args = ["-y", "v52-mcp"]
startup_timeout_sec = 20
tool_timeout_sec = 60
default_tools_approval_mode = "prompt"

[mcp_servers.v52_mcp.env]
X402_AGENT_PRIVATE_KEY = "0x..."

# La consulta de estado no gasta fondos.
[mcp_servers.v52_mcp.tools.avalanche_x402_status]
approval_mode = "approve"
```

Reinicia Codex después de guardar. En Codex, usa `/mcp` para confirmar que `v52_mcp` aparece conectado.

### Usar las herramientas

Primero verifica el estado sin realizar pagos:

```text
Usa la herramienta avalanche_x402_status y muéstrame el estado público de Avalanche Fuji.
```

Para probar la herramienta gratuita:

```text
Usa saludar con nombre "Vector52".
```

No configures `avalanche_x402_fetch` ni `vector52_wallet_flow` con aprobación automática: pueden firmar un pago. El cliente MCP debe pedir confirmación antes de ejecutarlas.

## Política de pago y seguridad

Antes de firmar, `avalanche_x402_fetch` rechaza:

- una red distinta de Avalanche Fuji (`eip155:43113`);
- activos distintos al USDC Fuji configurado;
- requisitos x402 malformados;
- precios superiores a los límites definidos;
- URLs `file:`, hosts privados o de loopback no permitidos y hosts HTTPS fuera de `X402_ALLOWED_HOSTS`;
- destinatarios o tiempos de expiración inválidos.

La clave privada y las firmas no se incluyen en la salida de las herramientas. El límite por sesión se mantiene en memoria del proceso; para múltiples réplicas se requiere un control de gasto transaccional compartido antes de usar fondos o límites de producción.

Si alguna clave privada se expone, considérala comprometida: crea una wallet de prueba nueva y no vuelvas a usarla.

## Validación del proyecto

```bash
npm run build
npm test
```

## Diagnóstico rápido

| Mensaje o síntoma | Causa probable | Acción |
| --- | --- | --- |
| `X402_AGENT_PRIVATE_KEY debe ser una clave privada EVM válida` | Falta el prefijo `0x`, la clave no tiene 64 caracteres hexadecimales o se pegó una dirección pública. | Usa una wallet nueva de prueba y configura `0x` + 64 caracteres. |
| El cliente MCP no ve ninguna tool / se queda "conectando" | El cliente no está lanzando el proceso correctamente o `dist/index.js` no existe todavía. | Corre `npm run build` y verifica la ruta absoluta en `command`/`args`. |
| `HTTP 503` en el fixture de `npm run x402:demo` | Faltan `X402_FACILITATOR_URL` o `X402_MERCHANT_ADDRESS` (solo las necesita el fixture local, no el servidor MCP). | Revisa `.env` y reinicia `npm run x402:demo`. |
| `USDC: 0` | La wallet no tiene USDC Fuji. | Solicita USDC de prueba en el faucet de Circle. |
| `URL_REJECTED` | El host externo no está en la lista permitida. | Añade el hostname exacto a `X402_ALLOWED_HOSTS`; para local usa solo desarrollo. |
| Aparece salida no-JSON en `stdout` y el cliente MCP falla al parsear | Algún código nuevo llamó a `console.log`/`console.info` dentro del proceso del servidor. | Usa siempre `console.error` (stderr) para logs; `stdout` está reservado para JSON-RPC. |

## Referencias

- [Especificación MCP — transporte stdio](https://modelcontextprotocol.io/docs/concepts/transports)
- [USDC en Avalanche Fuji — Circle](https://developers.circle.com/stablecoins/usdc-contract-addresses)
- [Guía de pruebas x402 de este proyecto](docs/X402_AVALANCHE_TEST.md)
