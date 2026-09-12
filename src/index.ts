import { createServer } from "node:http";
import {
  createMcpHandler,
  McpServer,
} from "@modelcontextprotocol/server";

import { toNodeHandler } from "@modelcontextprotocol/node";
import * as z from "zod/v4";

const PORT = Number(process.env.PORT ?? 3000);

/*
|--------------------------------------------------------------------------
| Crear servidor MCP
|--------------------------------------------------------------------------
*/

function createJhamilMcp() {
  const server = new McpServer({
    name: "jhamil-public-mcp",
    version: "1.0.0",
  });

  /*
  |--------------------------------------------------------------------------
  | TOOL 1: saludar
  |--------------------------------------------------------------------------
  */

  server.registerTool(
    "saludar",
    {
      description: "Saluda a una persona utilizando su nombre.",

      inputSchema: z.object({
        nombre: z.string().describe("Nombre de la persona"),
      }),
    },

    async ({ nombre }) => {
      return {
        content: [
          {
            type: "text",
            text: `Hola ${nombre}. El MCP de Jhamil funciona correctamente 🚀`,
          },
        ],
      };
    }
  );

  /*
  |--------------------------------------------------------------------------
  | TOOL 2: estado_servidor
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
| MCP HTTP Handler
|--------------------------------------------------------------------------
*/

const mcpHandler = createMcpHandler(
  () => createJhamilMcp(),
  {
    /*
     * Para esta primera prueba usamos respuesta JSON.
     * Es suficiente para nuestras tools sencillas.
     */
    responseMode: "json",
  }
);

const nodeMcpHandler = toNodeHandler(mcpHandler);

/*
|--------------------------------------------------------------------------
| HTTP Server
|--------------------------------------------------------------------------
*/

const httpServer = createServer(async (req, res) => {
  /*
   * Protección básica contra requests web originados
   * desde sitios desconocidos.
   *
   * Claude/Codex CLI normalmente no necesitan Origin.
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

  if (req.url === "/health" && req.method === "GET") {
    res.writeHead(200, {
      "Content-Type": "application/json",
    });

    res.end(
      JSON.stringify({
        status: "ok",
        service: "jhamil-public-mcp",
      })
    );

    return;
  }

  /*
  |--------------------------------------------------------------------------
  | MCP Endpoint
  |--------------------------------------------------------------------------
  */

  if (req.url === "/mcp") {
    await nodeMcpHandler(req, res);
    return;
  }

  /*
  |--------------------------------------------------------------------------
  | Home
  |--------------------------------------------------------------------------
  */

  if (req.url === "/" && req.method === "GET") {
    res.writeHead(200, {
      "Content-Type": "application/json",
    });

    res.end(
      JSON.stringify({
        name: "Jhamil MCP",
        status: "online",
        mcp: "/mcp",
        health: "/health",
      })
    );

    return;
  }

  res.writeHead(404, {
    "Content-Type": "application/json",
  });

  res.end(
    JSON.stringify({
      error: "Not Found",
    })
  );
});

/*
|--------------------------------------------------------------------------
| Start
|--------------------------------------------------------------------------
*/

httpServer.listen(PORT, "127.0.0.1", () => {
  console.log("");
  console.log("=======================================");
  console.log("🚀 JHAMIL MCP ONLINE");
  console.log("=======================================");
  console.log(`HTTP:   http://127.0.0.1:${PORT}`);
  console.log(`MCP:    http://127.0.0.1:${PORT}/mcp`);
  console.log(`Health: http://127.0.0.1:${PORT}/health`);
  console.log("=======================================");
  console.log("");
});