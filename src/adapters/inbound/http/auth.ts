import { Buffer } from "node:buffer";
import { verifyToken } from "@clerk/backend";
import type { FastifyError, FastifyInstance, FastifyRequest } from "fastify";
import type { AppConfig } from "../../../infrastructure/config.js";

export type AuthHook = (request: FastifyRequest) => Promise<void>;
export const DEV_OWNER_ID = "dev-user";

declare module "fastify" {
  interface FastifyRequest {
    vhOwnerId: string;
  }
}

type AuthErrorCode = "missing_token" | "invalid_token";

type AuthError = Error & {
  statusCode: 401;
  code: AuthErrorCode;
  tokenIss?: string;
  cause?: unknown;
};

function authError(code: AuthErrorCode, cause?: unknown, tokenIss?: string): AuthError {
  const error = new Error(
    code === "missing_token" ? "missing bearer token" : "invalid token",
  ) as AuthError;
  error.statusCode = 401;
  error.code = code;
  if (tokenIss !== undefined) {
    error.tokenIss = tokenIss;
  }
  if (cause !== undefined) {
    error.cause = cause;
  }
  return error;
}

/** Decode sem validar assinatura: só para diagnóstico (identifica a instância Clerk). */
function tokenIssuer(token: string): string | undefined {
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString()) as {
      iss?: string;
    };
    return typeof payload.iss === "string" ? payload.iss : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Control plane autenticado com Clerk JWT. Sem CLERK_SECRET_KEY configurada,
 * cai em dev-mode aberto (mesma semântica do fallback da UI; nunca usar em
 * produção). Erro vira 401 via setErrorHandler do app.
 */
export function createAuthHook(config: AppConfig): AuthHook {
  const secretKey = config.clerkSecretKey;
  if (!secretKey) {
    return async (request) => {
      request.vhOwnerId = DEV_OWNER_ID;
    };
  }
  return async (request: FastifyRequest) => {
    const authorization = request.headers.authorization ?? "";
    const [scheme, token] = authorization.split(" ", 2);
    if (scheme?.toLowerCase() !== "bearer" || !token) {
      throw authError("missing_token");
    }
    try {
      const payload = await verifyToken(token, { secretKey });
      if (typeof payload.sub !== "string" || payload.sub.length === 0) {
        throw authError("invalid_token");
      }
      request.vhOwnerId = payload.sub;
    } catch (cause) {
      throw authError("invalid_token", cause, tokenIssuer(token));
    }
  };
}

export function registerAuthErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error: FastifyError, request, reply) => {
    if (error.statusCode === 401) {
      const auth = error as AuthError;
      const cause = auth.cause;
      request.log.warn(
        {
          code: auth.code,
          ...(auth.tokenIss ? { token_iss: auth.tokenIss } : {}),
          ...(cause instanceof Error ? { reason: `${cause.name}: ${cause.message}` } : {}),
        },
        "auth rejected request",
      );
      void reply.status(401).send({ error: "unauthorized" });
      return;
    }
    void reply.send(error);
  });
}
