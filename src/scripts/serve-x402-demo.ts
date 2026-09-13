/**
 * Standalone local HTTP server for the x402 demo resource
 * (GET /demo/x402/premium-report). This is a developer test fixture, not
 * part of the MCP server: the MCP now speaks stdio only, so this small
 * process exists solely to let `npm run x402:test` exercise a real x402
 * challenge/payment round trip against something running on localhost.
 */
import { createServer } from "node:http";

import "dotenv/config";

import { X402DemoService } from "../x402/server.js";

const PORT = Number(process.env.X402_DEMO_PORT ?? process.env.PORT ?? 8080);
const demoService = new X402DemoService();

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  if (url.pathname === "/demo/x402/premium-report") {
    await demoService.handle(req, res);
    return;
  }
  res.writeHead(404, { "content-type": "application/json" });
  res.end(JSON.stringify({ error: "Not Found" }));
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`x402 demo fixture listening on http://127.0.0.1:${PORT}/demo/x402/premium-report`);
});
