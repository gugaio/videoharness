import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ApiError,
  controlLive,
  createProxyPlayback,
  createStream,
  deleteStream,
  getLive,
  getStream,
  getWorkspace,
  listStreams,
  setStreamPreset,
} from "../api";
import type { LiveAction, MockStream, StreamFormat, ProtectionMode, TrackSelection } from "../api";
import { MOCK_PRESETS } from "../presets";
import { MockActivityPanel } from "../components/MockActivityPanel";
import { PlaybackPreview } from "../components/PlaybackPreview";
import { PlaybackInspector } from "../components/PlaybackInspector";

type PlayerTarget = { source: string; preset: string; format: StreamFormat };

const ACTIVE_CAPTURE = new Set(["queued", "capturing"]);

function formatBytes(n: number): string {
  if (n >= 1_073_741_824) return `${(n / 1_073_741_824).toFixed(2)} GiB`;
  if (n >= 1_048_576) return `${(n / 1_048_576).toFixed(1)} MiB`;
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KiB`;
  return `${n} B`;
}

function errorMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : "erro desconhecido";
}

export default function StreamsPage() {
  const [mode, setMode] = useState<"clone" | "proxy">("clone");
  const [proxyFilter, setProxyFilter] = useState<{ source: string; preset: string } | null>(null);
  const [player, setPlayer] = useState<PlayerTarget | null>(null);
  const workspace = useQuery({ queryKey: ["workspace"], queryFn: getWorkspace });
  const streams = useQuery({
    queryKey: ["streams"],
    queryFn: listStreams,
    refetchInterval: (query) => {
      const items = query.state.data?.streams ?? [];
      return items.some((stream) => ACTIVE_CAPTURE.has(stream.capture_status)) ? 2_000 : 15_000;
    },
  });

  const clones = (streams.data?.streams ?? []).filter((stream) => stream.mode === "clone");

  return (
    <section className="panel">
      <header className="streams-header">
        <div>
          <h2>Streams</h2>
          <p className="panel-hint">
            Clone ou proxie streams no Stream Mock. O orquestrador só injeta o
            dono; clones ficam no armazenamento do mock e o proxy não grava nada.
          </p>
        </div>
        {workspace.data && <WorkspaceSummary workspace={workspace.data} />}
      </header>

      <div className="streams-mode" role="tablist" aria-label="Modo do Stream Mock">
        <button
          type="button"
          role="tab"
          aria-selected={mode === "clone"}
          className={mode === "clone" ? "streams-mode-active" : ""}
          onClick={() => setMode("clone")}
        >
          <strong>Clonar</strong>
          <span>Cópia local que reproduz mesmo se a origem cair.</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === "proxy"}
          className={mode === "proxy" ? "streams-mode-active" : ""}
          onClick={() => setMode("proxy")}
        >
          <strong>Proxy sem clonar</strong>
          <span>Repassa a origem ao vivo, sem gravar nada, limitado a 300 s.</span>
        </button>
      </div>

      {mode === "clone" ? (
        <>
          <CreateCloneForm
            onCreated={() => {
              void streams.refetch();
              void workspace.refetch();
            }}
          />

          {streams.isPending && <p className="state">Carregando streams…</p>}
          {streams.isError && (
            <p role="alert" className="state-error">
              Falha ao carregar streams: {errorMessage(streams.error)}
            </p>
          )}
          {!streams.isPending && !streams.isError && clones.length === 0 && (
            <p className="panel-hint">Nenhum clone ainda. Crie o primeiro acima.</p>
          )}
          {clones.length > 0 && (
            <div className="streams-list">
              {clones.map((stream) => (
                <CloneRow key={stream.id} stream={stream} />
              ))}
            </div>
          )}
        </>
      ) : (
        <>
          <ProxyPlaybackForm
            slug={workspace.data?.slug}
            onGenerated={(input) => setProxyFilter({ source: input.url, preset: input.preset })}
            onPlay={(input) =>
              setPlayer({ source: input.url, preset: input.preset, format: input.format })
            }
          />
          <MockActivityPanel
            mode="proxy"
            {...(proxyFilter ? { source: proxyFilter.source, preset: proxyFilter.preset } : {})}
          />
        </>
      )}

      {player && (
        <section className="pb-lab">
          <header className="pb-lab-head">
            <div>
              <h3>Playback Lab</h3>
              <p className="panel-hint">
                O player abaixo toca via capability URL e envia CMCD/observer para
                o mock; o Inspector mostra a timeline correlacionada.
              </p>
            </div>
            <button type="button" className="streams-button" onClick={() => setPlayer(null)}>
              Fechar
            </button>
          </header>
          <PlaybackPreview source={player.source} preset={player.preset} format={player.format} />
          <PlaybackInspector source={player.source} preset={player.preset} />
        </section>
      )}
    </section>
  );
}

function WorkspaceSummary({ workspace }: { workspace: Awaited<ReturnType<typeof getWorkspace>> }) {
  const quota =
    workspace.quota_bytes > 0 ? `${formatBytes(workspace.quota_bytes)}` : "ilimitado";
  return (
    <dl className="streams-workspace">
      <div>
        <dt>Workspace</dt>
        <dd>
          <code>{workspace.slug}</code>
        </dd>
      </div>
      <div>
        <dt>Armazenamento</dt>
        <dd>
          {formatBytes(workspace.stored_bytes)} / {quota}
        </dd>
      </div>
      <div>
        <dt>Expiração</dt>
        <dd>
          {workspace.clone_ttl_hours > 0 ? `${workspace.clone_ttl_hours}h` : "sem expiração"}
        </dd>
      </div>
    </dl>
  );
}

function CreateCloneForm({ onCreated }: { onCreated: () => void }) {
  const [url, setUrl] = useState("");
  const [label, setLabel] = useState("");
  const [format, setFormat] = useState<StreamFormat>("hls");
  const [duration, setDuration] = useState(60);
  const [protection, setProtection] = useState<ProtectionMode>("clear");
  const [tracks, setTracks] = useState<TrackSelection>("highest");
  const [advanced, setAdvanced] = useState(false);

  const create = useMutation({
    mutationFn: () =>
      createStream({
        url: url.trim(),
        ...(label.trim() ? { label: label.trim() } : {}),
        mode: "clone",
        durationSeconds: duration,
        format,
        protectionMode: format === "dash" ? "clear" : protection,
        trackSelection: protection === "clearkey" ? "all" : tracks,
      }),
    onSuccess: () => {
      setUrl("");
      setLabel("");
      onCreated();
    },
  });

  return (
    <form
      className="streams-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (url.trim()) create.mutate();
      }}
    >
      <div className="streams-form-row">
        <input
          type="url"
          name="url"
          required
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder="https://exemplo.com/master.m3u8"
          aria-label="URL da origem"
        />
        <select
          value={format}
          onChange={(event) => {
            const value = event.target.value as StreamFormat;
            setFormat(value);
            if (value === "dash") setProtection("clear");
          }}
          aria-label="Formato"
        >
          <option value="hls">HLS</option>
          <option value="dash">DASH</option>
        </select>
      </div>
      <input
        type="text"
        name="label"
        value={label}
        maxLength={120}
        onChange={(event) => setLabel(event.target.value)}
        placeholder="Rótulo (opcional)"
        aria-label="Rótulo"
      />
      {advanced && (
        <div className="streams-form-advanced">
          <label>
            <span>Duração da captura (s)</span>
            <input
              type="number"
              min={1}
              max={300}
              value={duration}
              onChange={(event) =>
                setDuration(Math.max(1, Math.min(300, Number(event.target.value) || 60)))
              }
            />
          </label>
          <label>
            <span>Proteção</span>
            <select
              value={protection}
              disabled={format === "dash"}
              onChange={(event) => {
                const value = event.target.value as ProtectionMode;
                setProtection(value);
                if (value === "clearkey") setTracks("all");
              }}
            >
              <option value="clear">Clear</option>
              <option value="clearkey">ClearKey (teste de DRM)</option>
            </select>
          </label>
          <label>
            <span>Tracks</span>
            <select
              value={tracks}
              onChange={(event) => setTracks(event.target.value as TrackSelection)}
            >
              <option value="highest">Maior variante + áudio padrão</option>
              <option value="all">Todas as tracks</option>
            </select>
          </label>
        </div>
      )}
      <div className="streams-form-actions">
        <button
          type="button"
          className="streams-advanced-toggle"
          aria-expanded={advanced}
          onClick={() => setAdvanced((value) => !value)}
        >
          {advanced ? "Ocultar avançado" : "Opções avançadas"}
        </button>
        <button type="submit" className="cta" disabled={create.isPending || !url.trim()}>
          {create.isPending ? "Clonando…" : "Clonar"}
        </button>
      </div>
      {create.isError && (
        <p role="alert" className="state-error">
          Falha ao clonar: {errorMessage(create.error)}
        </p>
      )}
    </form>
  );
}

function ProxyPlaybackForm({
  slug,
  onGenerated,
  onPlay,
}: {
  slug?: string;
  onGenerated?: (input: { url: string; preset: string; format: StreamFormat }) => void;
  onPlay?: (input: { url: string; preset: string; format: StreamFormat }) => void;
}) {
  const [url, setUrl] = useState("");
  const [preset, setPreset] = useState("clean");
  const [format, setFormat] = useState<StreamFormat>("hls");
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">("idle");
  const selected = MOCK_PRESETS.find((item) => item.key === preset);

  const generate = useMutation({
    mutationFn: (input: { url: string; preset: string; format: StreamFormat }) =>
      createProxyPlayback(input),
    onSuccess: (_data, input) => {
      setCopyState("idle");
      onGenerated?.(input);
    },
  });

  async function copyPlayback(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopyState("copied");
      window.setTimeout(() => setCopyState("idle"), 2_000);
    } catch {
      setCopyState("error");
    }
  }

  return (
    <form
      className="streams-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (url.trim()) generate.mutate({ url: url.trim(), preset, format });
      }}
    >
      <div className="streams-form-row">
        <input
          type="url"
          value={url}
          required
          onChange={(event) => setUrl(event.target.value)}
          placeholder="https://exemplo.com/live.m3u8"
          aria-label="URL da origem"
        />
        <select
          value={format}
          onChange={(event) => setFormat(event.target.value as StreamFormat)}
          aria-label="Formato"
        >
          <option value="hls">HLS</option>
          <option value="dash">DASH</option>
        </select>
      </div>
      <label className="streams-proxy-preset">
        <span>Preset de caos</span>
        <select value={preset} onChange={(event) => setPreset(event.target.value)}>
          {MOCK_PRESETS.map((item) => (
            <option key={item.key} value={item.key}>
              {item.label}
            </option>
          ))}
        </select>
      </label>
      {selected && <p className="streams-proxy-hint">{selected.description}</p>}
      <div className="streams-form-actions">
        <span className="streams-proxy-scope">
          {slug ? (
            <>
              Workspace <code>{slug}</code>
            </>
          ) : (
            "Carregando workspace…"
          )}
        </span>
        <button type="submit" className="cta" disabled={generate.isPending || !url.trim() || !slug}>
          {generate.isPending ? "Gerando…" : "Gerar URL de proxy"}
        </button>
      </div>
      {generate.isError && (
        <p role="alert" className="state-error">
          Falha ao gerar URL: {errorMessage(generate.error)}
        </p>
      )}
      {generate.data && (
        <div className="streams-proxy-result">
          <input
            readOnly
            value={generate.data.playback_url}
            aria-label="URL de playback"
            onFocus={(event) => event.currentTarget.select()}
          />
          <div className="streams-playback">
            {copyState === "error" && <span className="state-error">Não foi possível copiar.</span>}
            <button
              type="button"
              className="streams-button"
              onClick={() => void copyPlayback(generate.data.playback_url)}
            >
              {copyState === "copied" ? "Copiado!" : "Copiar"}
            </button>
            <a
              className="streams-button"
              href={generate.data.playback_url}
              target="_blank"
              rel="noopener noreferrer"
              title="URL crua (capability): player nativo não envia CMCD nem cria sessão."
            >
              Abrir
            </a>
            {onPlay && (
              <button
                type="button"
                className="streams-button"
                onClick={() =>
                  onPlay({
                    url: new URL(generate.data.playback_url).searchParams.get("url") ?? url.trim(),
                    preset,
                    format,
                  })
                }
              >
                Testar no player
              </button>
            )}
          </div>
        </div>
      )}
      <p className="panel-hint">
        A URL aponta para o seu workspace no mock e repassa a origem ao vivo, sem
        gravar nada (cap de 300 s). Players exigem HTTPS ou localhost.
      </p>
    </form>
  );
}

function CloneRow({
  stream,
}: {
  stream: MockStream;
}) {
  return (
    <article className="streams-row">
      <div className="streams-row-main">
        <div className="streams-row-title">
          {stream.label && <strong>{stream.label}</strong>}
          <span className={`badge badge-${stream.capture_status}`}>{stream.capture_status}</span>
          <span className="streams-format">{stream.format.toUpperCase()}</span>
          {stream.protection_mode === "clearkey" && <span className="badge">ClearKey</span>}
        </div>
        <a
          className="streams-source"
          href={stream.original_url}
          title={stream.original_url}
          target="_blank"
          rel="noopener noreferrer"
        >
          {stream.original_url}
        </a>
        <p className="streams-row-meta">
          {stream.source_live ? "Live snapshot" : "VOD"} ·{" "}
          {stream.video_track_count}V/{stream.audio_track_count}A/
          {stream.subtitle_track_count}S
          {stream.duration_seconds !== undefined && ` · ${stream.duration_seconds.toFixed(1)} s`}
          {stream.total_bytes !== undefined && ` · ${formatBytes(stream.total_bytes)}`}
        </p>
        {stream.capture_status === "capturing" && (
          <div className="streams-progress" role="progressbar" aria-valuenow={stream.capture_progress}>
            <span style={{ width: `${stream.capture_progress}%` }} />
          </div>
        )}
        {stream.error_message && (
          <p role="alert" className="state-error">
            {stream.error_code ? `${stream.error_code}: ` : ""}
            {stream.error_message}
          </p>
        )}
      </div>

      <div className="streams-row-actions">
        <Link className="streams-button streams-dashboard-link" to={`/dashboard/streams/${encodeURIComponent(stream.id)}`}>
          Dashboard
        </Link>
      </div>
    </article>
  );
}

export function StreamDashboardPage() {
  const { streamId = "" } = useParams();
  const navigate = useNavigate();
  const stream = useQuery({
    queryKey: ["stream", streamId],
    queryFn: () => getStream(streamId),
    enabled: Boolean(streamId),
    refetchInterval: (query) => ACTIVE_CAPTURE.has(query.state.data?.stream.capture_status ?? "") ? 2_000 : 15_000,
  });

  if (stream.isPending) return <section className="panel"><p className="state">Carregando dashboard…</p></section>;
  if (stream.isError) return <section className="panel"><p role="alert" className="state-error">Falha ao carregar clone: {errorMessage(stream.error)}</p></section>;
  const clone = stream.data.stream;

  return (
    <section className="panel stream-dashboard">
      <header className="stream-dashboard-header">
        <div>
          <Link className="stream-back" to="/dashboard/streams">← Streams</Link>
          <h2>{clone.label || "Dashboard do clone"}</h2>
          <p className="panel-hint">Acompanhe a configuração e os requests recentes deste clone.</p>
        </div>
        {clone.capture_status === "ready" && (
          <Link className="cta stream-player-cta" to={`/dashboard/streams/${encodeURIComponent(clone.id)}/player`}>
            Player com CMCD
          </Link>
        )}
      </header>
      <CloneOverview stream={clone} />
      <CloneManagement
        stream={clone}
        onChanged={() => void stream.refetch()}
        onDeleted={() => navigate("/dashboard/streams", { replace: true })}
      />
      <MockActivityPanel mode="clone" streamId={clone.id} />
    </section>
  );
}

export function StreamPlayerPage() {
  const { streamId = "" } = useParams();
  const stream = useQuery({
    queryKey: ["stream", streamId],
    queryFn: () => getStream(streamId),
    enabled: Boolean(streamId),
  });

  if (stream.isPending) return <section className="panel"><p className="state">Carregando player…</p></section>;
  if (stream.isError) return <section className="panel"><p role="alert" className="state-error">Falha ao carregar clone: {errorMessage(stream.error)}</p></section>;
  const clone = stream.data.stream;

  return (
    <section className="panel stream-player-dashboard">
      <header className="stream-dashboard-header">
        <div>
          <Link className="stream-back" to={`/dashboard/streams/${encodeURIComponent(clone.id)}`}>← Dashboard do clone</Link>
          <h2>Player com CMCD</h2>
          <p className="panel-hint">{clone.label || clone.original_url}</p>
        </div>
      </header>
      <div className="pb-lab stream-player-lab">
        <PlaybackPreview streamId={clone.id} format={clone.format} />
        <PlaybackInspector streamId={clone.id} />
      </div>
    </section>
  );
}

function CloneOverview({ stream }: { stream: MockStream }) {
  return (
    <dl className="stream-overview">
      <div><dt>Status</dt><dd><span className={`badge badge-${stream.capture_status}`}>{stream.capture_status}</span></dd></div>
      <div><dt>Formato</dt><dd>{stream.format.toUpperCase()}{stream.protection_mode === "clearkey" ? " · ClearKey" : ""}</dd></div>
      <div><dt>Conteúdo</dt><dd>{stream.source_live ? "Live snapshot" : "VOD"}</dd></div>
      <div><dt>Tracks</dt><dd>{stream.video_track_count}V / {stream.audio_track_count}A / {stream.subtitle_track_count}S</dd></div>
      <div><dt>Duração</dt><dd>{stream.duration_seconds !== undefined ? `${stream.duration_seconds.toFixed(1)} s` : "—"}</dd></div>
      <div><dt>Tamanho</dt><dd>{stream.total_bytes !== undefined ? formatBytes(stream.total_bytes) : "—"}</dd></div>
      <div className="stream-overview-source"><dt>Origem</dt><dd title={stream.original_url}>{stream.original_url}</dd></div>
    </dl>
  );
}

function CloneManagement({ stream, onChanged, onDeleted }: { stream: MockStream; onChanged: () => void; onDeleted: () => void }) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">("idle");
  const preset = useMutation({ mutationFn: (value: string) => setStreamPreset(stream.id, value), onSuccess: onChanged });
  const remove = useMutation({ mutationFn: () => deleteStream(stream.id), onSuccess: onDeleted });
  const busy = ACTIVE_CAPTURE.has(stream.capture_status);

  async function copyPlayback() {
    try {
      await navigator.clipboard.writeText(stream.playback_url);
      setCopyState("copied");
      window.setTimeout(() => setCopyState("idle"), 2_000);
    } catch { setCopyState("error"); }
  }

  return (
    <section className="stream-controls" aria-label="Controles do clone">
      <label className="streams-preset"><span>Preset</span><select value={stream.active_preset} disabled={preset.isPending} onChange={(event) => preset.mutate(event.target.value)}>{stream.presets.map((item) => <option key={item.key} value={item.key} title={item.description}>{item.label}</option>)}</select></label>
      {stream.capture_status === "ready" && <button type="button" className="streams-button" onClick={() => void copyPlayback()}>{copyState === "copied" ? "URL copiada" : "Copiar URL"}</button>}
      {stream.format === "hls" && stream.protection_mode === "clear" && stream.capture_status === "ready" && <LiveControls stream={stream} />}
      <button type="button" className="streams-delete" disabled={busy || remove.isPending} onClick={() => { if (window.confirm("Excluir este clone e seus arquivos locais?")) remove.mutate(); }}>{remove.isPending ? "Excluindo…" : "Excluir clone"}</button>
      {copyState === "error" && <span className="state-error">Não foi possível copiar.</span>}
      {remove.isError && <span role="alert" className="state-error">{errorMessage(remove.error)}</span>}
      {preset.isError && <span role="alert" className="state-error">{errorMessage(preset.error)}</span>}
    </section>
  );
}

function LiveControls({ stream }: { stream: MockStream }) {
  const [actionError, setActionError] = useState<string | null>(null);
  const live = useQuery({
    queryKey: ["live", stream.id],
    queryFn: () => getLive(stream.id),
    retry: false,
  });
  const control = useMutation({
    mutationFn: (action: LiveAction) => controlLive(stream.id, action),
    onSuccess: () => {
      setActionError(null);
      void live.refetch();
    },
    onError: (error) => setActionError(errorMessage(error)),
  });

  if (live.isError) return null;
  const status = live.data?.live.status;

  function run(action: LiveAction) {
    control.mutate(action);
  }

  return (
    <div className="streams-live">
      <div className="streams-live-info">
        <strong title="Transmite o clone em modo live (HLS): o mock simula uma transmissão ao vivo a partir do clone, com janela deslizante.">Live simulada</strong>
        <span className="streams-live-status">{status ?? "—"}</span>
      </div>
      <div className="streams-live-actions">
        {(!status || status === "stopped" || status === "ended") && (
          <button type="button" disabled={control.isPending} onClick={() => run("start")}>
            Iniciar
          </button>
        )}
        {status === "playing" && (
          <button type="button" disabled={control.isPending} onClick={() => run("pause")}>
            Pausar
          </button>
        )}
        {status === "paused" && (
          <button type="button" disabled={control.isPending} onClick={() => run("resume")}>
            Retomar
          </button>
        )}
        {(status === "playing" || status === "paused") && (
          <>
            <button type="button" disabled={control.isPending} onClick={() => run("restart")}>
              Reiniciar
            </button>
            <button type="button" disabled={control.isPending} onClick={() => run("stop")}>
              Parar
            </button>
          </>
        )}
        {status && status !== "stopped" && live.data && (
          <a
            className="streams-button"
            href={live.data.live.playback_url}
            target="_blank"
            rel="noopener noreferrer"
          >
            Abrir live
          </a>
        )}
      </div>
      {actionError && (
        <span role="alert" className="state-error">
          {actionError}
        </span>
      )}
    </div>
  );
}
