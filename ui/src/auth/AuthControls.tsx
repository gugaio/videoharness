import { Link } from "react-router-dom";
import { Show, SignInButton, UserButton } from "@clerk/react";
import { AUTH_ENABLED } from "../auth/auth";

/** CTA principal: vai pro dashboard (logado) ou abre sign-in. */
export function StartButton({
  className = "cta",
  to = "/dashboard",
  label = "Abrir dashboard",
  signedOutLabel = "Entrar e abrir dashboard",
}: {
  className?: string;
  to?: string;
  label?: string;
  signedOutLabel?: string;
}) {
  if (!AUTH_ENABLED) {
    return (
      <Link to={to} className={className}>
        {label}
      </Link>
    );
  }
  return (
    <>
      <Show when="signed-out">
        <SignInButton mode="modal">
          <button type="button" className={className}>
            {signedOutLabel}
          </button>
        </SignInButton>
      </Show>
      <Show when="signed-in">
        <Link to={to} className={className}>
          {label}
        </Link>
      </Show>
    </>
  );
}

/** Botão que abre o modal de sign-in do Clerk (usado quando deslogado). */
export function SignInModalButton({
  className,
  label,
  onTrigger,
}: {
  className?: string;
  label: string;
  onTrigger?: () => void;
}) {
  return (
    <SignInButton mode="modal">
      <button type="button" className={className} onClick={onTrigger}>
        {label}
      </button>
    </SignInButton>
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
