import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import type { InspectionEngine } from "../application/ports/inspection-engine.js";
import type { InspectionRepository } from "../application/ports/inspection-repository.js";
import type { StreamMockEngine } from "../application/ports/stream-mock.js";
import { createAuthHook, registerAuthErrorHandler } from "../adapters/inbound/http/auth.js";
import { registerInspectionRoutes } from "../adapters/inbound/http/routes/inspections.js";
import { registerPlaybackRoutes } from "../adapters/inbound/http/routes/playback.js";
import { registerStreamRoutes } from "../adapters/inbound/http/routes/streams.js";
import { LensClient } from "../adapters/outbound/lens/lens-client.js";
import { MockClient } from "../adapters/outbound/mock/mock-client.js";
import { InspectionHistoryStore } from "../adapters/outbound/sqlite/inspection-history-store.js";
import type { AppConfig } from "./config.js";

export type AppDeps = {
  inspectionEngine?: InspectionEngine;
  inspectionRepository?: InspectionRepository & Partial<Pick<InspectionHistoryStore, "close">>;
  streamMock?: StreamMockEngine;
};

export function buildApp(config: AppConfig, deps: AppDeps = {}): FastifyInstance {
  const app = Fastify({ logger: true });

  const inspectionEngine = deps.inspectionEngine ?? new LensClient(config.lensUrl);
  const inspectionRepository = deps.inspectionRepository ?? new InspectionHistoryStore(config.databasePath ?? ":memory:");
  const streamMock = deps.streamMock ?? new MockClient(config.mockUrl, config.mockPublicUrl, config.serviceToken);
  const auth = createAuthHook(config);

  registerAuthErrorHandler(app);

  app.get("/health", async () => ({ status: "ok" }));

  app.get("/v1/services", async () => ({
    lens: { url: config.lensUrl },
    mock: { url: config.mockUrl },
  }));

  registerInspectionRoutes(app, { engine: inspectionEngine, auth, repository: inspectionRepository });
  registerStreamRoutes(app, { engine: streamMock, auth });
  registerPlaybackRoutes(app, { engine: streamMock, auth });
  app.addHook("onClose", () => inspectionRepository.close?.());

  if (!config.clerkSecretKey) {
    app.log.warn("auth disabled: CLERK_SECRET_KEY não configurada (dev-mode aberto)");
  }

  return app;
}
