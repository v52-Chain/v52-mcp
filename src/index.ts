import { createServer } from "node:http";

import {
  createMcpHandler,
  McpServer,
} from "@modelcontextprotocol/server";

import { toNodeHandler } from "@modelcontextprotocol/node";

import * as z from "zod/v4";


/*
|--------------------------------------------------------------------------
| Configuración
|--------------------------------------------------------------------------
*/

const PORT = Number(process.env.PORT ?? 8080);


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
            timestamp: new Date().toISOString(),
          })
        );

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
        error
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