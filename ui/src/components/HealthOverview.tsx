import { useState } from "react";
import type { Snapshot } from "../snapshot";

type State = "issue" | "observed" | "unknown";
type Check = { state: State; title: string; value: string; detail: string };

const STATE_LABEL: Record<State, string> = {
  issue: "Desvio observado",
  observed: "Sem desvio observado",
  unknown: "Não comparável",
};

function checks(snapshot: Snapshot): Check[] {
  const capture = snapshot.capture;
  const mediaSegments = snapshot.segments.filter((item) => !item.is_init);
  const captured = mediaSegments.filter((item) => item.error === null && item.byte_size !== null);
  const delivery = captured.filter((item) => item.delivery != null);
  const httpErrors = delivery.filter((item) => (item.delivery?.http_status ?? 0) >= 400);
  const mediaContainers = snapshot.containers.filter((item) => !item.is_init);
  const parsed = mediaContainers.filter((item) => !item.analysis.error);
  const frameCollections = mediaContainers.flatMap((item) => item.probe?.frame_collection ? [item.probe.frame_collection] : []);
  const frameComplete = frameCollections.filter((item) => item.status === "completed").length;
  const frameFailed = frameCollections.filter((item) => item.status === "failed").length;
  const tracks = mediaContainers.flatMap((item) => item.analysis.timing?.tracks ?? []);
  const boundaries = tracks.filter((item) => item.boundary_delta_seconds !== null);
  const boundaryIssues = boundaries.filter((item) => Math.abs(item.boundary_delta_seconds ?? 0) > 0.000001);
  const changes = (snapshot.bitstream_observations ?? []).flatMap((item) => item.configuration_changes);
  const abr = snapshot.abr_alignment ?? [];
  const abrComparable = abr.filter((item) => item.comparable_keyframes > 0 || item.comparable_declared_segments > 0);
  const abrIssues = abrComparable.filter((item) => [item.max_abs_declared_start_delta_seconds, item.max_abs_declared_duration_delta_seconds, item.max_abs_keyframe_pts_delta_seconds].some((value) => value !== null && value > 0.000001));
  const liveReads = snapshot.delivery?.live_playlists ?? [];
  const liveCompared = liveReads.filter((item) => item.live_edge_advance_segments !== undefined && item.live_edge_advance_segments !== null);
  const liveIssues = liveCompared.filter((item) => (item.live_edge_advance_segments ?? 0) < 0 || item.advancement.startsWith("second observation failed"));

  return [
    {
      state: capture && capture.failed > 0 ? "issue" : capture && capture.planned > 0 && capture.captured === capture.planned ? "observed" : "unknown",
      title: "Captura",
      value: capture ? `${capture.captured}/${capture.planned} recursos` : "Não coletada",
      detail: capture ? `${capture.failed} falhas · janela de ${capture.window_seconds}s` : "Sem relatório de captura.",
    },
    {
      state: mediaContainers.some((item) => item.analysis.error) ? "issue" : mediaContainers.length > 0 && parsed.length === mediaContainers.length ? "observed" : "unknown",
      title: "Containers",
      value: `${parsed.length}/${mediaContainers.length} analisados`,
      detail: mediaContainers.length ? `${mediaContainers.length - parsed.length} sem estrutura utilizável.` : "Nenhum container de mídia disponível.",
    },
    {
      state: boundaryIssues.length > 0 ? "issue" : boundaries.length > 0 ? "observed" : "unknown",
      title: "Continuidade temporal",
      value: `${boundaries.length} fronteiras comparadas`,
      detail: boundaryIssues.length ? `${boundaryIssues.length} gaps ou overlaps observados.` : boundaries.length ? "Nenhum delta diferente de zero na amostra comparável." : "Sem duas fronteiras compatíveis na mesma escala.",
    },
    {
      state: abrIssues.length > 0 ? "issue" : abrComparable.length > 0 ? "observed" : "unknown",
      title: "Alinhamento ABR",
      value: `${abrComparable.length}/${abr.length} pares comparáveis`,
      detail: abrIssues.length ? `${abrIssues.length} pares com delta observado.` : abrComparable.length ? "Nenhum delta observado nos pares comparáveis." : "Não há identidade temporal suficiente entre rendições.",
    },
    {
      state: httpErrors.length > 0 ? "issue" : delivery.length > 0 ? "observed" : "unknown",
      title: "Entrega HTTP",
      value: `${delivery.length}/${captured.length} segmentos medidos`,
      detail: httpErrors.length ? `${httpErrors.length} respostas HTTP com erro.` : delivery.length ? "Nenhum status de erro na captura observada." : "A fonte não forneceu métricas HTTP.",
    },
    {
      state: frameFailed > 0 ? "issue" : frameCollections.length > 0 && frameComplete === frameCollections.length ? "observed" : "unknown",
      title: "Leitura de frames",
      value: `${frameComplete}/${mediaContainers.length} segmentos completos`,
      detail: frameFailed ? `${frameFailed} execuções do probe sem evidência de frames.` : frameCollections.length ? `${frameCollections.length - frameComplete} leituras parciais ou não solicitadas.` : "Probe ausente ou snapshot anterior ao resultado estruturado.",
    },
    {
      state: changes.length > 0 ? "issue" : (snapshot.bitstream_observations?.length ?? 0) > 0 ? "observed" : "unknown",
      title: "Configuração do bitstream",
      value: changes.length ? `${changes.length} mudanças` : "Sem mudança observada",
      detail: changes.length ? [...new Set(changes.flatMap((item) => item.changed_fields))].join(", ") : "Comparação limitada aos segmentos com configuração observada.",
    },
    {
      state: liveIssues.length > 0 ? "issue" : liveCompared.length > 0 ? "observed" : "unknown",
      title: "Avanço live",
      value: `${liveCompared.length} observações comparadas`,
      detail: liveIssues.length ? liveIssues.map((item) => item.advancement).join(" · ") : liveCompared.length ? "Segunda leitura realizada após a captura da janela." : "Não aplicável a VOD ou sem segunda leitura comparável.",
    },
  ];
}

