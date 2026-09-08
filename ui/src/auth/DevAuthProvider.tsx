import type { ReactNode } from "react";
import { AuthContext } from "./auth-context";

/**
 * Fallback de desenvolvimento: sem VITE_CLERK_PUBLISHABLE_KEY, o dashboard
 * abre sem login (banner visível). NUNCA habilitar esse modo em produção.
 */
export function DevAuthProvider({ children }: { children: ReactNode }) {
  return (
    <AuthContext.Provider value={{ isLoaded: true, isSignedIn: true }}>
      <div className="dev-banner" role="note">
        Modo dev: autenticação desativada (sem VITE_CLERK_PUBLISHABLE_KEY).
      </div>
      {children}
    </AuthContext.Provider>
  );
}
