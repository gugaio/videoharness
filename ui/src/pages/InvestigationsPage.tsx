import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  ApiError,
  captureSegments,
  captureWindow,
  createInvestigation,
  getCaptureCoverage,
  getInvestigationTimeline,
  getSupplementalCapture,
  getSupplementalEvidence,
  listInspections,
  listInvestigations,
  type CaptureCoverageItem,
  type InspectionHistoryItem,
  type InvestigationRecord,
  type SupplementalCapture,
  type SupplementalEvidence,
} from "../api";

const TERMINAL_CAPTURE = new Set(["completed", "partial", "failed"]);
const MAX_SELECTABLE_SEGMENTS = 16;

function errorMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : error instanceof Error ? error.message : "Não foi possível concluir a operação.";
}

function formatBytes(value: number): string {
  if (value >= 1_048_576) return `${(value / 1_048_576).toFixed(1)} MiB`;
  if (value >= 1_024) return `${(value / 1_024).toFixed(1)} KiB`;
  return `${value} B`;
}

export default function InvestigationsPage() {
  const [inspections, setInspections] = useState<InspectionHistoryItem[]>([]);
  const [investigations, setInvestigations] = useState<InvestigationRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [inspectionId, setInspectionId] = useState("");
  const [investigationId, setInvestigationId] = useState("");
  const [budgetMb, setBudgetMb] = useState(50);
  const [sourceUrl, setSourceUrl] = useState("");
  const [coverage, setCoverage] = useState<CaptureCoverageItem[]>([]);
  const [coverageInfo, setCoverageInfo] = useState<{ total: number; truncated: boolean; warnings: string[] } | null>(null);
  const [coverageOffset, setCoverageOffset] = useState(0);
  const [selectedRefs, setSelectedRefs] = useState<string[]>([]);
  const [selectedReps, setSelectedReps] = useState<string[]>([]);
  const [startSeconds, setStartSeconds] = useState(0);
  const [durationSeconds, setDurationSeconds] = useState(10);
  const [maxBytes, setMaxBytes] = useState(10_000_000);
  const [capture, setCapture] = useState<SupplementalCapture | null>(null);
  const [evidence, setEvidence] = useState<SupplementalEvidence | null>(null);
  const [timeline, setTimeline] = useState<Array<Record<string, unknown>>>([]);

  const activeInvestigation = investigations.find((item) => item.id === investigationId);
  const availableBytes = activeInvestigation?.available_bytes ?? 0;
  const mediaCoverage = coverage.filter((item) => !item.is_init);
  const representationIds = useMemo(
    () => [...new Set(mediaCoverage.map((item) => item.rep_id))],
    [mediaCoverage],
  );

  async function refresh() {
    const [inspectionResult, investigationResult] = await Promise.all([listInspections(), listInvestigations()]);
    setInspections(inspectionResult.inspections);
    setInvestigations(investigationResult.investigations);
  }

  useEffect(() => {
    let alive = true;
    Promise.all([listInspections(), listInvestigations()])
      .then(([inspectionResult, investigationResult]) => {
        if (!alive) return;
        setInspections(inspectionResult.inspections);
        setInvestigations(investigationResult.investigations);
        setInvestigationId(investigationResult.investigations[0]?.id ?? "");
      })
      .catch((cause: unknown) => { if (alive) setError(errorMessage(cause)); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    let alive = true;
    setCapture(null);
    setEvidence(null);
    setCoverage([]);
    setCoverageInfo(null);
    setCoverageOffset(0);
    setSelectedRefs([]);
    setSourceUrl("");
    setTimeline([]);
    if (!investigationId) return () => { alive = false; };
    getInvestigationTimeline(investigationId)
      .then((result) => { if (alive) setTimeline(result.timeline); })
      .catch(() => { if (alive) setTimeline([]); });
    return () => { alive = false; };
  }, [investigationId]);

  useEffect(() => {
    if (!investigationId || !capture || TERMINAL_CAPTURE.has(capture.status)) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      timer = setTimeout(async () => {
        try {
          const updated = await getSupplementalCapture(investigationId, capture.id);
          if (!alive) return;
          setCapture(updated);
          await refresh();
          if (TERMINAL_CAPTURE.has(updated.status)) {
            if ((updated.status === "completed" || updated.status === "partial") && updated.evidence_available) {
              setEvidence(await getSupplementalEvidence(investigationId, updated.id));
            }
          } else void poll();
        } catch (cause) {
          if (alive) setError(errorMessage(cause));
        }
      }, 1_500);
    };
    void poll();
    return () => { alive = false; if (timer) clearTimeout(timer); };
  }, [investigationId, capture?.id, capture?.status]);

  async function begin(event: FormEvent) {
    event.preventDefault();
    if (!inspectionId) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const created = await createInvestigation(inspectionId, budgetMb * 1_000_000);
      await refresh();
      setInvestigationId(created.id);
      setNotice("Investigação criada a partir do snapshot baseline.");
    } catch (cause) { setError(errorMessage(cause)); }
    finally { setBusy(false); }
  }

  async function resolveCoverage(event: FormEvent) {
    event.preventDefault();
    if (!activeInvestigation || !sourceUrl.trim()) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await getCaptureCoverage(activeInvestigation.id, sourceUrl.trim());
      setCoverage(result.coverage);
      setCoverageInfo({ total: result.total, truncated: result.truncated, warnings: result.warnings });
      setCoverageOffset(result.coverage.length);
      setSelectedRefs([]);
      setSelectedReps([...new Set(result.coverage.filter((item) => !item.is_init).map((item) => item.rep_id))]);
      setNotice(`${result.coverage.length} itens de cobertura resolvidos; nenhum segmento foi baixado.`);
    } catch (cause) { setError(errorMessage(cause)); }
    finally { setBusy(false); }
  }

  async function loadMoreCoverage() {
    if (!activeInvestigation || !sourceUrl.trim()) return;
    setBusy(true); setError("");
    try {
      const result = await getCaptureCoverage(activeInvestigation.id, sourceUrl.trim(), coverageOffset);
      setCoverage((items) => [...items, ...result.coverage]);
      setCoverageOffset((offset) => offset + result.coverage.length);
      setCoverageInfo({ total: result.total, truncated: result.truncated, warnings: result.warnings });
    } catch (cause) { setError(errorMessage(cause)); }
    finally { setBusy(false); }
  }

  async function requestCapture(event: FormEvent) {
    event.preventDefault();
    if (!activeInvestigation || !sourceUrl.trim()) return;
    if (maxBytes > availableBytes) {
      setError(`Orçamento disponível: ${formatBytes(availableBytes)}.`);
      return;
    }
    setBusy(true); setError(""); setNotice(""); setEvidence(null);
    try {
      const key = crypto.randomUUID();
      const created = selectedRefs.length > 0
        ? await captureSegments(activeInvestigation.id, sourceUrl.trim(), selectedRefs, key, maxBytes)
        : await captureWindow(activeInvestigation.id, sourceUrl.trim(), selectedReps, startSeconds, durationSeconds, key, maxBytes);
      setCapture(created);
      await refresh();
      setNotice("Pedido enviado à Lens. O orçamento solicitado já está reservado.");
    } catch (cause) { setError(errorMessage(cause)); }
    finally { setBusy(false); }
  }

  function toggleRef(ref: string) {
    setSelectedRefs((items) => items.includes(ref)
      ? items.filter((item) => item !== ref)
      : items.length < MAX_SELECTABLE_SEGMENTS ? [...items, ref] : items);
  }

  if (loading) return <p className="state">Carregando investigações…</p>;

  return (
    <div className="investigations-page">
      <section className="panel">
        <h2>Investigações</h2>
        <p className="panel-hint">Use o snapshot da inspeção como baseline e peça evidências adicionais quando a análise apontar uma lacuna.</p>
      </section>

      {error && <p role="alert" className="state-error">{error}</p>}
      {notice && <p role="status" className="panel-hint">{notice}</p>}

      <section className="panel">
        <h3>Iniciar a partir de uma inspeção</h3>
        <form className="mcp-form" onSubmit={(event) => void begin(event)}>
          <label htmlFor="investigation-baseline">Snapshot baseline</label>
          <select id="investigation-baseline" value={inspectionId} onChange={(event) => setInspectionId(event.target.value)} required>
            <option value="">Selecione uma inspeção concluída</option>
            {inspections.filter((item) => item.status === "completed" || item.status === "partial").map((item) => (
              <option key={item.inspection_id} value={item.inspection_id}>
                {item.inspection_id.slice(0, 8)} · {item.status} · {item.source_url}
              </option>
            ))}
          </select>
          <label htmlFor="investigation-budget">Teto desta investigação</label>
          <select id="investigation-budget" value={budgetMb} onChange={(event) => setBudgetMb(Number(event.target.value))}>
            <option value={25}>25 MB</option><option value={50}>50 MB</option><option value={100}>100 MB</option>
          </select>
          <button type="submit" disabled={busy || !inspectionId}>Iniciar investigação</button>
        </form>
        {investigations.length > 0 && <div className="mcp-form">
          <label htmlFor="investigation-picker">Abrir investigação</label>
          <select id="investigation-picker" value={investigationId} onChange={(event) => setInvestigationId(event.target.value)}>
            {investigations.map((item) => <option key={item.id} value={item.id}>{item.inspection_id.slice(0, 8)} · {formatBytes(item.consumed_bytes)} usados</option>)}
          </select>
        </div>}
      </section>

      {activeInvestigation && <>
        <section className="panel">
          <h3>Orçamento e origem</h3>
          <p>Baseline <code>{activeInvestigation.inspection_id}</code></p>
          <p>Usado: {formatBytes(activeInvestigation.consumed_bytes)} · reservado: {formatBytes(activeInvestigation.reserved_bytes)} · disponível: {formatBytes(availableBytes)}</p>
          <label htmlFor="investigation-source">URL atual do manifesto</label>
          <form className="inspect-form" onSubmit={(event) => void resolveCoverage(event)}>
            <input id="investigation-source" type="url" required value={sourceUrl} onChange={(event) => setSourceUrl(event.target.value)} placeholder="https://…/master.m3u8" autoComplete="off" />
            <button type="submit" disabled={busy || !sourceUrl.trim()}>Consultar cobertura</button>
          </form>
          <p className="panel-hint">A URL é usada apenas nesta chamada para reler o manifesto e não é gravada no histórico. Para origem autenticada, informe uma URL válida com as credenciais atuais.</p>
          {coverageInfo && <p>{coverageInfo.total} itens declarados · {coverageInfo.truncated ? "cobertura paginada (máximo 2.000 referências nesta leitura)" : "lista completa"}</p>}
          {coverageInfo?.warnings.map((warning) => <p key={warning} className="panel-hint">{warning}</p>)}
        </section>

        {coverage.length > 0 && <section className="panel">
          <h3>Escolher o aprofundamento</h3>
          <p className="panel-hint">Selecione segmentos específicos ou escolha uma janela de tempo e representações. O teto de leitura por pedido é 25 MB e 16 segmentos.</p>
          <form className="mcp-form" onSubmit={(event) => void requestCapture(event)}>
            <fieldset className="investigation-selection">
              <legend>Segmentos observados</legend>
              {mediaCoverage.map((item) => <label key={item.segment_ref} className="investigation-segment">
                <input type="checkbox" checked={selectedRefs.includes(item.segment_ref)} onChange={() => toggleRef(item.segment_ref)} disabled={selectedRefs.length >= MAX_SELECTABLE_SEGMENTS && !selectedRefs.includes(item.segment_ref)} />
                <span><code>{item.rep_id}</code> · seq {item.segment_sequence ?? item.index} · {item.start_seconds?.toFixed(2) ?? "?"} s · {item.status}</span>
              </label>)}
              {coverageInfo && coverageOffset < Math.min(coverageInfo.total, 2_000) && <button type="button" disabled={busy} onClick={() => void loadMoreCoverage()}>Carregar mais segmentos</button>}
              {coverageInfo?.truncated && <p className="panel-hint">A cobertura retornou apenas a primeira página. O MCP permite paginar os resultados.</p>}
            </fieldset>
            <p>{selectedRefs.length} selecionados (máximo {MAX_SELECTABLE_SEGMENTS}). Se nenhum estiver selecionado, o pedido usará a janela abaixo.</p>
            <label htmlFor="window-representations">Representações da janela</label>
            <select id="window-representations" multiple value={selectedReps} onChange={(event) => setSelectedReps([...event.currentTarget.selectedOptions].map((option) => option.value))} disabled={selectedRefs.length > 0}>
              {representationIds.map((id) => <option key={id} value={id}>{id}</option>)}
            </select>
            <div className="investigation-window-fields">
              <label>Início (segundos)<input type="number" min={0} max={86_400} step="0.1" value={startSeconds} onChange={(event) => setStartSeconds(Number(event.target.value))} disabled={selectedRefs.length > 0} /></label>
              <label>Duração (máximo 60 s)<input type="number" min={0.1} max={60} step="0.1" value={durationSeconds} onChange={(event) => setDurationSeconds(Number(event.target.value))} disabled={selectedRefs.length > 0} /></label>
            </div>
            <label htmlFor="capture-budget">Máximo de bytes deste pedido</label>
            <select id="capture-budget" value={maxBytes} onChange={(event) => setMaxBytes(Number(event.target.value))}>
              <option value={2_000_000}>2 MB</option><option value={5_000_000}>5 MB</option><option value={10_000_000}>10 MB</option><option value={25_000_000}>25 MB</option>
            </select>
            <button type="submit" disabled={busy || availableBytes < 1_024 || maxBytes > availableBytes || (selectedRefs.length === 0 && selectedReps.length === 0)}>
              {busy ? "Enviando…" : "Solicitar captura"}
            </button>
          </form>
        </section>}

        {timeline.length > 0 && <section className="panel">
          <h3>Baseline</h3>
          <p>{timeline.length} representações na timeline inicial. A baseline continua preservada após novas coletas.</p>
          <div className="table-scroll"><table className="structure-table"><thead><tr><th>Representação</th><th>Itens na timeline</th></tr></thead><tbody>
            {timeline.map((item, index) => <tr key={`${String(item.rep_id)}-${index}`}><td><code>{String(item.rep_id ?? "?")}</code></td><td>{Array.isArray(item.entries) ? item.entries.length : 0}</td></tr>)}
          </tbody></table></div>
        </section>}

        {capture && <section className="panel">
          <h3>Coleta adicional</h3>
          <p><code>{capture.id}</code> · {capture.status}</p>
          <p>Solicitado: {formatBytes(capture.requested_bytes)} · recebido: {capture.bytes_received === null ? "ainda não informado" : formatBytes(capture.bytes_received)}</p>
          {!capture.consumption_known && <p className="panel-hint">O consumo ainda está reservado enquanto a Lens confirma bytes e estado.</p>}
          {capture.status === "failed" && <p role="alert" className="state-error">A coleta falhou; o estado do orçamento será mantido como reservado se o consumo não pôde ser confirmado.</p>}
          {evidence && <EvidenceView evidence={evidence} />}
        </section>}

        {activeInvestigation.captures && activeInvestigation.captures.length > 0 && <section className="panel">
          <h3>Histórico de coletas</h3>
          <ul className="inspection-history-list">{activeInvestigation.captures.map((item) => <li key={item.id}>
            <div><strong>{item.status}</strong> · {formatBytes(item.bytes_received ?? item.requested_bytes)} · <code>{item.id.slice(0, 8)}</code></div>
            {!item.consumption_known && <span>orçamento reservado</span>}
          </li>)}</ul>
        </section>}
      </>}
    </div>
  );
}

