import { createContext, useContext } from "react";

export type AuthState = {
  isLoaded: boolean;
  isSignedIn: boolean;
};

export const AuthContext = createContext<AuthState>({
  isLoaded: true,
  isSignedIn: false,
});

export function useVhAuth(): AuthState {
  return useContext(AuthContext);
}
