import { useAuth } from "@clerk/react";
import { useEffect } from "react";
import { setTokenGetter } from "../api";

/**
 * Ponte Clerk → fetch: registra getToken() para que toda chamada de API
 * anexe `Authorization: Bearer <jwt>` (token de sessão curto, renovado
 * pelo SDK). Renderizado apenas no modo Clerk.
 */
export function AuthTokenBridge() {
  const { getToken } = useAuth();

  useEffect(() => {
    setTokenGetter((options) => getToken(options));
    return () => setTokenGetter(null);
  }, [getToken]);

  return null;
}