function EvidenceView({ evidence }: { evidence: SupplementalEvidence }) {
  const segments = evidence.evidence.segments ?? [];
  const timelines = evidence.evidence.timeline ?? [];
  const containers = evidence.evidence.containers ?? [];
  return <div className="investigation-evidence">
    <h4>Evidência arquivada · {new Date(evidence.captured_at).toLocaleString("pt-BR")}</h4>
    {evidence.evidence.source && <p>{evidence.evidence.source.protocol} · {evidence.evidence.source.is_live ? "live" : "VOD"} · {evidence.evidence.source.display_url}</p>}
    <p>{segments.length} resultados de segmentos · {containers.length} análises de container</p>
    {timelines.length > 0 && <div className="table-scroll"><table className="structure-table"><thead><tr><th>Representação</th><th>Seq./índice</th><th>Início</th><th>Duração</th><th>Estado</th><th>Referência</th></tr></thead><tbody>
      {timelines.flatMap((timeline, timelineIndex) => (Array.isArray(timeline.entries) ? timeline.entries : []).map((entry: Record<string, unknown>, entryIndex: number) => <tr key={`${timelineIndex}-${entryIndex}`}>
        <td><code>{String(timeline.rep_id ?? "?")}</code></td>
        <td>{String(entry.segment_sequence ?? entry.index ?? "init")}</td>
        <td>{typeof entry.start_seconds === "number" ? `${entry.start_seconds.toFixed(2)} s` : "—"}</td>
        <td>{typeof entry.duration_seconds === "number" ? `${entry.duration_seconds.toFixed(2)} s` : "—"}</td>
        <td>{String(entry.status ?? "?")}</td>
        <td><code>{String(entry.segment_ref ?? "—")}</code></td>
      </tr>))}
    </tbody></table></div>}
    {segments.map((segment, index) => <details key={`${String(segment.segment_ref)}-${index}`}>
      <summary><code>{String(segment.rep_id ?? "?")}</code> · seq {String(segment.segment_sequence ?? segment.index ?? "?")} · {String(segment.byte_size ?? 0)} bytes · {String(segment.error ?? "capturado")}</summary>
      {typeof segment.sha256 === "string" && <p>SHA-256: <code>{segment.sha256}</code></p>}
      {containers[index] && <pre>{JSON.stringify(containers[index], null, 2)}</pre>}
    </details>)}
  </div>;
}
