import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { ApiError, clearWorkspaceRequests, listWorkspaceRequests } from "../api";
import type { ProxyRequest, ProxyRequestFilters } from "../api";
import { WaterfallTrack } from "./WaterfallTrack";

const MAX_ROWS = 20;

function statusClass(status: number): string {
  if (status < 300) return "activity-pill activity-ok";
  if (status < 400) return "activity-pill activity-info";
  if (status < 500) return "activity-pill activity-warn";
  return "activity-pill activity-danger";
}

function kindLabel(kind: ProxyRequest["kind"]): string {
  switch (kind) {
    case "master":
      return "playlist";
    case "variant":
      return "media";
    case "segment":
      return "segment";
    case "license":
      return "license";
    default:
      return "asset";
  }
}

function timeAgo(iso: string): string {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 10) return "agora";
  if (seconds < 60) return `${seconds}s atrás`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m atrás`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h atrás`;
  return `${Math.floor(seconds / 86400)}d atrás`;
}

function formatBytes(bytes: number): string {
  if (bytes <= 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1_048_576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1_048_576).toFixed(1)} MB`;
}

function rangeClass(result: ProxyRequest["range_result"]): string {
  if (result === "satisfied") return "activity-pill activity-ok";
  if (result === "ignored" || result === "missing_content_range" || result === "failed") {
    return "activity-pill activity-danger";
  }
  return "activity-pill activity-muted";
}

function interventionDescription(req: ProxyRequest): string | null {
  const effects: string[] = [];
  if ((req.added_latency_ms ?? 0) > 0) {
    const seconds = ((req.added_latency_ms ?? 0) / 1000)
      .toFixed(2)
      .replace(/\.00$/, "")
      .replace(/(\.\d)0$/, "$1");
    effects.push(`+${seconds}s de latência`);
  }
  if ((req.injected_status ?? 0) > 0) {
    effects.push(`HTTP ${req.injected_status} injetado`);
  }
  return effects.length > 0 ? effects.join(" · ") : null;
}

function originResponse(req: ProxyRequest): string {
  if (req.injected_status) return "Origem não contatada — resposta injetada pelo StreamMock";
  if (req.upstream_status) {
    return `${req.upstream_status}${req.content_range ? ` · ${req.content_range}` : ""}`;
  }
  return `${req.status}`;
}

function cmcdLabel(req: ProxyRequest): string {
  if (!req.cmcd) return "CMCD ausente";
  return req.cmcd.valid ? "CMCD válido" : "CMCD inválido";
}

function cmcdClass(req: ProxyRequest): string {
  if (!req.cmcd) return "activity-pill activity-muted";
  return req.cmcd.valid ? "activity-pill activity-info" : "activity-pill activity-danger";
}

function cmcdErrors(req: ProxyRequest): string {
  return (req.cmcd?.validation_errors ?? [])
    .map((issue) => (typeof issue === "string" ? issue : `${issue.code}${issue.key ? `:${issue.key}` : ""}`))
    .join(", ");
}

export function MockActivityPanel({
  mode,
  streamId,
  source,
  preset,
}: {
  mode: "proxy" | "clone";
  streamId?: string;
  source?: string;
  preset?: string;
}) {
  const [expanded, setExpanded] = useState<number | null>(null);
  const filters: ProxyRequestFilters = {
    mode,
    ...(streamId ? { streamId } : {}),
    ...(source ? { source } : {}),
    ...(preset ? { preset } : {}),
  };

  const board = useQuery({
    queryKey: ["workspace-requests", mode, streamId ?? "", source ?? "", preset ?? ""],
    queryFn: () => listWorkspaceRequests(filters),
    refetchInterval: 4_000,
  });

  const clear = useMutation({
    mutationFn: () => clearWorkspaceRequests(filters),
    onSuccess: () => void board.refetch(),
  });

  const requests = board.data?.requests ?? [];
  const maxDuration = Math.max(1, ...requests.map((req) => req.duration_ms));
  const canClear = Boolean(streamId || source);
  const title = mode === "clone" ? (streamId ? "Últimos requests" : "Atividade dos clones") : "Atividade do proxy";
  const error = board.isError
    ? board.error instanceof ApiError
      ? board.error.message
      : "erro desconhecido"
    : null;

  return (
    <section className="activity" aria-label={title}>
      <header className="activity-header">
        <div>
          <h3>{title}</h3>
          <p className="panel-hint">
            As 20 requests mais recentes {streamId ? "deste clone" : "servidas por este workspace"}.
            Retidas por 24 h, teto de 1.000 linhas.
          </p>
        </div>
        <div className="activity-header-actions">
          <div className="activity-count">
            <span>Exibindo</span>
            <strong>{requests.length}</strong>
          </div>
          {canClear && (
            <button
              type="button"
              className="streams-button"
              disabled={requests.length === 0 || clear.isPending}
              onClick={() => {
                if (window.confirm("Limpar o histórico de atividade deste filtro?")) clear.mutate();
              }}
            >
              {clear.isPending ? "Limpando…" : "Limpar atividade"}
            </button>
          )}
        </div>
      </header>

      {error && (
        <p role="alert" className="state-error">
          {error}
        </p>
      )}
      {clear.isError && (
        <p role="alert" className="state-error">
          Falha ao limpar: {clear.error instanceof ApiError ? clear.error.message : "erro desconhecido"}
        </p>
      )}

      {board.isPending && <p className="state">Carregando atividade…</p>}
      {!board.isPending && requests.length === 0 && (
        <div className="activity-empty">
          <p>Nenhuma request ainda</p>
          <p className="panel-hint">
            {mode === "clone"
              ? "Reproduza um clone e as requests aparecerão aqui."
              : "Abra a URL de proxy em um player ou aba separada; as requests aparecerão aqui."}
          </p>
        </div>
      )}

      {requests.length > 0 && (
        <ul className="activity-list">
          {requests.slice(0, MAX_ROWS).map((req, index) => (
            <li key={req.id || `${req.stream_id}-${req.last_seen_at}-${index}`}>
              <button
                type="button"
                className="activity-row"
                aria-expanded={expanded === index}
                onClick={() => setExpanded(expanded === index ? null : index)}
              >
                <span className={statusClass(req.status)}>{req.status}</span>
                <span className="activity-pill activity-muted activity-kind">{kindLabel(req.kind)}</span>
                <span className={`${cmcdClass(req)} activity-cmcd`}>{cmcdLabel(req)}</span>
                <span className="activity-target">
                  <span className="activity-url" title={req.target_url}>
                    {req.target_url}
                  </span>
                  {interventionDescription(req) && (
                    <span
                      className={`activity-pill ${req.injected_status ? "activity-danger" : "activity-warn"}`}
                    >
                      Intervenção: {interventionDescription(req)}
                    </span>
                  )}
                  <span className="activity-flags">
                    {req.cmcd?.startup && <span className="activity-pill activity-warn">su · urgente</span>}
                    {req.cmcd?.buffer_starvation && (
                      <span className="activity-pill activity-danger">bs · starvation</span>
                    )}
                  </span>
                </span>
                <span className="activity-metric">
                  {(req.duration_ms / 1000).toFixed(2)}s · {formatBytes(req.bytes)}
                  {req.active_preset !== "clean" && ` · ${req.active_preset}`}
                </span>
                {req.client_range && (
                  <span className={`${rangeClass(req.range_result)} activity-range`}>
                    Range: {req.range_result}
                  </span>
                )}
                <span className="activity-time">{timeAgo(req.last_seen_at)}</span>
                <span className="activity-waterfall">
                  <WaterfallTrack request={req} maxDuration={maxDuration} />
                </span>
              </button>
              {expanded === index && (
                <div className="activity-details">
                  <div className="activity-detail-grid">
                    <Detail label="Player Range" value={req.client_range || "Não requisitado"} />
                    <Detail label="Forwarded Range" value={req.forwarded_range || "Não repassado"} />
                    <Detail label="Resposta da origem" value={originResponse(req)} />
                    <Detail
                      label="Tamanho da resposta"
                      value={
                        (req.content_length ?? 0) > 0
                          ? formatBytes(req.content_length ?? 0)
                          : formatBytes(req.bytes)
                      }
                    />
                    <Detail label="CMCD" value={cmcdLabel(req)} />
                    <Detail label="sid" value={req.cmcd?.sid ?? "Não correlacionado"} />
                    <Detail label="ot · br" value={`${req.cmcd?.ot ?? "—"} · ${req.cmcd?.br_kbps ?? "—"} kbps`} />
                    <Detail label="bl · dl" value={`${req.cmcd?.bl_ms ?? "—"} ms · ${req.cmcd?.dl_ms ?? "—"} ms`} />
                    <Detail
                      label="mtp"
                      value={req.cmcd?.mtp_kbps != null ? `${req.cmcd.mtp_kbps} kbps` : "—"}
                    />
                    <Detail
                      label="Timings da origem"
                      value={`DNS ${req.dns_ms ?? "—"} · TCP ${req.connect_ms ?? "—"} · TLS ${req.tls_ms ?? "—"} · TTFB ${req.ttfb_ms ?? "—"} · relay ${req.relay_ms ?? "—"} ms`}
                    />
                    {interventionDescription(req) && (
                      <Detail label="Intervenção" value={interventionDescription(req) ?? ""} />
                    )}
                    {req.transport_error && <Detail label="Erro de transporte" value={req.transport_error} />}
                    {req.content_range && <Detail label="Content-Range" value={req.content_range} />}
                  </div>
                  {req.cmcd && (
                    <div className={`activity-note ${cmcdClass(req)}`}>
                      <span>CMCD normalizado:</span>{" "}
                      <code>{req.cmcd.canonical_value || req.cmcd.raw_value || "payload parcial"}</code>
                      {cmcdErrors(req) && <span className="activity-note-extra">Erros: {cmcdErrors(req)}</span>}
                    </div>
                  )}
                  <div className={`activity-note ${rangeClass(req.range_result)}`}>
                    <span>Range result: {req.range_result}</span>
                    {req.diagnostic && <span className="activity-note-extra">{req.diagnostic}</span>}
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="activity-detail">
      <span>{label}</span>
      <code>{value}</code>
    </div>
  );
}
