# v52-mcp

Servidor HTTP compatible con Model Context Protocol (MCP) para Vector52.

> Estado: preparado para desarrollo y pruebas en **Avalanche Fuji**. No uses claves ni fondos reales.

## Qué incluye

- Endpoint MCP HTTP: `POST /mcp`.
- Estado del servicio: `GET /health`.
- Demo de recurso de pago x402: `GET /demo/x402/premium-report`.
- Herramientas MCP gratuitas: `saludar` y `estado_servidor`.
- Herramientas x402: `avalanche_x402_status` y `avalanche_x402_fetch`.
- Política local que valida red, token, precio, destinatario y URL antes de firmar.

## Arquitectura

```text
Codex / cliente MCP
        |
        | MCP HTTP (/mcp)
        v
v52-mcp ── avalanche_x402_fetch ──> recurso x402
   |                                      |
   |                                      | HTTP 402 + PAYMENT-REQUIRED
   |                                      v
   └── wallet de agente ──> facilitator ──> Avalanche Fuji
                                               |
                                               v
                                          HTTP 200 + reporte
```

La demo vende un reporte por `0.01 USDC` de prueba. El cliente recibe un `HTTP 402 Payment Required`, valida localmente las condiciones y solo después firma una autorización EIP-3009. El facilitator verifica y liquida la operación en Fuji; la clave privada nunca se envía al facilitator.

## Requisitos

- Node.js 22 o superior.
- npm.
- Una wallet EVM de **desarrollo** con AVAX Fuji (gas) y USDC Fuji de prueba para pagar.
- Una dirección pública Fuji receptora para `X402_MERCHANT_ADDRESS`.

## Instalación y arranque

```powershell
Copy-Item .env.example .env
npm install
npm run dev
```

El servicio escucha en `http://localhost:8080` de forma predeterminada. Puedes cambiar el puerto con `PORT`.

```powershell
curl.exe http://localhost:8080/health
```

| Endpoint | Uso |
| --- | --- |
| `GET /` | Información básica del servidor. |
| `GET /health` | Estado y configuración pública de x402. |
| `POST /mcp` | Endpoint Streamable HTTP para clientes MCP. |
| `GET /demo/x402/premium-report` | Recurso protegido por x402; primero devuelve `402`. |

## Configuración

`.env` es privado y está ignorado por Git. Parte siempre de [`.env.example`](.env.example).

```dotenv
# Avalanche Fuji
AVALANCHE_RPC_URL=https://api.avax-test.network/ext/bc/C/rpc
AVALANCHE_CHAIN_ID=43113

# x402
X402_NETWORK=eip155:43113
X402_USDC_ADDRESS=0x5425890298aed601595a70AB815c96711a31Bc65
X402_FACILITATOR_URL=https://facilitator.payai.network

# Wallet de desarrollo: 0x seguido de 64 caracteres hexadecimales.
X402_AGENT_PRIVATE_KEY=0x...

# Dirección pública Fuji que recibe el pago: 0x seguido de 40 caracteres.
X402_MERCHANT_ADDRESS=0x...

# Límites de seguridad
X402_MAX_PAYMENT_USDC=0.05
X402_MAX_SESSION_SPEND_USDC=0.10

# Solo para desarrollo local
X402_ALLOW_LOCALHOST=true
X402_DEMO_URL=http://localhost:8080/demo/x402/premium-report
X402_DEBUG=false
```

| Variable | Propósito |
| --- | --- |
| `X402_AGENT_PRIVATE_KEY` | Firma pagos. Debe pertenecer solo a una wallet de prueba. |
| `X402_MERCHANT_ADDRESS` | Dirección pública que recibe el USDC de prueba. No es una clave privada. |
| `X402_MAX_PAYMENT_USDC` | Tope por pago; por defecto `0.05`. |
| `X402_MAX_SESSION_SPEND_USDC` | Tope acumulado por proceso; por defecto `0.10`. |
| `X402_ALLOWED_HOSTS` | Lista separada por comas de hosts HTTPS externos que la herramienta puede pagar. |
| `X402_ALLOW_LOCALHOST` | Permite `localhost` solo en desarrollo. Se desactiva en producción. |

