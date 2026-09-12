import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ApiError, createInspection, deleteInspection, getInspection, getSnapshot, listInspections } from "../api";
import type { InspectionHistoryItem } from "../api";
import { TimelineView } from "../components/TimelineView";
import { DrmOverview } from "../components/DrmOverview";
import { HealthOverview } from "../components/HealthOverview";
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
  const history = useQuery({
    queryKey: ["inspections"],
    queryFn: listInspections,
  });
  const create = useMutation({
    mutationFn: (url: string) => createInspection(url),
    onSuccess: (created) => {
      void history.refetch();
      void navigate(`/dashboard/inspect/${created.inspection_id}`);
    },
  });
  const remove = useMutation({
    mutationFn: (inspectionId: string) => deleteInspection(inspectionId),
    onSuccess: () => {
      void history.refetch();
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
      <InspectionHistory
        history={history.data?.inspections ?? []}
        isLoading={history.isPending}
        deletingId={remove.isPending ? remove.variables : undefined}
        error={remove.isError ? (remove.error instanceof ApiError ? remove.error.message : "erro desconhecido") : undefined}
        onDelete={(inspectionId) => {
          if (window.confirm("Excluir esta inspeção do histórico?")) remove.mutate(inspectionId);
        }}
      />
    </section>
  );
}

function InspectionHistory({
  history,
  isLoading,
  deletingId,
  error,
  onDelete,
}: {
  history: InspectionHistoryItem[];
  isLoading: boolean;
  deletingId: string | undefined;
  error: string | undefined;
  onDelete: (inspectionId: string) => void;
}) {
  return (
    <section className="inspection-history" aria-labelledby="inspection-history-title">
      <h3 id="inspection-history-title">Suas inspeções</h3>
      {isLoading && <p className="state">Carregando histórico…</p>}
      {!isLoading && history.length === 0 && (
        <p className="panel-hint">As inspeções que você criar aparecerão aqui.</p>
      )}
      {error && (
        <p role="alert" className="state-error">
          Falha ao excluir: {error}
        </p>
      )}
      {history.length > 0 && (
        <ul className="inspection-history-list">
          {history.map((inspection) => (
            <li key={inspection.inspection_id}>
              <Link to={`/dashboard/inspect/${inspection.inspection_id}`} className="inspection-history-link">
                <span className="inspection-history-url">{inspection.source_url}</span>
                <span className="inspection-history-meta">
                  <span className={`badge badge-${inspection.status}`}>{inspection.status}</span>
                  <time dateTime={inspection.created_at}>{formatHistoryDate(inspection.created_at)}</time>
                  {inspection.snapshot_available && <span>snapshot salvo</span>}
                </span>
              </Link>
              <button
                type="button"
                className="inspection-history-delete"
                disabled={deletingId !== undefined}
                aria-label={`Excluir inspeção ${inspection.inspection_id}`}
                onClick={() => onDelete(inspection.inspection_id)}
              >
                {deletingId === inspection.inspection_id ? "Excluindo…" : "Excluir"}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function formatHistoryDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleString("pt-BR");
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
  const previousSnapshot = useQuery({
    queryKey: ["previous-snapshot", inspectionId, snapshot.data?.source.display_url],
    enabled: snapshot.data !== undefined,
    queryFn: async () => {
      const current = snapshot.data;
      if (!current) return null;
      const history = await listInspections();
      const previous = history.inspections.find((item) =>
        item.inspection_id !== inspectionId
        && item.snapshot_available
        && item.source_url === current.source.display_url
        && new Date(item.created_at).valueOf() < new Date(current.created_at).valueOf()
      );
      return previous ? { item: previous, snapshot: await getSnapshot(previous.inspection_id) } : null;
    },
    retry: false,
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
          <HealthOverview snapshot={snapshot.data} />
          <SnapshotComparison current={snapshot.data} previous={previousSnapshot.data ?? null} />
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

function SnapshotComparison({
  current,
  previous,
}: {
  current: Snapshot;
  previous: { item: InspectionHistoryItem; snapshot: Snapshot } | null;
}) {
  if (!previous) return null;
  const before = previous.snapshot;
  const metrics = [
    ["Variantes", before.manifest.variant_count, current.manifest.variant_count],
    ["Capturados", before.capture?.captured, current.capture?.captured],
    ["Falhas", before.capture?.failed, current.capture?.failed],
    ["Bytes", before.capture?.total_bytes, current.capture?.total_bytes],
  ] as const;
  return <details className="snapshot-comparison">
    <summary>Comparar com a captura anterior</summary>
    <p>Anterior: <time dateTime={previous.item.created_at}>{formatHistoryDate(previous.item.created_at)}</time></p>
    <div className="comparison-grid">
      {metrics.map(([label, oldValue, newValue]) => {
        const comparable = oldValue != null && newValue != null;
        const delta = comparable ? newValue - oldValue : null;
        return <article key={label}>
          <span>{label}</span>
          <strong>{newValue ?? "—"}</strong>
          <small>{delta == null ? "não comparável" : delta === 0 ? "sem mudança" : `${delta > 0 ? "+" : ""}${delta} desde a anterior`}</small>
        </article>;
      })}
    </div>
  </details>;
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
