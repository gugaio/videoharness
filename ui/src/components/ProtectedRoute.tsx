import { Outlet, Navigate } from "react-router-dom";
import { useVhAuth } from "../auth/auth-context";

export default function ProtectedRoute() {
  const { isLoaded, isSignedIn } = useVhAuth();

  if (!isLoaded) {
    return (
      <div className="auth-loading">Carregando…</div>
    );
  }

  if (!isSignedIn) {
    return <Navigate to="/" replace />;
  }

  return <Outlet />;
}