El contrato de USDC Fuji configurado es `0x5425890298aed601595a70AB815c96711a31Bc65` y usa 6 decimales. Los tokens de testnet no tienen valor real; consulta la [documentación de Circle](https://developers.circle.com/stablecoins/usdc-contract-addresses).

## Herramientas MCP

| Herramienta | Entrada | Efecto |
| --- | --- | --- |
| `saludar` | `{ "nombre": "Ana" }` | Devuelve un saludo. |
| `estado_servidor` | `{}` | Devuelve estado y timestamp. |
| `avalanche_x402_status` | `{}` | Muestra configuración pública, dirección del agente y balances. No firma ni paga. |
| `avalanche_x402_fetch` | `{ "url": "…", "maxPaymentUsdc": "0.01" }` | Solicita un recurso x402 permitido y puede efectuar un pago. |

`maxPaymentUsdc` es opcional, pero solo puede disminuir el tope configurado en el servidor; nunca aumentarlo.

## Probar x402 sin Codex

En una terminal, mantén el servidor activo:

```powershell
npm run dev
```

En otra terminal, comprueba el challenge sin pagar:

```powershell
curl.exe -i http://localhost:8080/demo/x402/premium-report
```

La respuesta correcta es `HTTP/1.1 402 Payment Required` e incluye el header `PAYMENT-REQUIRED`.

Cuando la wallet de agente tenga AVAX Fuji y USDC Fuji de prueba, realiza el recorrido completo:

```powershell
npm run x402:test
```

Esta orden firma y liquida **0.01 USDC de prueba**. Una ejecución correcta termina con `TEST PASSED`, un `HTTP 200` y, cuando el facilitator lo devuelve, un hash de transacción.

## Conectar el MCP a Codex

Codex admite servidores MCP Streamable HTTP configurados por URL y comparte esa configuración entre la app de escritorio, la CLI y la extensión IDE. Consulta la [guía oficial de MCP para Codex](https://learn.chatgpt.com/docs/extend/mcp).

### Opción A: aplicación de escritorio o extensión IDE

1. Arranca este proyecto con `npm run dev`.
2. Abre **Settings** → **MCP servers** → **Add server**.
3. Asigna el nombre `v52_mcp`.
4. Elige **Streamable HTTP**.
5. Introduce `http://127.0.0.1:8080/mcp`.
6. Guarda y reinicia la aplicación o extensión.
7. En Codex, usa `/mcp` para confirmar que `v52_mcp` aparece conectado.

### Opción B: archivo `config.toml`

En Windows, abre `C:\\Users\\<TU_USUARIO>\\.codex\\config.toml` y añade:

```toml
[mcp_servers.v52_mcp]
url = "http://127.0.0.1:8080/mcp"
startup_timeout_sec = 20
tool_timeout_sec = 60
default_tools_approval_mode = "prompt"

# La consulta de estado no gasta fondos.
[mcp_servers.v52_mcp.tools.avalanche_x402_status]
approval_mode = "approve"
```

Reinicia Codex después de guardar. También puedes usar una configuración por proyecto en `.codex/config.toml` si el proyecto es de confianza.

### Usar las herramientas desde Codex

Primero verifica el estado sin realizar pagos:

```text
Usa la herramienta avalanche_x402_status y muéstrame el estado público de Avalanche Fuji.
```

Para probar la herramienta gratuita:

```text
Usa saludar con nombre "Vector52".
```

Para la prueba pagada local, que cuesta `0.01 USDC` de prueba:

```text
Usa avalanche_x402_fetch para solicitar http://127.0.0.1:8080/demo/x402/premium-report con maxPaymentUsdc 0.01. Realiza una sola solicitud.
```

No configures `avalanche_x402_fetch` con aprobación automática: esa herramienta puede firmar un pago. Codex debe pedir confirmación antes de ejecutarla.

## Uso con una URL desplegada

Para apuntar Codex a Azure Container Apps, sustituye la URL local por la URL HTTPS pública:

```toml
[mcp_servers.v52_mcp]
url = "https://TU-APP.TU-REGION.azurecontainerapps.io/mcp"
default_tools_approval_mode = "prompt"
```

En las variables de entorno del despliegue:

```dotenv
X402_ALLOW_LOCALHOST=false
X402_ALLOWED_HOSTS=TU-APP.TU-REGION.azurecontainerapps.io
X402_DEMO_URL=https://TU-APP.TU-REGION.azurecontainerapps.io/demo/x402/premium-report
```

No uses `localhost` en Azure: desde el contenedor, `localhost` es el propio contenedor, no tu equipo. Protege el endpoint `/mcp` antes de exponer un servidor que contiene una wallet de pago; este repositorio no añade autenticación de usuarios al endpoint por sí mismo.

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

```powershell
npm run build
npm test
```

## Diagnóstico rápido

| Mensaje o síntoma | Causa probable | Acción |
| --- | --- | --- |
| `X402_AGENT_PRIVATE_KEY debe ser una clave privada EVM válida` | Falta el prefijo `0x`, la clave no tiene 64 caracteres hexadecimales o se pegó una dirección pública. | Usa una wallet nueva de prueba y configura `0x` + 64 caracteres. |
| `HTTP 503` en `/demo/x402/premium-report` | Faltan `X402_USDC_ADDRESS`, `X402_FACILITATOR_URL` o `X402_MERCHANT_ADDRESS`; o el servidor no se reinició. | Revisa `.env` y reinicia `npm run dev`. |
| `USDC: 0` | La wallet no tiene USDC Fuji. | Solicita USDC de prueba en el faucet de Circle. |
| `X402_REQUEST_FAILED` antes de mostrar `HTTP 402` | El servicio no está accesible en la URL indicada. | Arranca `npm run dev` y verifica el puerto/URL. |
| `URL_REJECTED` | El host externo no está en la lista permitida. | Añade el hostname exacto a `X402_ALLOWED_HOSTS`; para local usa solo desarrollo. |

## Referencias

- [MCP en Codex — documentación oficial de OpenAI](https://learn.chatgpt.com/docs/extend/mcp)
- [USDC en Avalanche Fuji — Circle](https://developers.circle.com/stablecoins/usdc-contract-addresses)
- [Guía de pruebas x402 de este proyecto](docs/X402_AVALANCHE_TEST.md)
