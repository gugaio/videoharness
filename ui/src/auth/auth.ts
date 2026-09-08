export const CLERK_PUBLISHABLE_KEY = import.meta.env
  .VITE_CLERK_PUBLISHABLE_KEY as string | undefined;

/** Auth real (Clerk) só liga com chave configurada; sem ela, dev-mode aberto. */
export const AUTH_ENABLED = Boolean(CLERK_PUBLISHABLE_KEY);
