import { createServer, type ServerResponse } from "node:http";

import "dotenv/config";
import { toNodeHandler } from "@modelcontextprotocol/node";
import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";

import {
  getVector52BackendStatus,
  investigateVector52WalletFlow,
} from "./vector52/backend.js";
import { fetchX402Resource } from "./x402/client.js";
import { getX402ConfigurationStatus } from "./x402/config.js";
import { toSafeError } from "./x402/errors.js";
import { X402DemoService } from "./x402/server.js";
import { getX402Status } from "./x402/status.js";

const PORT = Number(process.env.PORT ?? 8080);
const SERVICE_NAME = "vector52-mcp";
const VERSION = "1.1.0";
const x402DemoService = new X402DemoService();

const toolCatalog = [
  {
    name: "vector52_status",
    description: "Verifica backend, canal x402 y precio anunciado sin realizar pagos.",
    payment: "FREE" as const,
  },
  {
    name: "vector52_wallet_flow",
    description: "Investiga ingresos y egresos de una wallet mediante el backend de Vector52.",
    payment: "X402" as const,
  },
  {
    name: "avalanche_x402_status",
    description: "Consulta configuración y balances públicos de la wallet agente en Fuji.",
    payment: "FREE" as const,
  },
] as const;

function jsonText(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}

function jsonError(error: unknown) {
  return { ...jsonText(toSafeError(error)), isError: true };
}

function createVector52Mcp() {
  const server = new McpServer({ name: SERVICE_NAME, version: VERSION });

  server.registerTool(
    "saludar",
    {
      description: "Comprueba la comunicación básica con el MCP de Vector52.",
      inputSchema: z.object({ nombre: z.string().min(1).max(80) }),
    },
    async ({ nombre }) =>
      jsonText({ message: `Hola ${nombre}. Vector52 MCP está conectado.`, service: SERVICE_NAME }),
  );

  server.registerTool(
    "vector52_status",
    {
      description: "Verifica la comunicación MCP → backend y muestra el precio x402 sin pagar.",
      inputSchema: z.object({}),
    },
    async () => {
      const [backend, x402] = await Promise.all([
        getVector52BackendStatus(),
        getX402Status(),
      ]);
      return jsonText({
        service: SERVICE_NAME,
        status: backend.ready && x402.configured ? "READY" : "DEGRADED",
        backend,
        x402,
      });
    },
  );

  server.registerTool(
    "vector52_wallet_flow",
    {
      description:
        "Ejecuta una investigación de wallet en Vector52. Descubre el precio, valida USDC/Fuji y paga una sola petición mediante x402.",
      inputSchema: z.object({
        targetAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
        limit: z.number().int().min(1).max(100).optional(),
        fromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        toDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        maxPaymentUsdc: z.string().regex(/^\d+(?:\.\d{1,6})?$/).optional(),
      }),
    },
    async input => {
      try {
        if (input.fromDate && input.toDate && input.fromDate > input.toDate) {
          throw new Error("fromDate debe ser anterior o igual a toDate.");
        }
        return jsonText(await investigateVector52WalletFlow(input));
      } catch (error) {
        return jsonError(error);
      }
    },
  );

  server.registerTool(
    "avalanche_x402_status",
    {
      description: "Muestra configuración y balances públicos en Avalanche Fuji sin firmar ni pagar.",
      inputSchema: z.object({}),
    },
    async () => jsonText(await getX402Status()),
  );

  // Herramienta avanzada para diagnóstico. En producto debe usarse
  // vector52_wallet_flow, que fija el destino y descubre el precio.
  server.registerTool(
    "avalanche_x402_fetch",
    {
      description: "Diagnóstico avanzado: solicita una URL x402 incluida en la allowlist local.",
      inputSchema: z.object({
        url: z.string().url(),
        maxPaymentUsdc: z.string().regex(/^\d+(?:\.\d{1,6})?$/).optional(),
        method: z.enum(["GET", "POST"]).optional(),
        body: z.record(z.string(), z.unknown()).optional(),
      }),
    },
    async input => {
      try {
        return jsonText(await fetchX402Resource(input));
      } catch (error) {
        return jsonError(error);
      }
    },
  );

  server.registerTool(
    "estado_servidor",
    { description: "Alias de compatibilidad para comprobar el MCP.", inputSchema: z.object({}) },
    async () =>
      jsonText({ status: "online", server: SERVICE_NAME, version: VERSION, timestamp: new Date().toISOString() }),
  );

  return server;
}

const mcpHandler = createMcpHandler(() => createVector52Mcp(), { responseMode: "json" });
const nodeMcpHandler = toNodeHandler(mcpHandler);

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}

const httpServer = createServer(async (req, res) => {
  try {
    const requestUrl = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    const pathname = requestUrl.pathname;

    // El proceso contiene una wallet: ningún navegador debe poder invocarlo vía CORS.
    if (req.headers.origin) {
      sendJson(res, 403, { error: "Origin not allowed" });
      return;
    }

    if (pathname === "/health" && req.method === "GET") {
      sendJson(res, 200, {
        status: "ok",
        service: SERVICE_NAME,
        version: VERSION,
        mcp: true,
        x402: {
          enabled: getX402ConfigurationStatus().configured,
          network: "eip155:43113",
        },
        timestamp: new Date().toISOString(),
      });
      return;
    }

    if (pathname === "/capabilities" && req.method === "GET") {
      const backend = await getVector52BackendStatus();
      sendJson(res, 200, {
        status: backend.ready ? "READY" : "DEGRADED",
        service: SERVICE_NAME,
        version: VERSION,
        mcpEndpoint: "/mcp",
        direction: "AGENT_TO_MCP_TO_BACKEND",
        backend,
        tools: toolCatalog.map(tool => ({
          ...tool,
          ...(tool.name === "vector52_wallet_flow" && backend.reachable
            ? { priceAtomic: backend.capabilities?.amount_atomic }
            : {}),
        })),
      });
      return;
    }

    if (pathname === "/demo/x402/premium-report" && req.method === "GET") {
      await x402DemoService.handle(req, res);
      return;
    }

    if (pathname === "/mcp") {
      await nodeMcpHandler(req, res);
      return;
    }

    if (pathname === "/" && req.method === "GET") {
      sendJson(res, 200, {
        name: "Vector52 MCP",
        status: "online",
        version: VERSION,
        mcp: "/mcp",
        health: "/health",
        capabilities: "/capabilities",
      });
      return;
    }

    sendJson(res, 404, { error: "Not Found" });
  } catch (error) {
    console.error("Error procesando request:", error instanceof Error ? error.message : "unknown error");
    if (!res.headersSent) sendJson(res, 500, { error: "Internal Server Error" });
    else if (!res.writableEnded) res.end();
  }
});

httpServer.listen(PORT, "0.0.0.0", () => {
  console.log(`Vector52 MCP ${VERSION} online on 0.0.0.0:${PORT}`);
  console.log("MCP: /mcp | Health: /health | Capabilities: /capabilities");
});
