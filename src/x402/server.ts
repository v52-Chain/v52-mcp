import type { IncomingMessage, ServerResponse } from "node:http";

import { HTTPFacilitatorClient, x402HTTPResourceServer, x402ResourceServer } from "@x402/core/server";
import type { HTTPAdapter, HTTPRequestContext, RoutesConfig } from "@x402/core/http";
import { registerExactEvmScheme } from "@x402/evm/exact/server";

import { loadX402DemoConfig, type X402DemoConfig } from "./demo-config.js";
import { X402Error } from "./errors.js";

const PREMIUM_REPORT = {
  success: true,
  product: "Avalanche x402 Premium Report",
  message: "Payment verified successfully",
  network: "Avalanche Fuji",
  price: "0.01 USDC",
  data: {
    market: "AVAX",
    signal: "demo",
    confidence: 0.92,
  },
};

function nodeHttpAdapter(request: IncomingMessage): HTTPAdapter {
  const host = request.headers.host ?? "localhost";
  const url = new URL(request.url ?? "/", `http://${host}`);

  return {
    getHeader(name) {
      const value = request.headers[name.toLowerCase()];
      return Array.isArray(value) ? value[0] : value;
    },
    getMethod: () => request.method ?? "GET",
    getPath: () => url.pathname,
    getUrl: () => url.toString(),
    getAcceptHeader: () => request.headers.accept ?? "",
    getUserAgent: () => request.headers["user-agent"] ?? "",
    getQueryParams: () => Object.fromEntries(url.searchParams.entries()),
  };
}

function writeJson(response: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  const responseHeaders = Object.fromEntries(
    Object.entries(headers).filter(([name]) => name.toLowerCase() !== "content-type"),
  );
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    ...responseHeaders,
  });
  response.end(JSON.stringify(body));
}

function buildDemoServer(config: X402DemoConfig): x402HTTPResourceServer {
  const facilitator = new HTTPFacilitatorClient({
    url: config.facilitatorUrl,
    timeoutMs: 15_000,
  });
  const resourceServer = new x402ResourceServer(facilitator);
  registerExactEvmScheme(resourceServer, { networks: [config.network] });

  // Fuji is not in x402's dollar-price defaults. An explicit EIP-3009 USDC
  // amount keeps the accepted asset and 0.01 USDC price deterministic.
  const routes: RoutesConfig = {
    "GET /demo/x402/premium-report": {
      accepts: {
        scheme: "exact",
        network: config.network,
        payTo: config.merchantAddress,
        price: {
          amount: "10000",
          asset: config.usdcAddress,
          extra: {
            name: "USD Coin",
            version: "2",
          },
        },
        maxTimeoutSeconds: 60,
      },
      description: "Avalanche x402 Premium Report",
      mimeType: "application/json",
      serviceName: "v52 MCP x402 demo",
      unpaidResponseBody: () => ({
        contentType: "application/json",
        body: {
          error: "PAYMENT_REQUIRED",
          message: "This demo resource requires 0.01 USDC on Avalanche Fuji.",
        },
      }),
    },
  };

  return new x402HTTPResourceServer(resourceServer, routes);
}

export class X402DemoService {
  private initialized?: Promise<x402HTTPResourceServer>;

  private getServer() {
    if (!this.initialized) {
      this.initialized = (async () => {
        const config = loadX402DemoConfig();
        const server = buildDemoServer(config);
        await server.initialize();
        if (config.debug) console.error("[x402] Fuji facilitator initialized");
        return server;
      })();
    }
    return this.initialized;
  }

  async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    let server: x402HTTPResourceServer;
    try {
      server = await this.getServer();
    } catch (error) {
      const message =
        error instanceof X402Error
          ? error.message
          : "La demo x402 no pudo inicializar el facilitator configurado.";
      writeJson(response, 503, { error: "X402_DEMO_UNAVAILABLE", message });
      return;
    }

    const adapter = nodeHttpAdapter(request);
    const context: HTTPRequestContext = {
      adapter,
      path: adapter.getPath(),
      method: adapter.getMethod(),
    };

    try {
      const result = await server.processHTTPRequest(context);
      if (result.type === "payment-error") {
        writeJson(response, result.response.status, result.response.body ?? {}, result.response.headers);
        return;
      }
      if (result.type === "no-payment-required") {
        // This route is configured as paid; never expose the report on a mismatch.
        writeJson(response, 500, { error: "X402_ROUTE_CONFIGURATION_ERROR" });
        return;
      }

      const reportJson = JSON.stringify(PREMIUM_REPORT);
      const settlement = await server.processSettlement(
        result.paymentPayload,
        result.paymentRequirements,
        result.declaredExtensions,
        {
          request: context,
          responseBody: Buffer.from(reportJson),
          responseHeaders: { "content-type": "application/json; charset=utf-8" },
        },
        undefined,
        result.beforeHandlerSettlement,
      );

      if (!settlement.success) {
        writeJson(response, settlement.response.status, settlement.response.body ?? {}, settlement.response.headers);
        return;
      }

      writeJson(response, 200, PREMIUM_REPORT, settlement.headers);
    } catch {
      writeJson(response, 502, {
        error: "X402_PAYMENT_PROCESSING_FAILED",
        message: "No se pudo verificar o liquidar el pago x402.",
      });
    }
  }
}
