import { createServer } from "node:http";

import "dotenv/config";

import {
  createMcpHandler,
  McpServer,
} from "@modelcontextprotocol/server";

import { toNodeHandler } from "@modelcontextprotocol/node";

import * as z from "zod/v4";

import { fetchX402Resource } from "./x402/client.js";
import { getX402ConfigurationStatus } from "./x402/config.js";
import { toSafeError } from "./x402/errors.js";
import { X402DemoService } from "./x402/server.js";
import { getX402Status } from "./x402/status.js";


/*
|--------------------------------------------------------------------------
| Configuración
|--------------------------------------------------------------------------
*/

const PORT = Number(process.env.PORT ?? 8080);
const x402DemoService = new X402DemoService();


/*
|--------------------------------------------------------------------------
| Crear MCP Server
|--------------------------------------------------------------------------
*/

function createJhamilMcp() {

  const server = new McpServer({
    name: "jhamil-public-mcp",
    version: "1.0.0",
  });


  /*
  |--------------------------------------------------------------------------
  | TOOL: saludar
  |--------------------------------------------------------------------------
  */

  server.registerTool(
    "saludar",
    {
      description:
        "Saluda a una persona utilizando su nombre.",

      inputSchema: z.object({
        nombre: z
          .string()
          .describe("Nombre de la persona"),
      }),
    },

    async ({ nombre }) => {

      return {
        content: [
          {
            type: "text",
            text:
              `Hola ${nombre}. El MCP de Jhamil funciona correctamente 🚀`,
          },
        ],
      };
    }
  );

  server.registerTool(
    "avalanche_x402_fetch",
    {
      description:
        "Accede a un recurso HTTP protegido por x402 y realiza un pago autorizado en Avalanche Fuji solo si cumple la política de gasto local.",
      inputSchema: z.object({
        url: z.string().url().describe("URL HTTPS permitida del recurso x402."),
        maxPaymentUsdc: z
          .string()
          .regex(/^\d+(?:\.\d{1,6})?$/)
          .optional()
          .describe("Límite opcional del solicitante; nunca puede aumentar el límite del servidor."),
      }),
    },
    async ({ url, maxPaymentUsdc }) => {
      try {
        const result = await fetchX402Resource({ url, maxPaymentUsdc });
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: JSON.stringify(toSafeError(error), null, 2) }],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    "avalanche_x402_status",
    {
      description:
        "Muestra el estado público de la configuración x402 Avalanche Fuji sin firmar ni realizar pagos.",
      inputSchema: z.object({}),
    },
    async () => ({
      content: [{ type: "text", text: JSON.stringify(await getX402Status(), null, 2) }],
    }),
  );


  /*
  |--------------------------------------------------------------------------
  | TOOL: estado_servidor
  |--------------------------------------------------------------------------
  */

  server.registerTool(
    "estado_servidor",
    {
      description:
        "Comprueba si el servidor MCP de Jhamil está funcionando.",

      inputSchema: z.object({}),
    },

    async () => {

      return {
        content: [
          {
            type: "text",

            text: JSON.stringify(
              {
                status: "online",
                server: "jhamil-public-mcp",
                version: "1.0.0",
                timestamp: new Date().toISOString(),
              },
              null,
              2
            ),
          },
        ],
      };
    }
  );


  return server;
}


/*
|--------------------------------------------------------------------------
| MCP Handler
|--------------------------------------------------------------------------
*/

const mcpHandler = createMcpHandler(
  () => createJhamilMcp(),
  {
    responseMode: "json",
  }
);


const nodeMcpHandler = toNodeHandler(mcpHandler);


/*
|--------------------------------------------------------------------------
| HTTP Server
|--------------------------------------------------------------------------
*/

const httpServer = createServer(
  async (req, res) => {

    try {

      /*
      |--------------------------------------------------------------------------
      | Obtener pathname
      |--------------------------------------------------------------------------
      |
      | Esto hace que también funcionen correctamente URLs que
      | eventualmente puedan incluir parámetros.
      |
      */

      const requestUrl = new URL(
        req.url ?? "/",
        `http://${req.headers.host ?? "localhost"}`
      );

      const pathname = requestUrl.pathname;


      /*
      |--------------------------------------------------------------------------
      | Protección Origin
      |--------------------------------------------------------------------------
      */

      if (req.headers.origin) {

        res.writeHead(403, {
          "Content-Type": "application/json",
        });

        res.end(
          JSON.stringify({
            error: "Origin not allowed",
          })
        );

        return;
      }


      /*
      |--------------------------------------------------------------------------
      | Health Check
      |--------------------------------------------------------------------------
      */

      if (
        pathname === "/health" &&
        req.method === "GET"
      ) {

        res.writeHead(200, {
          "Content-Type": "application/json",
        });

        res.end(
          JSON.stringify({
            status: "ok",
            service: "jhamil-public-mcp",
            version: "1.0.0",
            mcp: true,
            x402: {
              enabled: getX402ConfigurationStatus().configured,
              network: "eip155:43113",
            },
            timestamp: new Date().toISOString(),
          })
        );

        return;
      }

      if (
        pathname === "/demo/x402/premium-report" &&
        req.method === "GET"
      ) {

        await x402DemoService.handle(req, res);
        return;
      }


      /*
      |--------------------------------------------------------------------------
      | MCP Endpoint
      |--------------------------------------------------------------------------
      */

      if (pathname === "/mcp") {

        await nodeMcpHandler(req, res);

        return;
      }


      /*
      |--------------------------------------------------------------------------
      | Home
      |--------------------------------------------------------------------------
      */

      if (
        pathname === "/" &&
        req.method === "GET"
      ) {

        res.writeHead(200, {
          "Content-Type": "application/json",
        });

        res.end(
          JSON.stringify({
            name: "Jhamil MCP",
            status: "online",
            version: "1.0.0",
            mcp: "/mcp",
            health: "/health",
          })
        );

        return;
      }


      /*
      |--------------------------------------------------------------------------
      | 404
      |--------------------------------------------------------------------------
      */

      res.writeHead(404, {
        "Content-Type": "application/json",
      });

      res.end(
        JSON.stringify({
          error: "Not Found",
        })
      );

    }

    catch (error) {

      console.error(
        "Error procesando request:",
        error instanceof Error ? error.message : "unknown error"
      );


      /*
       * Evitamos escribir otra respuesta si
       * MCP ya comenzó a enviar headers.
       */

      if (!res.headersSent) {

        res.writeHead(500, {
          "Content-Type": "application/json",
        });

      }


      if (!res.writableEnded) {

        res.end(
          JSON.stringify({
            error: "Internal Server Error",
          })
        );

      }
    }
  }
);


/*
|--------------------------------------------------------------------------
| Start Server
|--------------------------------------------------------------------------
|
| IMPORTANTE:
|
| Azure Container Apps necesita 0.0.0.0.
| NO usar 127.0.0.1 en producción.
|
*/

httpServer.listen(
  PORT,
  "0.0.0.0",
  () => {

    console.log("");
    console.log("=======================================");
    console.log("🚀 JHAMIL MCP ONLINE");
    console.log("=======================================");
    console.log(`Port:   ${PORT}`);
    console.log(`MCP:    /mcp`);
    console.log(`Health: /health`);
    console.log("Listening on 0.0.0.0");
    console.log("=======================================");
    console.log("");

  }
);
