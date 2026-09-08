import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import type { AppConfig } from "./config.js";
import { createAuthHook, registerAuthErrorHandler } from "./auth.js";
import { LensClient } from "./lens-client.js";
import { registerInspectionRoutes } from "./routes/inspections.js";

export type AppDeps = {
  lensClient?: LensClient;
};

export function buildApp(config: AppConfig, deps: AppDeps = {}): FastifyInstance {
  const app = Fastify({ logger: true });

  const lensClient = deps.lensClient ?? new LensClient(config.lensUrl);
  const auth = createAuthHook(config);

  registerAuthErrorHandler(app);

  app.get("/health", async () => ({ status: "ok" }));

  app.get("/v1/services", async () => ({
    lens: { url: config.lensUrl },
    mock: { url: config.mockUrl },
  }));

  registerInspectionRoutes(app, { lens: lensClient, auth });

  if (!config.clerkSecretKey) {
    app.log.warn("auth disabled: CLERK_SECRET_KEY não configurada (dev-mode aberto)");
  }

  return app;
}
