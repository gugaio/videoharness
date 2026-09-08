import { verifyToken } from "@clerk/backend";
import type { FastifyError, FastifyInstance, FastifyRequest } from "fastify";
import type { AppConfig } from "./config.js";

export type AuthHook = (request: FastifyRequest) => Promise<void>;

/**
 * Control plane autenticado com Clerk JWT. Sem CLERK_SECRET_KEY configurada,
 * cai em dev-mode aberto (mesma semântica do fallback da UI; nunca usar em
 * produção). Erro vira 401 via setErrorHandler do app.
 */
export function createAuthHook(config: AppConfig): AuthHook {
  const secretKey = config.clerkSecretKey;
  if (!secretKey) {
    return async () => undefined;
  }
  return async (request: FastifyRequest) => {
    const authorization = request.headers.authorization ?? "";
    const [scheme, token] = authorization.split(" ", 2);
    if (scheme?.toLowerCase() !== "bearer" || !token) {
      throw Object.assign(new Error("missing bearer token"), { statusCode: 401 });
    }
    try {
      await verifyToken(token, { secretKey });
    } catch {
      throw Object.assign(new Error("invalid token"), { statusCode: 401 });
    }
  };
}

export function registerAuthErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error: FastifyError, _request, reply) => {
    if (error.statusCode === 401) {
      void reply.status(401).send({ error: "unauthorized" });
      return;
    }
    void reply.send(error);
  });
}