export function HealthOverview({ snapshot }: { snapshot: Snapshot }) {
  const [open, setOpen] = useState(false);
  const items = checks(snapshot);
  const issues = items.filter((item) => item.state === "issue").length;
  const unknown = items.filter((item) => item.state === "unknown").length;
  const attention = items.filter((item) => item.state === "issue");
  const primary = attention[0] ?? items.find((item) => item.state === "unknown") ?? null;
  return <section className="health-overview" aria-labelledby="health-overview-heading">
    <header>
      <div><span className="eyebrow">Triagem da janela capturada</span><h2 id="health-overview-heading">Saúde e cobertura</h2></div>
      <div className="health-overview-actions">
        <p><strong>{issues}</strong> desvios · <strong>{unknown}</strong> não comparáveis</p>
        <button type="button" className={`streams-button health-toggle${open ? " is-open" : ""}`} aria-expanded={open} aria-controls="health-overview-body" onClick={() => setOpen((value) => !value)}>Triagem<span aria-hidden="true">{open ? "▴" : "▾"}</span></button>
      </div>
    </header>
    {open && <div id="health-overview-body">
      <p className="health-disclaimer">“Sem desvio observado” vale somente para a janela e para as evidências comparáveis desta inspeção.</p>
      {primary && <article className={`health-primary health-${primary.state}`}>
        <span>{attention.length > 0 ? "Principal ponto de atenção" : "Cobertura a ampliar"}</span><h3>{primary.title}</h3><strong>{primary.value}</strong><p>{primary.detail}</p>
      </article>}
      {attention.length > 1 && <div className="health-grid">{attention.slice(1).map((item) => <article className={`health-check health-${item.state}`} key={item.title}>
        <span>{STATE_LABEL[item.state]}</span><h3>{item.title}</h3><strong>{item.value}</strong><p>{item.detail}</p>
      </article>)}</div>}
      <details className="health-details"><summary>Ver cobertura e todas as medições</summary><div className="health-grid">{items.filter((item) => item !== primary && !attention.includes(item)).map((item) => <article className={`health-check health-${item.state}`} key={item.title}>
        <span>{STATE_LABEL[item.state]}</span><h3>{item.title}</h3><strong>{item.value}</strong><p>{item.detail}</p>
      </article>)}</div></details>
    </div>}
  </section>;
}
