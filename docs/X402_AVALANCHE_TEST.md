# Prueba x402 en Avalanche Fuji

## Qué se añadió

Este proyecto conserva su servidor MCP HTTP actual y añade un módulo aislado en `src/x402`. La demostración prueba el recorrido:

`cliente MCP → HTTP 402 → autorización EIP-3009 → facilitator → Avalanche Fuji → HTTP 200`.

El recurso de venta es `GET /demo/x402/premium-report`. Cuesta exactamente `0.01` USDC de prueba. La herramienta MCP que compra recursos es `avalanche_x402_fetch`; `avalanche_x402_status` solo inspecciona la configuración y los balances públicos.

## Arquitectura

1. Un cliente pide el recurso HTTP.
2. El servidor devuelve `402 Payment Required` con `PAYMENT-REQUIRED` según x402 v2.
3. La tool valida esquema, red, activo, importe, destinatario, timeout y URL **antes de firmar**.
4. La wallet del agente firma una autorización EIP-3009 de USDC.
5. El facilitator verifica y liquida el pago en Fuji.
6. El endpoint devuelve el reporte y un `PAYMENT-RESPONSE`. El hash solo se muestra si ese header lo incluye.

HTTP 402 es el código HTTP de “pago requerido”; x402 lo convierte en instrucciones verificables para un pago programático. El facilitator no recibe la clave privada: recibe la autorización firmada, verifica sus términos y presenta la liquidación en la red.

## Red y activo

- Red: Avalanche Fuji C-Chain, chain ID `43113`.
- Identificador x402/CAIP-2: `eip155:43113`.
- RPC por defecto: `https://api.avax-test.network/ext/bc/C/rpc`.
- USDC Fuji: `0x5425890298aed601595a70AB815c96711a31Bc65` (6 decimales).
- Esquema permitido: `exact` con autorización EIP-3009.

El proyecto usa una URL configurable de facilitator. La documentación de PayAI declara soporte para Fuji `eip155:43113`; el valor sugerido para desarrollo es `https://facilitator.payai.network`. Verifica `GET <facilitator>/supported` antes de sustituirlo.

## Preparación local

Este repositorio usa **npm** (tiene `package-lock.json`), no pnpm.

```powershell
Copy-Item .env.example .env
npm install
```

Completa solo estas variables en `.env`:

```dotenv
X402_AGENT_PRIVATE_KEY=0x... # wallet de desarrollo, nunca una clave con fondos reales
X402_MERCHANT_ADDRESS=0x...  # dirección Fuji que recibirá los USDC de prueba
X402_ALLOWED_HOSTS=           # hosts HTTPS externos permitidos, separados por coma
X402_ALLOW_LOCALHOST=true     # solo durante la prueba local
X402_DEBUG=true
```

No subas `.env`; ya está ignorado por Git. Para una prueba local del endpoint interno, deja `X402_DEMO_URL=http://localhost:8080/demo/x402/premium-report` y activa `X402_ALLOW_LOCALHOST=true`. Esta excepción se desactiva automáticamente cuando `NODE_ENV=production`.

Consigue AVAX de Fuji para la wallet de desarrollo desde el faucet oficial de Avalanche y USDC de prueba desde el faucet de Circle. Circle publica el contrato Fuji anterior y confirma que esos tokens de testnet no tienen valor real.

## Ejecutar la prueba

Terminal 1:

```powershell
npm run dev
```

Terminal 2, para comprobar el challenge sin pagar:

```powershell
Invoke-WebRequest http://localhost:8080/demo/x402/premium-report -SkipHttpErrorCheck
```

Debe responder `402` e incluir el header `PAYMENT-REQUIRED`.

Primera prueba end-to-end (esta sí firma y puede liquidar **0.01 USDC de prueba**):

```powershell
npm run x402:test
```

Antes de firmar, el script muestra la wallet pública, balances, el precio y el límite. Tras el pago muestra el JSON del recurso y el hash únicamente cuando el protocolo lo retorna.

Desde un cliente MCP/Codex, llama primero:

```json
{ "name": "avalanche_x402_status", "arguments": {} }
```

Después, para la demo local:

```json
{
  "name": "avalanche_x402_fetch",
  "arguments": {
    "url": "http://localhost:8080/demo/x402/premium-report",
    "maxPaymentUsdc": "0.01"
  }
}
```

Para una API externa, añade primero su host exacto a `X402_ALLOWED_HOSTS` y usa una URL HTTPS. La tool rechaza `file:`, hosts privados/locales, URLs no permitidas, Avalanche mainnet, tokens desconocidos, requisitos malformados y pagos por encima de `X402_MAX_PAYMENT_USDC`.

## Seguridad y límites

- Límite por pago: `X402_MAX_PAYMENT_USDC=0.05`.
- Límite simple del proceso/sesión: `X402_MAX_SESSION_SPEND_USDC=0.10`.
- Un límite enviado por la tool solo puede reducir el máximo, nunca aumentarlo.
- No se imprimen, serializan ni devuelven claves privadas o firmas.
- El límite de sesión se reserva antes de firmar y se mantiene al firmar, por seguridad ante fallos de red posteriores.

No hay infraestructura distribuida para compartir ese contador entre réplicas de Railway. Para una política multiinstancia se necesita almacenamiento transaccional centralizado antes de aumentar el alcance del agente.

## Railway

No se modificó ni activó ningún despliegue. Cuando decidas publicar, agrega en Railway:

```text
AVALANCHE_RPC_URL
AVALANCHE_CHAIN_ID=43113
X402_NETWORK=eip155:43113
X402_USDC_ADDRESS
X402_FACILITATOR_URL
X402_AGENT_PRIVATE_KEY
X402_MERCHANT_ADDRESS
X402_MAX_PAYMENT_USDC
X402_MAX_SESSION_SPEND_USDC
X402_ALLOWED_HOSTS
X402_DEBUG
```

En producción no definas `X402_ALLOW_LOCALHOST=true`. Para que un agente pueda comprar un recurso publicado en Railway, añade el hostname público exacto de Railway a `X402_ALLOWED_HOSTS` y usa esa URL, no `localhost`.

## Diagnóstico

- `X402_SERVER_NOT_CONFIGURED`: faltan merchant, USDC o facilitator para crear el endpoint de pago.
- `PAYMENT_REJECTED_MAX_LIMIT`: la API pidió más de `0.05` USDC o del máximo solicitado por la tool.
- `PAYMENT_REJECTED_NETWORK` o `PAYMENT_REJECTED_ASSET`: la API no solicitó Fuji/USDC configurado.
- `URL_REJECTED`: falta autorizar el host o la URL parece SSRF.
- `X402_PAYMENT_NOT_SETTLED`: el facilitator o la cadena no confirmaron el pago; revisa su URL, `/supported`, saldo USDC y configuración EIP-3009.

Consulta la transacción devuelta en el explorador Fuji/Snowtrace solo cuando la respuesta incluya `txHash`; el código no inventa hashes.
