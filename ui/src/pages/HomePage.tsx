import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { ApiError, createInspection } from "../api";
import { AUTH_ENABLED } from "../auth/auth";
import { useVhAuth } from "../auth/auth-context";
import { SignInModalButton, StartButton } from "../auth/AuthControls";
import "./home.css";

function stashPendingUrl(raw: string) {
  const trimmed = raw.trim();
  if (!trimmed) return;
  try {
    sessionStorage.setItem("vh_pending_inspect_url", trimmed);
  } catch {
    // sessionStorage indisponível
  }
}

export default function HomePage() {
  const navigate = useNavigate();
  const { isSignedIn } = useVhAuth();
  const [url, setUrl] = useState("");
  const [aboutOpen, setAboutOpen] = useState(false);

  const inspectMutation = useMutation({
    mutationFn: (targetUrl: string) => createInspection(targetUrl),
    onSuccess: (created) => {
      void navigate(`/dashboard/inspect/${created.inspection_id}`);
    },
  });

  useEffect(() => {
    if (!aboutOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setAboutOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [aboutOpen]);

  const canActDirectly = !AUTH_ENABLED || isSignedIn;

  return (
    <div className="vh-home">
      <header className="vh-topbar">
        <Link to="/" className="vh-brand-name">
          Video Harness
        </Link>

        <div className="vh-topbar-actions">
          <button
            type="button"
            className="vh-ghost-pill"
            onClick={() => setAboutOpen(true)}
          >
            Sobre
          </button>
          <StartButton
            className="vh-solid-pill"
            label="Dashboard"
            signedOutLabel="Entrar"
          />
        </div>
      </header>

      <main className="vh-stage">
        <h1>
          Investigue e Teste Streams
          <br />
          de Vídeo em Segundos
        </h1>
        <p className="vh-subtitle">
          Inspeção determinística de HLS e DASH, clones de reprodução e telemetria por SLA.
          <br className="vh-br-desktop" />{" "}
          Para Devs, QA e agentes testarem comportamento de playback sob qualquer condição.
        </p>
      </main>

      <div className="vh-dock">
        <form
          className="vh-url-bar"
          onSubmit={(event) => {
            event.preventDefault();
            if (!canActDirectly) return;
            const trimmed = url.trim();
            if (!trimmed) {
              void navigate("/dashboard/inspect");
              return;
            }
            inspectMutation.mutate(trimmed);
          }}
        >
          <input
            type="url"
            className="vh-url-input"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="Cole a URL do seu stream HLS ou DASH aqui ..."
            aria-label="URL do stream HLS ou DASH"
          />

          {canActDirectly ? (
            <button
              type="submit"
              className="vh-url-cta"
              disabled={inspectMutation.isPending}
            >
              {inspectMutation.isPending ? "Inspecionando…" : "Inspecionar"}
            </button>
          ) : (
            <SignInModalButton
              className="vh-url-cta"
              label="Inspecionar"
              onTrigger={() => stashPendingUrl(url)}
            />
          )}
        </form>

        {inspectMutation.isError && (
          <p role="alert" className="vh-url-error">
            Falha ao iniciar inspeção:{" "}
            {inspectMutation.error instanceof ApiError
              ? inspectMutation.error.message
              : "verifique a URL ou tente pelo dashboard"}
          </p>
        )}
      </div>

      {aboutOpen && (
        <div
          className="vh-modal-backdrop"
          role="presentation"
          onClick={() => setAboutOpen(false)}
        >
          <section
            className="vh-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="vh-about-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="vh-modal-head">
              <h2 id="vh-about-title">Sobre o Video Harness</h2>
              <button
                type="button"
                className="vh-modal-close"
                onClick={() => setAboutOpen(false)}
              >
                Fechar
              </button>
            </div>
            <p>
              Camada unificada de orquestração e diagnóstico de streaming sobre
              as engines <strong>Stream Lens</strong> e <strong>Stream Mock</strong>.
            </p>
            <ul>
              <li><strong>Inspect:</strong> snapshots canônicos de HLS/DASH, codecs, GOP e entrega HTTP.</li>
              <li><strong>Streams &amp; Lab:</strong> clones, proxy on-demand, presets de falha e correlação CMCD.</li>
              <li><strong>Boards &amp; MCP:</strong> monitoramento por SLA e conexão segura para agentes via <code>/api/mcp</code>.</li>
            </ul>
          </section>
        </div>
      )}
    </div>
  );
}
