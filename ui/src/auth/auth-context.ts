import { createContext, useContext } from "react";

export type AuthState = {
  userId: string | null;
  isLoaded: boolean;
  isSignedIn: boolean;
};

export const AuthContext = createContext<AuthState>({
  userId: null,
  isLoaded: true,
  isSignedIn: false,
});

export function useVhAuth(): AuthState {
  return useContext(AuthContext);
}
