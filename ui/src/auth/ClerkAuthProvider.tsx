import { ClerkProvider, useAuth } from "@clerk/react";
import type { ReactNode } from "react";
import { CLERK_PUBLISHABLE_KEY } from "./auth";
import { AuthContext } from "./auth-context";

function ClerkAuthBridge({ children }: { children: ReactNode }) {
  const { isLoaded, isSignedIn, userId } = useAuth();
  return (
    <AuthContext.Provider value={{ userId: userId ?? null, isLoaded, isSignedIn: isSignedIn ?? false }}>
      {children}
    </AuthContext.Provider>
  );
}

export function ClerkAuthProvider({ children }: { children: ReactNode }) {
  return (
    <ClerkProvider
      publishableKey={CLERK_PUBLISHABLE_KEY!}
      afterSignOutUrl="/"
    >
      <ClerkAuthBridge>{children}</ClerkAuthBridge>
    </ClerkProvider>
  );
}
