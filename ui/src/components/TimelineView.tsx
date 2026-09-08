import { useId, useMemo, useState } from "react";
import type {
  CapturedSegment,
  CaptureReport,
  DeliveryObservation,
  DeliveryReport,
  LivePlaylistObservation,
  Representation,
  RepresentationBitrate,
  RepresentationTimeline,
  TimelineEntry,
  TrackGroup,
  UnifiedMedia,
} from "../snapshot";
import {
  decodeCodecList,
  describeAudioFormat,
  describeAvcLevel,
  describeAvcProfile,
  describeHevcLevel,
  describeHevcProfile,
} from "../codec";
import { ContainerInspector } from "./ContainersView";
import type { ContainerDTO } from "../snapshot";

const KIND_LABELS: Record<string, string> = {
  video: "Vídeo",
  audio: "Áudio",
  subtitle: "Legendas",
  closed_captions: "Closed captions",
  unknown: "Mídia",
};

const STATUS_LABELS: Record<TimelineEntry["status"], string> = {
  captured: "capturado",
  failed: "falhou",
  planned: "planejado",
  init: "init",
};

interface DisplayRow {
  rep: Representation | null;
  timeline: RepresentationTimeline | null;
  repId: string;
  kind: string;
}

interface DisplayGroup {
  key: string;
  kind: string;
  name: string | null;
  language: string | null;
  rows: DisplayRow[];
}

