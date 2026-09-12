import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import type { InspectionEngine } from "../application/ports/inspection-engine.js";
import type { InspectionRepository } from "../application/ports/inspection-repository.js";
import { createAuthHook, registerAuthErrorHandler } from "../adapters/inbound/http/auth.js";
import { registerInspectionRoutes } from "../adapters/inbound/http/routes/inspections.js";
import { LensClient } from "../adapters/outbound/lens/lens-client.js";
import { InspectionHistoryStore } from "../adapters/outbound/sqlite/inspection-history-store.js";
import type { AppConfig } from "./config.js";

export type AppDeps = {
  inspectionEngine?: InspectionEngine;
  inspectionRepository?: InspectionRepository & Partial<Pick<InspectionHistoryStore, "close">>;
};

export function buildApp(config: AppConfig, deps: AppDeps = {}): FastifyInstance {
  const app = Fastify({ logger: true });

  const inspectionEngine = deps.inspectionEngine ?? new LensClient(config.lensUrl);
  const inspectionRepository = deps.inspectionRepository ?? new InspectionHistoryStore(config.databasePath ?? ":memory:");
  const auth = createAuthHook(config);

  registerAuthErrorHandler(app);

  app.get("/health", async () => ({ status: "ok" }));

  app.get("/v1/services", async () => ({
    lens: { url: config.lensUrl },
    mock: { url: config.mockUrl },
  }));

  registerInspectionRoutes(app, { engine: inspectionEngine, auth, repository: inspectionRepository });
  app.addHook("onClose", () => inspectionRepository.close?.());

  if (!config.clerkSecretKey) {
    app.log.warn("auth disabled: CLERK_SECRET_KEY não configurada (dev-mode aberto)");
  }

  return app;
}
