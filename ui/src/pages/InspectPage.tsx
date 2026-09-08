import { useMutation, useQuery } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import { ApiError, createInspection, getInspection, getSnapshot } from "../api";
import { TimelineView } from "../components/TimelineView";
import { DrmOverview } from "../components/DrmOverview";
import type { Snapshot } from "../snapshot";

const KIND_LABELS: Record<string, string> = {
  hls_master_playlist: "Master playlist",
  hls_media_playlist: "Media playlist",
  dash_mpd: "MPD",
  unknown: "Manifesto",
};

const STAGE_LABELS: Record<string, string> = {
  queued: "na fila",
  fetching_manifest: "obtendo manifesto",
  parsing_manifest: "interpretando manifesto",
  resolving_segments: "resolvendo segmentos",
  capturing_segments: "capturando segmentos",
  inspecting_containers: "inspecionando containers",
  building_snapshot: "construindo snapshot",
};

const ACTIVE_STATUSES = new Set([
  "queued",
  "fetching_manifest",
  "parsing_manifest",
  "resolving_segments",
  "capturing_segments",
  "inspecting_containers",
  "building_snapshot",
]);

const TERMINAL_OK = new Set(["completed", "partial"]);

function formatBytes(n: number): string {
  if (n >= 1_048_576) return `${(n / 1_048_576).toFixed(2)} MiB`;
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KiB`;
  return `${n} B`;
}

export default function InspectPage() {
  return <InspectForm />;
}

function InspectForm() {
  const navigate = useNavigate();
  const create = useMutation({
    mutationFn: (url: string) => createInspection(url),
    onSuccess: (created) => {
      void navigate(`/dashboard/inspect/${created.inspection_id}`);
    },
  });

  return (
    <section className="panel">
      <h2>Inspect</h2>
      <p className="panel-hint">
        Cria uma inspeção no Stream Lens: manifesto, janela curta de segmentos e
        snapshot canônico versionado.
      </p>
      <form
        className="inspect-form"
        onSubmit={(event) => {
          event.preventDefault();
          const input = new FormData(event.currentTarget).get("url");
          if (typeof input === "string" && input.trim()) create.mutate(input.trim());
        }}
      >
        <input
          name="url"
          type="url"
          required
          placeholder="https://exemplo.com/master.m3u8"
          aria-label="URL do manifesto"
        />
        <button type="submit" className="cta" disabled={create.isPending}>
          {create.isPending ? "Criando…" : "Inspecionar"}
        </button>
      </form>
      {create.isError && (
        <p role="alert" className="state-error">
          Falha ao criar inspeção: {create.error instanceof ApiError ? create.error.message : "erro desconhecido"}
        </p>
      )}
    </section>
  );
}

export function InspectionDetailPage() {
  const { inspectionId = "" } = useParams();

  const detail = useQuery({
    queryKey: ["inspection", inspectionId],
    queryFn: () => getInspection(inspectionId),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status && ACTIVE_STATUSES.has(status) ? 1_000 : false;
    },
    retry: (failureCount, error) => !(error instanceof ApiError && [400, 404, 410].includes(error.status)) && failureCount < 2,
  });

  const status = detail.data?.status;
  const snapshot = useQuery({
    queryKey: ["snapshot", inspectionId],
    queryFn: () => getSnapshot(inspectionId),
    enabled: status !== undefined && TERMINAL_OK.has(status),
  });

  if (detail.isPending) return <p className="state">Carregando inspeção…</p>;

  if (detail.isError) {
    const message = detail.error instanceof ApiError ? detail.error.message : "erro desconhecido";
    return (
      <div role="alert" className="panel state-error">
        <p>Falha ao carregar a inspeção: {message}</p>
      </div>
    );
  }

  const data = detail.data;
  const isRunning = status !== undefined && ACTIVE_STATUSES.has(status);
  const manifest = snapshot.data?.manifest ?? data.manifest;
  const sourceUrl = snapshot.data?.source?.display_url;
  const media = snapshot.data?.media ?? null;

  return (
    <section className="panel inspect-detail">
      <header className="inspection-summary">
        <div className="inspection-title-line">
          <span className={`badge badge-${status}`}>{status}</span>
          <h2>{data.protocol ?? (isRunning ? "Inspeção" : "—")}</h2>
          {manifest && <span className="manifest-kind">{KIND_LABELS[manifest.kind] ?? manifest.kind}</span>}
          {snapshot.data && (
            <span className="snapshot-meta">
              schema {snapshot.data.schema_version} · analyzer {snapshot.data.analyzer_version}
            </span>
          )}
        </div>
        {sourceUrl && (
          <p className="source-url" title={sourceUrl}>
            {sourceUrl}
          </p>
        )}
      </header>

      {manifest && (
        <dl className="inspection-metrics">
          <div>
            <dt>Modo</dt>
            <dd>{manifest.is_live ? "Live" : "VOD"}</dd>
          </div>
          {manifest.variant_count != null && (
            <div>
              <dt>{manifest.protocol === "DASH" ? "Adaptation sets" : "Variantes"}</dt>
              <dd>{manifest.variant_count}</dd>
            </div>
          )}
          {snapshot.data?.capture && (
            <div>
              <dt>Captura</dt>
              <dd>
                {snapshot.data.capture.captured}/{snapshot.data.capture.planned}
              </dd>
            </div>
          )}
          {snapshot.data?.capture && (
            <div>
              <dt>Dados</dt>
              <dd>{formatBytes(snapshot.data.capture.total_bytes)}</dd>
            </div>
          )}
        </dl>
      )}

      {isRunning && (
        <p className="state progress-state" role="status">
          <span className="progress-pulse" aria-hidden="true" />
          {STAGE_LABELS[status!] ?? status}…
          {status === "capturing_segments" && data.segments_planned != null && (
            <span>
              {" "}
              {data.segments_captured ?? 0}
              {data.segments_failed ? ` + ${data.segments_failed} falhas` : ""} / {data.segments_planned}
            </span>
          )}
        </p>
      )}

      {status === "failed" && (
        <div role="alert" className="state-error">
          {data.error_stage && (
            <p>
              estágio <code>{data.error_stage}</code>: {data.error_message}
            </p>
          )}
        </div>
      )}

      {snapshot.isPending && status !== undefined && TERMINAL_OK.has(status) && (
        <p className="state progress-state" role="status">
          <span className="progress-pulse" aria-hidden="true" />
          Carregando snapshot…
        </p>
      )}

      {snapshot.data && (
        <>
          {media && media.warnings.length > 0 && (
            <ul className="inspection-warnings" aria-label="Avisos da mídia">
              {media.warnings.map((warning, index) => (
                <li key={index}>{warning}</li>
              ))}
            </ul>
          )}
          <DrmOverview media={media} />
          <TimelineView
            media={media}
            timeline={snapshot.data.timeline}
            segments={snapshot.data.segments}
            containers={snapshot.data.containers}
            bitrateObservations={snapshot.data.bitrate_observations}
            delivery={snapshot.data.delivery ?? null}
            capture={snapshot.data.capture}
          />
          <SnapshotWarnings snapshot={snapshot.data} />
          <details className="raw-json">
            <summary>Snapshot JSON bruto</summary>
            <pre>
              <code>{JSON.stringify(snapshot.data, null, 2)}</code>
            </pre>
          </details>
        </>
      )}
    </section>
  );
}

function SnapshotWarnings({ snapshot }: { snapshot: Snapshot }) {
  if (snapshot.warnings.length === 0) return null;
  return (
    <ul className="inspection-warnings" aria-label="Avisos da inspeção">
      {snapshot.warnings.map((warning, index) => (
        <li key={index}>{warning}</li>
      ))}
    </ul>
  );
}