export function formatBytes(n: number | null): string {
  if (n === null) return "—";
  if (n >= 1_048_576) return `${(n / 1_048_576).toFixed(2)} MiB`;
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KiB`;
  return `${n} B`;
}

function formatBandwidth(bps: number | null): string {
  if (bps === null) return "—";
  if (bps >= 1_000_000) return `${(bps / 1_000_000).toFixed(2)} Mbps`;
  return `${Math.round(bps / 1000)} kbps`;
}

function formatDuration(seconds: number | null): string {
  if (seconds === null) return "—";
  return `${seconds.toFixed(seconds < 10 ? 1 : 0)}s`;
}

function formatMilliseconds(value: number | null): string {
  return value === null ? "não observado" : `${value} ms`;
}

function formatRatio(ratio: number | null): string {
  return ratio === null ? "sem referência declarada" : `${(ratio * 100).toFixed(0)}% do declarado`;
}

function AlignmentMetricHeader({ label, help }: { label: string; help: string }) {
  const tooltipId = useId();
  return (
    <th>
      <span className="metric-help" tabIndex={0} aria-describedby={tooltipId}>
        {label}
        <span className="metric-help-icon" aria-hidden="true">?</span>
        <span className="metric-tooltip" id={tooltipId} role="tooltip">{help}</span>
      </span>
    </th>
  );
}

function cacheLabel(item: DeliveryObservation): string {
  const parts = [...item.cache_control];
  if (item.cache_max_age_seconds !== null) parts.push(`max-age ${item.cache_max_age_seconds}s`);
  if (item.cache_age_seconds !== null) parts.push(`idade ${item.cache_age_seconds}s`);
  if (item.cache_etag_present) parts.push("ETag presente");
  return parts.length > 0 ? parts.join(" · ") : "não observado";
}

function BitrateObservations({ observations }: { observations: RepresentationBitrate[] }) {
  if (observations.length === 0) return null;
  return (
    <section className="bitrate-observations" aria-labelledby="bitrate-observations-heading">
      <header>
        <div>
          <span className="eyebrow">Bytes capturados</span>
          <h3 id="bitrate-observations-heading">Bitrate por segmento</h3>
        </div>
        <span>{observations.reduce((total, item) => total + item.segments.length, 0)} segmentos com duração</span>
      </header>
      <p>
        Taxa calculada como bytes do arquivo ÷ duração do segmento. O tamanho das unidades indica concentração de
        payload; não mede a complexidade nem a qualidade do vídeo.
      </p>
      <div className="table-scroll">
        <table className="structure-table bitrate-table">
          <thead><tr>
            <th>Rendição</th>
            <AlignmentMetricHeader label="Média calculada" help="Total de bytes dos segmentos capturados dividido pela soma de suas durações. Não inclui segmentos que falharam ou não tinham duração utilizável." />
            <AlignmentMetricHeader label="Pico por segmento" help="Maior taxa calculada em um segmento individual da janela. Ajuda a revelar picos que pressionam a banda disponível e o buffer." />
            <AlignmentMetricHeader label="Faixa observada" help="Menor e maior taxa calculadas na janela. Grande variação pode indicar conteúdo com payload desigual; este dado, isoladamente, não identifica a causa." />
            <AlignmentMetricHeader label="Declarado no manifesto" help="BANDWIDTH do HLS ou bandwidth do DASH, quando presente. É metadado do manifesto e não uma medição dos bytes baixados." />
          </tr></thead>
          <tbody>{observations.map((item) => (
            <tr key={`${item.group_kind}-${item.rep_id}`}>
              <td><code>{item.rep_id}</code><br /><small>{item.segments.length} segmentos</small></td>
              <td>{formatBandwidth(item.average_bitrate_bps)}</td>
              <td>{formatBandwidth(item.peak_bitrate_bps)}</td>
              <td>{formatBandwidth(item.lowest_bitrate_bps)} — {formatBandwidth(item.peak_bitrate_bps)}</td>
              <td>{formatBandwidth(item.declared_bandwidth_bps)}{item.declared_bandwidth_bps && item.peak_bitrate_bps ? <><br /><small>pico: {formatRatio(item.peak_bitrate_bps / item.declared_bandwidth_bps)}</small></> : null}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      <details className="bitrate-details">
        <summary>Ver medições por segmento</summary>
        <div className="table-scroll">
          <table className="structure-table bitrate-table">
            <thead><tr><th>Rendição / segmento</th><th>Bitrate calculado</th><th>Duração usada</th><th>Unidades observadas</th></tr></thead>
            <tbody>{observations.flatMap((item) => item.segments.map((segment) => (
              <tr key={`${item.rep_id}-${segment.index}`}>
                <td><code>{item.rep_id}</code> · {segment.index}<br /><small>{formatBytes(segment.byte_size)} · {formatRatio(segment.bitrate_ratio_to_declared)}</small></td>
                <td>{formatBandwidth(segment.bitrate_bps)}</td>
                <td>{formatDuration(segment.duration_seconds)}<br /><small>{segment.duration_provenance.includes("container") ? "timestamps do container" : "manifesto"}</small></td>
                <td>{segment.unit_count > 0 ? <>{segment.unit_count} unidades<br /><small>média {formatBytes(segment.average_unit_bytes)} · maior {formatBytes(segment.largest_unit_bytes)}</small></> : "não observadas"}</td>
              </tr>
            )))}</tbody>
          </table>
        </div>
      </details>
    </section>
  );
}

function DeliveryObservations({ delivery, segments }: { delivery: DeliveryReport | null; segments: CapturedSegment[] }) {
  const segmentRequests = segments.filter((item) => item.delivery != null);
  const manifests = delivery?.manifest_requests ?? [];
  const live = delivery?.live_playlists ?? [];
  if (segmentRequests.length === 0 && manifests.length === 0 && live.length === 0 && !delivery?.live_note) return null;
  return (
    <section className="delivery-observations" aria-labelledby="delivery-observations-heading">
      <header>
        <div>
          <span className="eyebrow">Cliente de captura</span>
          <h3 id="delivery-observations-heading">Entrega HTTP e live</h3>
        </div>
        <span>{segmentRequests.length} segmentos com medição HTTP</span>
      </header>
      <p>Tempos são medidos por esta captura, não pelo player. Headers são reduzidos a sinais de cache seguros; ausência de valor não indica uma entrega saudável.</p>
      {segmentRequests.length > 0 && <details className="bitrate-details" open>
        <summary>Ver entrega por segmento</summary>
        <div className="table-scroll"><table className="structure-table bitrate-table"><thead><tr>
          <th>Segmento</th>
          <AlignmentMetricHeader label="TTFB" help="Tempo entre iniciar a requisição e receber o primeiro byte do corpo. Inclui a cadeia de redirects observada; não mede o tempo de início do player." />
          <AlignmentMetricHeader label="Download" help="Tempo total da requisição até o fim da leitura do corpo no cliente de captura." />
          <AlignmentMetricHeader label="Throughput efetivo" help="Bytes recebidos divididos pelo tempo total de download desta requisição. É uma amostra de rede, não a banda disponível para o player." />
          <AlignmentMetricHeader label="HTTP e cache" help="Status final, quantidade de redirects e sinais seguros derivados de Cache-Control, Age e presença de ETag. Valores de headers arbitrários não são persistidos." />
        </tr></thead><tbody>{segmentRequests.map((segment) => {
          const item = segment.delivery!;
          return <tr key={`${segment.rep_id}-${segment.index}-${segment.is_init}`}><td><code>{segment.rep_id}</code> · {segment.is_init ? "init" : segment.index}</td><td>{formatMilliseconds(item.ttfb_ms)}</td><td>{formatMilliseconds(item.download_duration_ms)}</td><td>{formatBandwidth(item.effective_throughput_bps)}</td><td>{item.http_status ?? "não observado"}{item.redirect_count !== null ? ` · ${item.redirect_count} redirects` : ""}<br /><small>{cacheLabel(item)}</small></td></tr>;
        })}</tbody></table></div>
      </details>}
      {live.length > 0 && <LivePlaylists live={live} />}
      {delivery?.live_note && <p className="delivery-note">Live: {delivery.live_note}</p>}
    </section>
  );
}

function LivePlaylists({ live }: { live: LivePlaylistObservation[] }) {
  return <details className="bitrate-details" open>
    <summary>Ver evidência live das playlists</summary>
    <div className="table-scroll"><table className="structure-table bitrate-table"><thead><tr>
      <th>Playlist</th>
      <AlignmentMetricHeader label="Janela declarada" help="Soma das durações EXTINF presentes na playlist obtida. Não é o buffer do player." />
      <AlignmentMetricHeader label="Distância da live edge" help="Só aparece quando PROGRAM-DATE-TIME permite associar um horário ao último segmento: horário da captura menos o fim declarado desse segmento. Relógios do servidor e do cliente podem divergir." />
      <AlignmentMetricHeader label="Avanço" help="Medir avanço requer ao menos duas leituras da mesma playlist. Esta captura faz uma única leitura por playlist, por isso não calcula avanço." />
    </tr></thead><tbody>{live.map((item) => <tr key={`${item.rep_id}-${item.playlist_url}`}><td><code>{item.rep_id ?? "media"}</code><br /><small>seq. {item.media_sequence ?? "não declarada"}–{item.last_segment_sequence ?? "não declarada"}</small></td><td>{formatDuration(item.playlist_window_duration_seconds)}<br /><small>target {formatDuration(item.target_duration_seconds)}</small></td><td>{item.live_edge_distance_seconds === null ? "não observada" : formatDuration(item.live_edge_distance_seconds)}</td><td>{item.advancement}</td></tr>)}</tbody></table></div>
  </details>;
}

function segmentKey(repId: string, index: number, isInit: boolean): string {
  return `${repId}\u0000${isInit ? "init" : index}`;
}

function mediaGroups(media: UnifiedMedia | null, timeline: RepresentationTimeline[]): DisplayGroup[] {
  const usedTimeline = new Set<RepresentationTimeline>();
  const groups: DisplayGroup[] = (media?.track_groups ?? []).map((group, groupIndex) => ({
    key: `${group.kind}-${group.name ?? groupIndex}`,
    kind: group.kind,
    name: group.name,
    language: group.language,
    rows: [...group.representations]
      .sort((a, b) => (a.bandwidth_bps ?? a.average_bandwidth_bps ?? 0) - (b.bandwidth_bps ?? b.average_bandwidth_bps ?? 0))
      .map((rep) => {
        const matched = timeline.find(
          (item) => item.rep_id === rep.id && item.group_kind === group.kind && !usedTimeline.has(item),
        ) ?? timeline.find((item) => item.rep_id === rep.id && !usedTimeline.has(item)) ?? null;
        if (matched) usedTimeline.add(matched);
        return { rep, timeline: matched, repId: rep.id, kind: group.kind };
      }),
  }));

  for (const orphan of timeline.filter((item) => !usedTimeline.has(item))) {
    let group = groups.find((item) => item.kind === orphan.group_kind && item.name === null);
    if (!group) {
      group = { key: `timeline-${orphan.group_kind}`, kind: orphan.group_kind, name: null, language: null, rows: [] };
      groups.push(group);
    }
    group.rows.push({ rep: null, timeline: orphan, repId: orphan.rep_id, kind: orphan.group_kind });
  }

  return groups.filter((group) => group.rows.length > 0);
}

function representationLabel(rep: Representation | null, group: Pick<TrackGroup, "kind" | "language" | "name">): string {
  if (rep?.resolution) return `${rep.resolution.height}p`;
  if (group.kind === "audio") return rep?.language ?? group.language ?? group.name ?? "Áudio";
  if (group.kind === "subtitle") return rep?.language ?? group.language ?? group.name ?? "Legenda";
  return rep?.id.split("/").at(-1) ?? "Faixa";
}

function representationSpecs(rep: Representation | null): string[] {
  if (!rep) return [];
  const specs: string[] = [];
  if (rep.resolution) specs.push(`${rep.resolution.width}×${rep.resolution.height}`);
  if (rep.frame_rate !== null) specs.push(`${rep.frame_rate} fps`);
  if (rep.audio_sampling_rate !== null) specs.push(`${(rep.audio_sampling_rate / 1000).toFixed(1)} kHz`);
  return specs;
}

function CodecSummary({ value }: { value: string }) {
  const tooltipBaseId = useId();

  return (
    <div className="codec-stack">
      {decodeCodecList(value).map((codec, index) => {
        const profileTooltipId = `${tooltipBaseId}-profile-${index}`;
        const levelTooltipId = `${tooltipBaseId}-level-${index}`;
        if (codec.avc) {
          const avc = codec.avc;
          return (
            <div
              className="codec-summary"
              key={`${codec.raw}-${index}`}
              aria-label={`${codec.raw}: ${codec.family}, profile ${avc.profile}, level ${avc.level}`}
            >
              <code
                className="codec-string"
                title={`${avc.profileHex} identifica o profile; ${avc.constraintsHex} contém as restrições; ${avc.levelHex} identifica o level`}
              >
                {avc.prefix}.<span className="codec-profile-byte">{avc.profileHex}</span>
                <span className="codec-constraints-byte">{avc.constraintsHex}</span>
                <span className="codec-level-byte">{avc.levelHex}</span>
              </code>
              <span className="codec-family">{codec.family}</span>
              <span className="codec-pill codec-profile codec-pill-help" tabIndex={0} aria-describedby={profileTooltipId}>
                Profile <strong>{avc.profile}</strong>
                <span className="codec-tooltip codec-tooltip-profile" id={profileTooltipId} role="tooltip">
                  <strong>O que significa Profile {avc.profile}?</strong>
                  <span>{describeAvcProfile(avc.profile)}</span>
                  <span>Profile define quais ferramentas de compressão o decoder deve conhecer. Resolução e fps são limitados pelo Level.</span>
                </span>
              </span>
              <span className="codec-pill codec-level codec-pill-help" tabIndex={0} aria-describedby={levelTooltipId}>
                Level <strong>{avc.level}</strong>
                <span className="codec-tooltip" id={levelTooltipId} role="tooltip">
                  <strong>O que significa Level {avc.level}?</strong>
                  <span>{describeAvcLevel(avc.level)}</span>
                  <span>É um limite de capacidade do decoder — combina resolução, fps, bitrate e buffer. Não mede a qualidade da imagem.</span>
                </span>
              </span>
            </div>
          );
        }

        if (codec.hevc) {
          const hevc = codec.hevc;
          const profileId = `${hevc.profileSpace}${hevc.profileIdc}`;
          return (
            <div
              className="codec-summary"
              key={`${codec.raw}-${index}`}
              aria-label={`${codec.raw}: ${codec.family}, profile ${hevc.profile}, ${hevc.tier === "H" ? "High" : "Main"} tier, level ${hevc.level}`}
            >
              <code
                className="codec-string"
                title={`${profileId} identifica o profile; ${hevc.compatibilityFlags} são flags de compatibilidade; ${hevc.tier}${hevc.levelIdc} identifica tier e level`}
              >
                {hevc.prefix}.<span className="codec-profile-byte">{profileId}</span>.
                <span className="codec-constraints-byte">{hevc.compatibilityFlags}</span>.
                <span className="codec-tier-byte">{hevc.tier}</span><span className="codec-level-byte">{hevc.levelIdc}</span>
                {hevc.constraintFlags && <>.<span className="codec-constraints-byte">{hevc.constraintFlags}</span></>}
              </code>
              <span className="codec-family">{codec.family}</span>
              <span className="codec-pill codec-tier">Tier <strong>{hevc.tier === "H" ? "High" : "Main"}</strong></span>
              <span className="codec-pill codec-profile codec-pill-help" tabIndex={0} aria-describedby={profileTooltipId}>
                Profile <strong>{hevc.profile}</strong>
                <span className="codec-tooltip codec-tooltip-profile" id={profileTooltipId} role="tooltip">
                  <strong>O que significa Profile {hevc.profile}?</strong>
                  <span>{describeHevcProfile(hevc.profile)}</span>
                  <span>Profile define recursos e profundidade de bits que o decoder HEVC precisa suportar.</span>
                </span>
              </span>
              <span className="codec-pill codec-level codec-pill-help" tabIndex={0} aria-describedby={levelTooltipId}>
                Level <strong>{hevc.level}</strong>
                <span className="codec-tooltip" id={levelTooltipId} role="tooltip">
                  <strong>O que significa Level {hevc.level}?</strong>
                  <span>{describeHevcLevel(hevc.level)}</span>
                  <span>{hevc.tier === "H" ? "High Tier" : "Main Tier"} é sinalizado separadamente; level limita resolução, fps, bitrate e buffer, não a qualidade.</span>
                </span>
              </span>
            </div>
          );
        }

        if (codec.audio) {
          const audio = codec.audio;
          const formatTooltipId = `${tooltipBaseId}-audio-${index}`;
          return (
            <div
              className="codec-summary"
              key={`${codec.raw}-${index}`}
              aria-label={`${codec.raw}: ${codec.family}, formato ${audio.format}`}
            >
              <code
                className="codec-string"
                title={audio.objectTypeHex
                  ? `${audio.prefix} identifica MPEG-4 Audio; ${audio.objectTypeHex} é o Object Type Indication hexadecimal; ${audio.audioObjectTypeId ? `${audio.audioObjectTypeId} é o Audio Object Type decimal` : "o Audio Object Type não foi declarado"}`
                  : `${audio.prefix} identifica ${audio.format}`}
              >
                {audio.objectTypeHex ? (
                  <>
                    {audio.prefix}.<span className="codec-object-type-byte">{audio.objectTypeHex}</span>
                    {audio.audioObjectTypeId && <>.<span className="codec-audio-object-type-byte">{audio.audioObjectTypeId}</span></>}
                  </>
                ) : codec.raw}
              </code>
              <span className="codec-family">{codec.family}</span>
              <span className="codec-pill codec-audio codec-pill-help" tabIndex={0} aria-describedby={formatTooltipId}>
                Formato <strong>{audio.format}</strong>
                <span className="codec-tooltip codec-tooltip-audio" id={formatTooltipId} role="tooltip">
                  <strong>Como ler {codec.raw}?</strong>
                  <span>{describeAudioFormat(audio.format)}</span>
                  {audio.objectTypeHex ? (
                    <span>
                      <code>mp4a</code> é a entrada MPEG-4 Audio; <code>{audio.objectTypeHex}</code> é o Object Type Indication hexadecimal;{" "}
                      {audio.audioObjectTypeId
                        ? <><code>{audio.audioObjectTypeId}</code> é o Audio Object Type decimal.</>
                        : "o Audio Object Type não foi declarado na string."}
                    </span>
                  ) : (
                    <span><code>{audio.prefix}</code> é o identificador do codec no container/manifesto.</span>
                  )}
                  <span>A string sozinha não informa bitrate, sample rate, canais, Atmos nem compatibilidade do dispositivo.</span>
                </span>
              </span>
            </div>
          );
        }

        return (
          <div className="codec-summary codec-unknown" key={`${codec.raw}-${index}`}>
            <code>{codec.raw}</code>
          </div>
        );
      })}
    </div>
  );
}

function SegmentDetail({
  repId,
  repLabel,
  entry,
  segment,
  container,
  onClose,
}: {
  repId: string;
  repLabel: string;
  entry: TimelineEntry;
  segment: CapturedSegment | null;
  container: ContainerDTO | null;
  onClose: () => void;
}) {
  const itemLabel = entry.status === "init" ? "Init segment" : `Segmento ${entry.index}`;
  const sequenceLabel = entry.segment_sequence === null || entry.segment_sequence === undefined
    ? null
    : `Sequência do segmento: ${entry.segment_sequence}`;
  const delivery = segment?.delivery ?? null;

  return (
    <section className="segment-detail" aria-label={`Detalhes de ${itemLabel.toLowerCase()}`}>
      <header className="segment-detail-header">
        <div>
          <nav className="detail-path" aria-label="Caminho da seleção">
            <span>{repLabel}</span>
            <span aria-hidden="true">/</span>
            <span>{itemLabel}</span>
            {container && (
              <>
                <span aria-hidden="true">/</span>
                <span>{container.analysis.kind}</span>
              </>
            )}
          </nav>
          <h4>{container ? `Container ${container.analysis.kind.toUpperCase()}` : itemLabel}</h4>
          {sequenceLabel && <small>{sequenceLabel}</small>}
        </div>
        <button type="button" className="icon-button" aria-label="Fechar detalhes do segmento" onClick={onClose}>
          ×
        </button>
      </header>

      <dl className="segment-facts">
        <div>
          <dt>Status</dt>
          <dd className={`status-${entry.status}`}>{STATUS_LABELS[entry.status]}</dd>
        </div>
        <div>
          <dt>Duração</dt>
          <dd>{formatDuration(entry.duration_seconds ?? segment?.declared_duration_seconds ?? null)}</dd>
        </div>
        <div>
          <dt>Tamanho</dt>
          <dd>{formatBytes(segment?.byte_size ?? container?.byte_size ?? null)}</dd>
        </div>
        <div>
          <dt>HTTP</dt>
          <dd>{segment?.http_status ?? "—"}</dd>
        </div>
        {delivery && (
          <div>
            <dt>TTFB</dt>
            <dd>{formatMilliseconds(delivery.ttfb_ms)}</dd>
          </div>
        )}
        {delivery && (
          <div>
            <dt>Throughput</dt>
            <dd>{formatBandwidth(delivery.effective_throughput_bps)}</dd>
          </div>
        )}
      </dl>

      {segment?.error && <p className="inline-warning" role="alert">{segment.error}</p>}
      {container ? (
        <ContainerInspector container={container} />
      ) : !segment?.error ? (
        <p className="empty-inline">Container não disponível para este segmento.</p>
      ) : null}

      {(segment || container) && (
        <details className="segment-trace">
          <summary>Arquivo e rastreabilidade{delivery ? " · cache" : ""}</summary>
          <dl>
            <div>
              <dt>Representação</dt>
              <dd><code>{repId}</code></dd>
            </div>
            <div>
              <dt>Arquivo</dt>
              <dd><code>{container?.file ?? segment?.file ?? "—"}</code></dd>
            </div>
            <div>
              <dt>SHA-256</dt>
              <dd><code>{segment?.sha256 ?? "—"}</code></dd>
            </div>
            {delivery && (
              <div>
                <dt>Cache</dt>
                <dd>{cacheLabel(delivery)}</dd>
              </div>
            )}
            <div>
              <dt>URI</dt>
              <dd><code>{segment?.uri ?? "—"}</code></dd>
            </div>
          </dl>
        </details>
      )}
    </section>
  );
}

function RepresentationRow({
  row,
  group,
  maxBandwidth,
  segments,
  containers,
  selected,
  onSelect,
}: {
  row: DisplayRow;
  group: DisplayGroup;
  maxBandwidth: number;
  segments: CapturedSegment[];
  containers: ContainerDTO[];
  selected: string | null;
  onSelect: (key: string | null) => void;
}) {
  const rep = row.rep;
  const entries = row.timeline?.entries ?? [];
  const bitrate = rep?.bandwidth_bps ?? rep?.average_bandwidth_bps ?? null;
  const barWidth = bitrate !== null && maxBandwidth > 0 ? Math.max(5, (bitrate / maxBandwidth) * 100) : 0;
  const label = representationLabel(rep, group);
  const specs = representationSpecs(rep);
  const captured = entries.filter((entry) => entry.status === "captured").length;
  const mediaEntries = entries.filter((entry) => entry.status !== "init");

  const selectedEntry = entries.find((entry) => segmentKey(row.repId, entry.index, entry.status === "init") === selected) ?? null;
  const selectedSegment = selectedEntry
    ? segments.find(
        (item) => item.rep_id === row.repId && item.index === selectedEntry.index && item.is_init === (selectedEntry.status === "init"),
      ) ?? null
    : null;
  const selectedContainer = selectedEntry
    ? containers.find(
        (item) => item.rep_id === row.repId && item.index === selectedEntry.index && item.is_init === (selectedEntry.status === "init"),
      ) ?? null
    : null;

  return (
    <article className={`representation-row kind-${row.kind}`} aria-label={`Representação ${row.repId}`}>
      <div className="representation-identity">
        <span className="kind-marker" aria-hidden="true" />
        <div className="quality-block">
          <strong>{label}</strong>
          <span title={row.repId}>{row.repId}</span>
        </div>
        {specs.length > 0 && <p>{specs.join(" · ")}</p>}
        {rep?.codecs && <CodecSummary value={rep.codecs} />}
      </div>

      <div className="bitrate-cell">
        <div className="bitrate-value">
          <span>Bitrate</span>
          <strong>{formatBandwidth(bitrate)}</strong>
        </div>
        <div className="bitrate-track" aria-hidden="true">
          <span style={{ width: `${barWidth}%` }} />
        </div>
      </div>

      <div className="segments-cell">
        <div className="segments-head">
          <span>Segmentos</span>
          {mediaEntries.length > 0 && (
            <span>{captured}/{mediaEntries.length} capturados</span>
          )}
        </div>
        {entries.length > 0 ? (
          <div className="segment-track" role="group" aria-label={`Segmentos de ${row.repId}`}>
            {entries.map((entry, index) => {
              const isInit = entry.status === "init";
              const key = segmentKey(row.repId, entry.index, isInit);
              const segment = segments.find(
                (item) => item.rep_id === row.repId && item.index === entry.index && item.is_init === isInit,
              );
              const container = containers.find(
                (item) => item.rep_id === row.repId && item.index === entry.index && item.is_init === isInit,
              );
              const canInspect = Boolean(segment || container);
              const segmentLabel = isInit ? "init" : String(entry.index).padStart(2, "0");
              return (
                <button
                  key={`${key}-${index}`}
                  type="button"
                  className={`segment-block segment-${entry.status} ${selected === key ? "is-selected" : ""} ${entry.discontinuity ? "has-discontinuity" : ""}`}
                  style={{
                    flexGrow: Math.max(entry.duration_seconds ?? 1, 1),
                    flexBasis: `${Math.max(52, (entry.duration_seconds ?? 1) * 14)}px`,
                  }}
                  aria-label={`Segmento ${isInit ? "init" : entry.index} de ${row.repId}: ${STATUS_LABELS[entry.status]}`}
                  aria-pressed={selected === key}
                  disabled={!canInspect}
                  onClick={() => onSelect(selected === key ? null : key)}
                >
                  <span className="segment-index">{segmentLabel}</span>
                  <span className="segment-duration">{isInit ? "map" : formatDuration(entry.duration_seconds)}</span>
                  {container && <span className="container-mark" aria-hidden="true">◇</span>}
                </button>
              );
            })}
          </div>
        ) : (
          <div className="timeline-empty">
            {rep?.segment_count_declared !== null && rep?.segment_count_declared !== undefined
              ? `${rep.segment_count_declared} declarados · sem janela capturada`
              : "Sem janela capturada"}
          </div>
        )}
      </div>

      {selectedEntry && (
        <SegmentDetail
          repId={row.repId}
          repLabel={label}
          entry={selectedEntry}
          segment={selectedSegment}
          container={selectedContainer}
          onClose={() => onSelect(null)}
        />
      )}
    </article>
  );
}

export function TimelineView({
  media = null,
  timeline,
  segments,
  containers = [],
  bitrateObservations = [],
  delivery = null,
  capture,
}: {
  media?: UnifiedMedia | null;
  timeline: RepresentationTimeline[];
  segments: CapturedSegment[];
  containers?: ContainerDTO[];
  bitrateObservations?: RepresentationBitrate[];
  delivery?: DeliveryReport | null;
  capture: CaptureReport | null;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const groups = useMemo(() => mediaGroups(media, timeline), [media, timeline]);

  return (
    <section className="stream-map" aria-labelledby="representations-heading">
      <header className="stream-map-header">
        <div>
          <span className="eyebrow">Apresentação</span>
          <h2 id="representations-heading">Representações</h2>
        </div>
        {capture && (
          <div className="capture-inline" aria-label="Resumo da captura">
            <span><strong>{capture.captured}/{capture.planned}</strong> segmentos capturados</span>
            <span><strong>{formatBytes(capture.total_bytes)}</strong></span>
            <span><strong>{capture.window_seconds}s</strong> de janela</span>
            {capture.failed > 0 && <span className="value-warning"><strong>{capture.failed}</strong> falhas</span>}
          </div>
        )}
      </header>

      <div className="segment-legend" aria-label="Legenda dos segmentos">
        <span><i className="legend-dot captured" />capturado</span>
        <span><i className="legend-dot init" />init</span>
        <span><i className="legend-dot failed" />falhou</span>
        <span><i className="legend-container">◇</i>container</span>
      </div>

      <BitrateObservations observations={bitrateObservations} />
      <DeliveryObservations delivery={delivery} segments={segments} />

      <div className="track-groups">
        {groups.map((group) => {
          const maxBandwidth = Math.max(
            ...group.rows.map((row) => row.rep?.bandwidth_bps ?? row.rep?.average_bandwidth_bps ?? 0),
            1,
          );
          return (
            <section className="track-group" key={group.key} aria-labelledby={`track-group-${group.key}`}>
              <header className="track-group-header">
                <h3 id={`track-group-${group.key}`}>{KIND_LABELS[group.kind] ?? group.kind}</h3>
                {(group.language || group.name) && (
                  <span>{[group.language, group.name].filter(Boolean).join(" · ")}</span>
                )}
                <span>{group.rows.length}</span>
              </header>
              <div className="representation-list">
                {group.rows.map((row, index) => (
                  <RepresentationRow
                    key={`${group.key}-${row.repId}-${index}`}
                    row={row}
                    group={group}
                    maxBandwidth={maxBandwidth}
                    segments={segments}
                    containers={containers}
                    selected={selected}
                    onSelect={setSelected}
                  />
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </section>
  );
}
