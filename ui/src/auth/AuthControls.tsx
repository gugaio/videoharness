import { Link } from "react-router-dom";
import { Show, SignInButton, UserButton } from "@clerk/react";
import { AUTH_ENABLED } from "../auth/auth";

/** CTA principal: vai pro dashboard (logado) ou abre sign-in. */
export function StartButton({ className = "cta" }: { className?: string }) {
  if (!AUTH_ENABLED) {
    return (
      <Link to="/dashboard" className={className}>
        Abrir dashboard
      </Link>
    );
  }
  return (
    <>
      <Show when="signed-out">
        <SignInButton mode="modal">
          <button type="button" className={className}>
            Entrar e abrir dashboard
          </button>
        </SignInButton>
      </Show>
      <Show when="signed-in">
        <Link to="/dashboard" className={className}>
          Abrir dashboard
        </Link>
      </Show>
    </>
  );
}

/** Controles de sessão do header do dashboard. */
export function SessionControls() {
  if (!AUTH_ENABLED) {
    return <span className="session-chip">dev</span>;
  }
  return (
    <>
      <Show when="signed-in">
        <UserButton />
      </Show>
      <Show when="signed-out">
        <SignInButton mode="modal">
          <button type="button" className="session-chip session-chip-button">
            Entrar
          </button>
        </SignInButton>
      </Show>
    </>
  );
}
