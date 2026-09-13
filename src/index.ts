#!/usr/bin/env node
import "dotenv/config";
import { McpServer } from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import * as z from "zod/v4";

import {
  getVector52BackendStatus,
  investigateVector52WalletFlow,
} from "./vector52/backend.js";
import { fetchX402Resource } from "./x402/client.js";
import { toSafeError } from "./x402/errors.js";
import { getX402Status } from "./x402/status.js";
import { getAnchor, getCaseEvidence, getCaseStatus, verifyPackage } from "./vector52/client.js";

const SERVICE_NAME = "vector52-mcp";
const VERSION = "1.1.0";

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

  // Herramientas gratuitas del contrato MCP (docs/CONTRATO-INTEGRACION.md
  // "MCP mapping"). De las 6 tools documentadas, estas 4 son las únicas con
  // un endpoint real detrás hoy; edge_explain y claim_audit no existen
  // todavía en v52-backend (ver v52-backend/docs/X402_MCP.md §1, Nivel 3).
  server.registerTool(
    "case_status",
    {
      description: "Consulta el estado y warnings de un caso Vector52 (GET /v1/cases/{case_id}). Gratuito.",
      inputSchema: z.object({ caseId: z.string().min(1) }),
    },
    async ({ caseId }) => {
      try {
        return jsonText(await getCaseStatus(caseId));
      } catch (error) {
        return jsonError(error);
      }
    },
  );

  server.registerTool(
    "evidence_get",
    {
      description:
        "Lista la evidencia preservada de un caso Vector52 (GET /v1/cases/{case_id}/evidence). Gratuito.",
      inputSchema: z.object({ caseId: z.string().min(1) }),
    },
    async ({ caseId }) => {
      try {
        return jsonText(await getCaseEvidence(caseId));
      } catch (error) {
        return jsonError(error);
      }
    },
  );

  server.registerTool(
    "anchor_lookup",
    {
      description:
        "Busca la procedencia HSK de un expediente por su manifest_root (GET /v1/anchors/{manifest_root}). Consulta pública, gratuita, no requiere llave firmante.",
      inputSchema: z.object({ manifestRoot: z.string().regex(/^0x[0-9a-fA-F]{64}$/) }),
    },
    async ({ manifestRoot }) => {
      try {
        return jsonText(await getAnchor(manifestRoot));
      } catch (error) {
        return jsonError(error);
      }
    },
  );

  server.registerTool(
    "package_verify",
    {
      description:
        "Verifica la integridad de un paquete .v52.zip (POST /v1/verify): recalcula SHA-256 de cada archivo declarado y detecta alteraciones. Gratuito.",
      inputSchema: z.object({
        fileBase64: z.string().min(1),
        fileName: z.string().optional(),
      }),
    },
    async ({ fileBase64, fileName }) => {
      try {
        return jsonText(await verifyPackage({ fileBase64, fileName }));
      } catch (error) {
        return jsonError(error);
      }
    },
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

async function main() {
  const server = createVector52Mcp();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stdout is reserved for JSON-RPC; startup notices go to stderr only.
  console.error(`${SERVICE_NAME} ${VERSION} listo (stdio).`);
}

main().catch(error => {
  console.error("No se pudo iniciar el MCP de Vector52:", error instanceof Error ? error.message : error);
  process.exit(1);
});
