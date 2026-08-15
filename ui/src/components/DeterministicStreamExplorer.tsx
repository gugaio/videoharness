import { useMemo, useState } from "react";
import type { InvestigationEvidence } from "../lib/api";

type Evidence = InvestigationEvidence;
type MediaSample = Evidence["mediaSamples"][number];
type Probe = NonNullable<MediaSample["probe"]>;
type Boundary = NonNullable<Probe["boundary"]>;
type BoundaryFrame = Boundary["frames"][number];

type LadderRow = {
  id: string;
  label: string;
  detail: string;
  kind: "video" | "audio" | "unknown";
  samples: MediaSample[];
  declaredCount?: number;
  collectorSelection: boolean;
};

type VisualFrame = {
  type: "I" | "P" | "B" | "RA" | "?";
  label: string;
  pts?: string;
  ptsTime?: number;
  dts?: string;
  dtsTime?: number;
  duration?: string;
  keyFrame?: boolean;
  sync?: boolean;
  size?: number;
  pixelFormat?: string;
};

type VisualGop = {
  key: string;
  label: string;
  source: "gop" | "frame-boundary" | "fmp4-boundary";
  frames: VisualFrame[];
  frameCount: number;
  startsWithKeyFrame?: boolean;
  firstPtsTime?: number;
  lastPtsTime?: number;
  truncated: boolean;
};

export function DeterministicStreamExplorer({ evidence }: { evidence: Evidence }): JSX.Element {
  const rows = useMemo(() => buildLadderRows(evidence), [evidence]);
  const chunks = useMemo(() => sortSamples(evidence.mediaSamples.filter((sample) => sample.kind === "media-segment")), [evidence]);
  const [selectedChunkKey, setSelectedChunkKey] = useState<string>();
  const selectedChunk = chunks.find((sample) => sample.logicalKey === selectedChunkKey) ?? chunks[0];
  const selectedRepresentationLabel = rows.find((row) => row.samples.some((sample) => sample.logicalKey === selectedChunk?.logicalKey))?.label;
  const root = evidence.manifests.find((manifest) => manifest.role === "root") ?? evidence.manifests[0];
  const videoLevelCount = evidence.dash?.representations.filter((entry) => entry.contentType === "video").length
    ?? evidence.hls?.variants.length
    ?? rows.filter((row) => row.kind === "video").length;
  const duration = typicalDuration(chunks, evidence);
  const codecs = videoCodecs(evidence, chunks);

  return (
    <section className="p-5 sm:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-amber-700">Deterministic stream pass</p>
          <h2 className="mt-1 text-xl font-semibold tracking-tight text-slate-900">Reading the stream structure.</h2>
          <p className="mt-1 max-w-2xl text-xs leading-5 text-slate-500">Manifest declarations and preserved media are visible before any agent forms a hypothesis.</p>
        </div>
        <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-[11px] font-medium text-emerald-700">
          {chunks.length} chunk{chunks.length === 1 ? "" : "s"} inspected
        </span>
      </div>

      <div className="mt-5 overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <div className="flex flex-wrap items-center gap-3 px-4 py-4">
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-violet-100 font-mono text-[11px] text-violet-700">{"{ }"}</div>
          <div className="min-w-0">
            <p className="text-[9px] font-semibold uppercase tracking-[0.17em] text-slate-400">Root manifest</p>
            <p className="mt-1 truncate text-sm font-semibold text-slate-800">{manifestName(root?.finalUrl) ?? root?.logicalKey ?? "Manifest"}</p>
            <p className="mt-0.5 text-[11px] text-slate-500">{[evidence.source.protocol.toUpperCase(), root?.kind, `${evidence.manifests.length} artifact${evidence.manifests.length === 1 ? "" : "s"}`].filter(Boolean).join(" · ")}</p>
          </div>
          <div className="ml-auto flex flex-wrap gap-1.5">
            {evidence.manifests.map((manifest) => <span className="rounded-md bg-slate-100 px-2 py-1 font-mono text-[9px] text-slate-500" key={manifest.artifactId}>{manifest.role} · {manifest.kind}</span>)}
          </div>
        </div>
        <div className="grid grid-cols-2 border-t border-slate-200 sm:grid-cols-4">
          <StreamMetric label="Video levels" value={String(videoLevelCount)} />
          <StreamMetric label="Preserved chunks" value={String(chunks.length)} />
          <StreamMetric label="Typical duration" value={duration === undefined ? "—" : `${formatNumber(duration, 2)}s`} />
          <StreamMetric label="Video codec" value={codecs || "—"} />
        </div>
        <div className="flex flex-wrap items-center gap-1.5 border-t border-slate-200 px-4 py-2.5">
          {evidence.abr?.capability && <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 font-mono text-[9px] text-slate-600">{evidence.abr.capability.codecFamily} {evidence.abr.capability.maxRequiredLevel ?? "level not declared"}{evidence.abr.capability.maxResolution ? ` · ${evidence.abr.capability.maxResolution.width}×${evidence.abr.capability.maxResolution.height} max` : ""}</span>}
          {drmSchemes(evidence).map((scheme) => <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 font-mono text-[9px] text-amber-700" key={scheme}>{scheme} DRM</span>)}
          {evidence.abr?.capability && evidence.abr.capability.maxRequiredLevelNumeric !== undefined && evidence.abr.capability.maxRequiredLevelNumeric >= 5.1 && <span className="rounded-full border border-rose-200 bg-rose-50 px-2.5 py-1 font-mono text-[9px] text-rose-700">high decoder requirement</span>}
        </div>
      </div>

      <DeliveryFacts evidence={evidence} />

      <div className="mt-6">
        <div className="hidden grid-cols-[minmax(130px,170px)_minmax(360px,1fr)_74px] gap-3 px-3 text-[9px] font-semibold uppercase tracking-[0.17em] text-slate-400 md:grid">
          <span>Representations</span><span>Preserved chunks · click to inspect</span><span className="text-right">Coverage</span>
        </div>
        <div className="mt-2 space-y-2">
          {rows.map((row) => <LadderRowView key={row.id} row={row} selectedChunkKey={selectedChunk?.logicalKey} onSelectChunk={setSelectedChunkKey} />)}
          {rows.length === 0 && <div className="rounded-2xl border border-dashed border-slate-300 bg-white/60 p-5 text-sm text-slate-500">The manifest has no declared representation or preserved media chunk to map.</div>}
        </div>
        <p className="mt-3 text-[11px] leading-5 text-slate-500">Empty cells mean that a representation was declared but not preserved by this bounded investigation. They do not mean the origin has no chunks.</p>
      </div>

      <LadderAlignment evidence={evidence} />
      <TimelineContinuity evidence={evidence} />
      <ObservedPlaybackSwitches evidence={evidence} />

      <ChunkInspector key={selectedChunk?.logicalKey ?? "empty"} chunk={selectedChunk} representationLabel={selectedRepresentationLabel} />
    </section>
  );
}

function StreamMetric({ label, value }: { label: string; value: string }): JSX.Element {
  return <div className="border-r border-slate-200 px-4 py-3 last:border-r-0"><p className="truncate text-sm font-semibold text-slate-800">{value}</p><p className="mt-1 text-[10px] text-slate-400">{label}</p></div>;
}

function LadderRowView({ row, selectedChunkKey, onSelectChunk }: { row: LadderRow; selectedChunkKey?: string; onSelectChunk(key: string): void }): JSX.Element {
  return (
    <div className={`grid gap-3 rounded-xl border px-3 py-3 md:grid-cols-[minmax(130px,170px)_minmax(360px,1fr)_74px] md:items-center ${row.collectorSelection ? "border-sky-200 bg-sky-50/70" : "border-slate-200 bg-white"}`}>
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className={`h-1.5 w-1.5 flex-none rounded-full ${row.kind === "video" ? "bg-violet-500" : row.kind === "audio" ? "bg-emerald-500" : "bg-slate-300"}`} />
          <p className="truncate text-xs font-semibold text-slate-800">{row.label}</p>
        </div>
        <p className="mt-1 truncate pl-3.5 text-[10px] text-slate-500">{row.detail || "Declared by manifest"}</p>
      </div>
      <div className="flex min-w-0 gap-1.5 overflow-x-auto pb-1 md:pb-0">
        {row.samples.map((sample) => {
          const selected = sample.logicalKey === selectedChunkKey;
          return (
            <button
              aria-label={`Inspect chunk ${sample.sequence ?? sample.sampleIndex ?? sample.logicalKey}`}
              className={`group min-w-[54px] rounded-lg border px-2 py-1.5 text-left transition ${selected ? "border-violet-400 bg-violet-100 shadow-[0_0_0_2px_rgba(139,92,246,0.08)]" : sample.probe ? "border-emerald-200 bg-emerald-50 hover:border-emerald-400" : "border-amber-200 bg-amber-50 hover:border-amber-400"}`}
              key={sample.logicalKey}
              onClick={() => onSelectChunk(sample.logicalKey)}
              type="button"
            >
              <span className={`block font-mono text-[9px] ${selected ? "text-violet-800" : "text-slate-700"}`}>#{sample.sequence ?? (sample.sampleIndex === undefined ? "—" : sample.sampleIndex)}</span>
              <span className="mt-1 block text-[9px] text-slate-400">{sample.declaredDuration === undefined ? sizeLabel(sample.sizeBytes) : `${formatNumber(sample.declaredDuration, 1)}s`}</span>
            </button>
          );
        })}
        {row.samples.length === 0 && <span className="flex min-h-[39px] min-w-[150px] items-center rounded-lg border border-dashed border-slate-300 px-3 text-[10px] text-slate-400">Not preserved in this pass</span>}
      </div>
      <div className="text-left md:text-right">
        <p className={`text-[10px] font-semibold ${row.samples.length > 0 ? "text-emerald-700" : "text-slate-400"}`}>{row.samples.length} preserved</p>
        {row.declaredCount !== undefined && <p className="mt-1 text-[9px] text-slate-400">of {row.declaredCount} declared</p>}
      </div>
    </div>
  );
}

function ChunkInspector({ chunk, representationLabel }: { chunk: MediaSample | undefined; representationLabel?: string }): JSX.Element {
  const gops = chunk ? visualGops(chunk) : [];
  const [selectedGopKey, setSelectedGopKey] = useState(gops[0]?.key);
  if (!chunk) return <div className="mt-6 rounded-2xl border border-dashed border-slate-300 bg-white/60 p-5 text-sm text-slate-500">No media chunk was preserved for inspection.</div>;
  const probe = chunk.probe;
  const boundary = probe?.boundary;
  const structural = probe?.structural;
  const http = chunk.source?.http;
  const selectedGop = gops.find((gop) => gop.key === selectedGopKey) ?? gops[0];
  const video = probe?.tracks.find((track) => track.kind === "video");
  const audio = probe?.tracks.find((track) => track.kind === "audio");
  const firstPacket = boundary?.packets[0];
  const avOffsetMs = video?.firstPts !== undefined && audio?.firstPts !== undefined ? Math.round((audio.firstPts - video.firstPts) * 1_000) : undefined;

  return (
    <article className="mt-6 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-start gap-3 border-b border-slate-200 px-4 py-4 sm:px-5">
        <div className="min-w-0">
          <p className="text-[9px] font-semibold uppercase tracking-[0.18em] text-sky-700">Selected chunk</p>
          <h3 className="mt-1 truncate font-mono text-sm font-semibold text-slate-800">{shortChunkName(chunk)}</h3>
        </div>
        <div className="ml-auto flex flex-wrap justify-end gap-1.5">
          <InspectorPill>{chunk.representationId ?? representationLabel ?? representationFromLogicalKey(chunk)}</InspectorPill>
          <InspectorPill>{chunk.sequence === undefined ? `sample ${chunk.sampleIndex ?? "—"}` : `sequence ${chunk.sequence}`}</InspectorPill>
          <InspectorPill>{chunk.declaredDuration === undefined ? sizeLabel(chunk.sizeBytes) : `${formatNumber(chunk.declaredDuration, 3)}s`}</InspectorPill>
          {probe?.format && <InspectorPill>{probe.format}</InspectorPill>}
        </div>
      </div>

      <div className="grid gap-2 px-4 pt-4 sm:grid-cols-3 sm:px-5">
        <TimingFact label="PTS start" value={formatTimestamp(video?.firstPts ?? firstPacket?.ptsTime, firstPacket?.pts)} />
        <TimingFact label="DTS start" value={formatTimestamp(firstPacket?.dtsTime, firstPacket?.dts)} />
        <TimingFact label="A/V start offset" value={avOffsetMs === undefined ? "Not observed together" : `${avOffsetMs > 0 ? "+" : ""}${avOffsetMs} ms`} tone={avOffsetMs === undefined ? "neutral" : "green"} />
      </div>

      <TrackLanes tracks={probe?.tracks ?? []} />

      <section className="mx-4 mt-4 rounded-2xl border border-slate-200 bg-[#fafafe] p-4 sm:mx-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[9px] font-semibold uppercase tracking-[0.18em] text-violet-700">Video · GOP map</p>
            <p className="mt-1 text-xs font-semibold text-slate-700">Select an observed group to inspect its frames</p>
          </div>
          <FrameLegend />
        </div>

        {gops.length > 0 ? (
          <>
            <div className="mt-4 flex gap-2 overflow-x-auto pb-2">
              {gops.map((gop) => <GopButton gop={gop} key={gop.key} selected={gop.key === selectedGop?.key} onSelect={() => setSelectedGopKey(gop.key)} />)}
            </div>
            {selectedGop && <FrameMap key={selectedGop.key} gop={selectedGop} />}
          </>
        ) : (
          <div className="mt-4 rounded-xl border border-dashed border-slate-300 bg-white p-4 text-xs leading-5 text-slate-500">This chunk has no preserved frame or random-access boundary. The media artifact is still available for a later deterministic pass.</div>
        )}
      </section>

      <div className="grid gap-2 px-4 py-4 sm:grid-cols-3 sm:px-5">
        <EvidenceCard label="Codec" value={codecDescription(video)} description="Codec · profile · pixel format" />
        <EvidenceCard label="Timeline" value={timelineDescription(chunk, video)} description="PTS range · presentation boundary" />
        <EvidenceCard label="GOP & random access" value={gopDescription(boundary, gops)} description="Observed groups · key-frame boundary" />
      </div>
      {structural && (
        <section className="mx-4 mb-4 rounded-2xl border border-slate-200 bg-slate-50 p-4 sm:mx-5">
          <p className="text-[9px] font-semibold uppercase tracking-[0.18em] text-slate-500">Container structure · MPEG-TS</p>
          <div className="mt-3 grid gap-2 sm:grid-cols-3">
            <ContainerFact label="Packets" value={String(structural.packetCount)} tone={structural.syncErrors > 0 ? "amber" : "green"} hint={structural.syncErrors > 0 ? `${structural.syncErrors} sync errors` : "sync ok"} />
            <ContainerFact label="Tables" value={[structural.hasPat && "PAT", structural.hasPmt && "PMT", structural.hasPcr && "PCR"].filter(Boolean).join(" · ") || "none"} tone={structural.hasPat && structural.hasPmt ? "green" : "amber"} hint={structural.truncatedTail ? "truncated tail" : "complete"} />
            <ContainerFact label="Continuity" value={`${structural.continuityDiscontinuities} drop${structural.continuityDiscontinuities === 1 ? "" : "s"}`} tone={structural.continuityDiscontinuities > 0 || structural.pcrDiscontinuities > 0 ? "amber" : "green"} hint={structural.pcrDiscontinuities > 0 ? `${structural.pcrDiscontinuities} PCR jumps` : "continuous"} />
          </div>
        </section>
      )}
      {http && (http.latencyMs !== undefined || http.firstByteMs !== undefined || http.redirectCount > 0 || http.server) && (
        <section className="mx-4 mb-4 rounded-2xl border border-slate-200 bg-slate-50 p-4 sm:mx-5">
          <p className="text-[9px] font-semibold uppercase tracking-[0.18em] text-slate-500">Delivery · this chunk</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <ContainerFact label="Latency" value={http.latencyMs === undefined ? "—" : `${Math.round(http.latencyMs)} ms`} tone="neutral" />
            <ContainerFact label="First byte" value={http.firstByteMs === undefined ? "—" : `${Math.round(http.firstByteMs)} ms`} tone="neutral" />
            <ContainerFact label="Redirects" value={String(http.redirectCount)} tone="neutral" />
            {http.server && <ContainerFact label="Server" value={http.server} tone="neutral" />}
            {http.cacheControl && <ContainerFact label="Cache" value={http.cacheControl} tone="neutral" />}
          </div>
        </section>
      )}
      <p className="border-t border-slate-200 px-4 py-3 text-[10px] leading-5 text-slate-400 sm:px-5">The visual uses only preserved FFprobe/fMP4 facts. Counts can describe the complete chunk; frame detail may be bounded when the artifact is large.</p>
    </article>
  );
}

function TrackLanes({ tracks }: { tracks: Probe["tracks"] }): JSX.Element | null {
  const timed = tracks.filter((track) => track.firstPts !== undefined && track.lastPts !== undefined);
  if (timed.length === 0) return null;
  const values = timed.flatMap((track) => [track.firstPts!, track.lastPts!]);
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const span = Math.max(maximum - minimum, 0.001);
  return (
    <div className="mx-4 mt-4 space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3 sm:mx-5">
      {timed.map((track, index) => {
        const left = ((track.firstPts! - minimum) / span) * 100;
        const width = Math.max(((track.lastPts! - track.firstPts!) / span) * 100, 1);
        return (
          <div className="grid grid-cols-[62px_minmax(0,1fr)_110px] items-center gap-2" key={`${track.kind}-${index}`}>
            <span className="text-[9px] font-semibold uppercase tracking-wide text-slate-500">{track.kind}</span>
            <div className="relative h-2 rounded-full bg-slate-200"><span className={`absolute inset-y-0 rounded-full ${track.kind === "audio" ? "bg-emerald-500" : "bg-violet-500"}`} style={{ left: `${left}%`, width: `${width}%` }} /></div>
            <span className="text-right font-mono text-[9px] text-slate-500">{formatNumber(track.firstPts!, 3)} → {formatNumber(track.lastPts!, 3)}</span>
          </div>
        );
      })}
    </div>
  );
}

function GopButton({ gop, selected, onSelect }: { gop: VisualGop; selected: boolean; onSelect(): void }): JSX.Element {
  const preview = gop.frames.slice(0, 24);
  return (
    <button className={`min-w-[150px] rounded-xl border p-3 text-left transition ${selected ? "border-violet-400 bg-violet-100" : "border-slate-200 bg-white hover:border-slate-300"}`} onClick={onSelect} type="button">
      <span className="flex items-center justify-between gap-2 text-[9px] font-semibold uppercase tracking-wide text-slate-500"><span>{gop.label}</span><span>{gop.frameCount}f</span></span>
      <span className="mt-3 flex h-8 items-end gap-px">
        {preview.map((frame, index) => <i className={`block min-w-[2px] flex-1 rounded-t-sm ${frameBarClass(frame.type)}`} key={`${frame.pts ?? index}-${index}`} />)}
      </span>
      <span className="mt-2 block font-mono text-[9px] text-slate-400">{gop.firstPtsTime === undefined ? sourceLabel(gop.source) : `PTS ${formatNumber(gop.firstPtsTime, 3)}`}</span>
    </button>
  );
}

function FrameMap({ gop }: { gop: VisualGop }): JSX.Element {
  const [selectedFrameIndex, setSelectedFrameIndex] = useState(0);
  const selectedFrame = gop.frames[selectedFrameIndex] ?? gop.frames[0];
  const minWidth = Math.max(420, gop.frames.length * 6);
  return (
    <div className="mt-3 rounded-xl border border-slate-200 bg-white p-3">
      <div className="flex flex-wrap items-center justify-between gap-2 text-[9px] text-slate-500">
        <span>{gop.label} · {gop.frameCount} frame{gop.frameCount === 1 ? "" : "s"}{gop.truncated ? " · detail bounded" : ""}</span>
        <span>{gop.startsWithKeyFrame === undefined ? sourceLabel(gop.source) : gop.startsWithKeyFrame ? "Starts with key frame" : "Open boundary observed"}</span>
      </div>
      <div className="mt-3 overflow-x-auto pb-5">
        <div className="grid h-28 items-end gap-px border-b border-slate-200" style={{ gridTemplateColumns: `repeat(${Math.max(gop.frames.length, 1)}, minmax(3px, 1fr))`, minWidth }}>
          {gop.frames.map((frame, index) => (
            <button aria-label={`Inspect frame ${index + 1}, ${frame.label}`} className={`relative h-full ${selectedFrameIndex === index ? "bg-violet-50" : "hover:bg-slate-50"}`} key={`${frame.pts ?? index}-${index}`} onClick={() => setSelectedFrameIndex(index)} type="button">
              <span className={`absolute inset-x-px bottom-0 rounded-t-sm transition-transform hover:-translate-y-1 ${frameBarClass(frame.type)} ${selectedFrameIndex === index ? "ring-1 ring-violet-500" : ""}`} />
              <span className="absolute -bottom-4 left-1/2 -translate-x-1/2 font-mono text-[7px] text-slate-400">{index + 1}</span>
            </button>
          ))}
        </div>
      </div>
      {selectedFrame && (
        <div className="mt-2 grid gap-2 sm:grid-cols-5">
          <FrameFact label="Frame" value={`${selectedFrameIndex + 1} · ${selectedFrame.label}`} />
          <FrameFact label="PTS" value={formatTimestamp(selectedFrame.ptsTime, selectedFrame.pts)} />
          <FrameFact label="DTS" value={formatTimestamp(selectedFrame.dtsTime, selectedFrame.dts)} />
          <FrameFact label="Duration" value={selectedFrame.duration ?? "—"} />
          <FrameFact label="Access" value={selectedFrame.keyFrame ? "key frame" : selectedFrame.sync ? "sync sample" : "not signaled"} />
        </div>
      )}
    </div>
  );
}

function FrameLegend(): JSX.Element {
  return <span className="flex flex-wrap items-center gap-2 text-[9px] text-slate-500"><LegendDot color="bg-violet-500" label="I" /><LegendDot color="bg-sky-500" label="P" /><LegendDot color="bg-slate-300" label="B" /><LegendDot color="bg-amber-500" label="RA / sync" /></span>;
}

function LegendDot({ color, label }: { color: string; label: string }): JSX.Element { return <span className="inline-flex items-center gap-1"><i className={`h-1.5 w-1.5 rounded-sm ${color}`} />{label}</span>; }
function InspectorPill({ children }: { children: string }): JSX.Element { return <span className="rounded-md bg-slate-100 px-2 py-1 font-mono text-[9px] text-slate-600">{children}</span>; }
function TimingFact({ label, value, tone = "neutral" }: { label: string; value: string; tone?: "neutral" | "green" }): JSX.Element { return <div className={`rounded-xl border px-3 py-2.5 ${tone === "green" ? "border-emerald-200 bg-emerald-50" : "border-slate-200 bg-slate-50"}`}><p className="text-[9px] uppercase tracking-wide text-slate-400">{label}</p><p className={`mt-1 font-mono text-[10px] ${tone === "green" ? "text-emerald-700" : "text-slate-600"}`}>{value}</p></div>; }
function EvidenceCard({ label, value, description }: { label: string; value: string; description: string }): JSX.Element { return <div className="rounded-xl border border-slate-200 bg-slate-50 p-3"><p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-slate-400">{label}</p><p className="mt-1.5 truncate text-xs font-semibold text-slate-700" title={value}>{value}</p><p className="mt-1 text-[9px] text-slate-400">{description}</p></div>; }
function FrameFact({ label, value }: { label: string; value: string }): JSX.Element { return <div className="rounded-lg bg-slate-50 px-2.5 py-2"><p className="text-[8px] uppercase tracking-wide text-slate-400">{label}</p><p className="mt-1 truncate font-mono text-[9px] text-slate-600" title={value}>{value}</p></div>; }
function ContainerFact({ label, value, tone = "neutral", hint }: { label: string; value: string; tone?: "green" | "amber" | "neutral"; hint?: string }): JSX.Element {
  return <div className={`rounded-xl border px-3 py-2 ${tone === "green" ? "border-emerald-200 bg-emerald-50" : tone === "amber" ? "border-amber-200 bg-amber-50" : "border-slate-200 bg-white"}`}><p className="text-[8px] uppercase tracking-wide text-slate-400">{label}</p><p className={`mt-1 truncate font-mono text-[10px] ${tone === "green" ? "text-emerald-700" : tone === "amber" ? "text-amber-700" : "text-slate-600"}`} title={value}>{value}</p>{hint && <p className="mt-0.5 text-[8px] text-slate-400">{hint}</p>}</div>; }

function DeliveryFacts({ evidence }: { evidence: Evidence }): JSX.Element {
  const manifests = evidence.manifests;
  const withFacts = manifests.filter((manifest) => manifest.http);
  if (withFacts.length === 0) return <></>;
  return (
    <section className="mt-6 overflow-hidden rounded-2xl border border-slate-200 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-3 sm:px-5">
        <div>
          <p className="text-[9px] font-semibold uppercase tracking-[0.18em] text-sky-700">Delivery facts</p>
          <p className="mt-1 text-xs font-semibold text-slate-700">Network observations from the protected fetch boundary</p>
        </div>
        <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[10px] text-slate-500">{withFacts.length} manifest{withFacts.length === 1 ? "" : "s"}</span>
      </div>
      <div className="divide-y divide-slate-100">
        {withFacts.map((manifest) => (
          <div className="grid gap-2 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_repeat(3,minmax(110px,auto))] sm:items-center sm:px-5" key={manifest.artifactId}>
            <div className="min-w-0">
              <p className="truncate font-mono text-[10px] font-semibold text-slate-700">{manifest.logicalKey}</p>
              <p className="mt-0.5 truncate text-[9px] text-slate-400">{manifest.finalUrl}</p>
            </div>
            <HttpFact label="Latency" value={manifest.http?.latencyMs === undefined ? "—" : `${Math.round(manifest.http.latencyMs)} ms`} />
            <HttpFact label="First byte" value={manifest.http?.firstByteMs === undefined ? "—" : `${Math.round(manifest.http.firstByteMs)} ms`} />
            <div className="flex flex-wrap gap-1.5">
              <HttpFact label="Redirects" value={String(manifest.http?.redirectCount ?? 0)} />
              {manifest.http?.server && <HttpFact label="Server" value={manifest.http.server} />}
              {manifest.http?.cacheControl && <HttpFact label="Cache" value={manifest.http.cacheControl} />}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function HttpFact({ label, value }: { label: string; value: string }): JSX.Element {
  return <div className="rounded-lg bg-slate-50 px-2.5 py-1.5"><p className="text-[8px] uppercase tracking-wide text-slate-400">{label}</p><p className="mt-0.5 truncate font-mono text-[10px] text-slate-600" title={value}>{value}</p></div>;
}

function LadderAlignment({ evidence }: { evidence: Evidence }): JSX.Element {
  const topology = evidence.hls?.topology;
  if (!topology?.length) return <></>;
  const warnings = evidence.observations.filter((observation) => observation.code === "HLS_TARGET_DURATION_MISMATCH" || observation.code === "HLS_DISCONTINUITY_MISMATCH");
  const sampledKeys = new Set((evidence.hls?.selection?.sampledVariants ?? []).map((entry) => entry.logicalKey));
  return (
    <section className="mt-6 overflow-hidden rounded-2xl border border-slate-200 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-3 sm:px-5">
        <div>
          <p className="text-[9px] font-semibold uppercase tracking-[0.18em] text-violet-700">Ladder alignment</p>
          <p className="mt-1 text-xs font-semibold text-slate-700">Declared per-variant topology from the collected playlists</p>
        </div>
        {warnings.map((warning) => <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[10px] font-medium text-amber-700" key={warning.code}>{warning.message}</span>)}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-left">
          <thead>
            <tr className="border-b border-slate-100 text-[8px] font-semibold uppercase tracking-[0.16em] text-slate-400">
              <th className="px-4 py-2">Variant</th>
              <th className="px-3 py-2">Segments</th>
              <th className="px-3 py-2">Target duration</th>
              <th className="px-3 py-2">Discontinuities</th>
              <th className="px-3 py-2">End list</th>
              <th className="px-4 py-2 text-right">Media</th>
            </tr>
          </thead>
          <tbody>
            {topology.map((entry) => {
              const variant = evidence.hls?.variants.find((value) => value.index === entry.index);
              const sampled = sampledKeys.has(entry.logicalKey);
              return (
                <tr className="border-b border-slate-50 text-[11px] text-slate-600 last:border-b-0" key={entry.logicalKey}>
                  <td className="px-4 py-2">
                    <span className="font-semibold text-slate-800">#{entry.index}</span>
                    <span className="ml-2 text-slate-500">{variant?.resolution ?? variant?.codecs ?? "video"}</span>
                  </td>
                  <td className="px-3 py-2 font-mono text-[10px]">{entry.segmentCount}</td>
                  <td className="px-3 py-2 font-mono text-[10px]">{entry.targetDuration === undefined ? "—" : `${entry.targetDuration}s`}</td>
                  <td className="px-3 py-2 font-mono text-[10px]">{entry.discontinuityCount ?? 0}</td>
                  <td className="px-3 py-2 font-mono text-[10px]">{entry.hasEndList === undefined ? "—" : entry.hasEndList ? "yes" : "no"}</td>
                  <td className="px-4 py-2 text-right">{sampled ? <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[9px] font-medium text-emerald-700">sampled</span> : <span className="text-[9px] text-slate-400">not sampled</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function TimelineContinuity({ evidence }: { evidence: Evidence }): JSX.Element {
  const timeline = evidence.timeline;
  if (!timeline?.length) return <></>;
  return (
    <section className="mt-6 overflow-hidden rounded-2xl border border-slate-200 bg-white">
      <div className="border-b border-slate-200 px-4 py-3 sm:px-5">
        <p className="text-[9px] font-semibold uppercase tracking-[0.18em] text-emerald-700">Timeline continuity</p>
        <p className="mt-1 text-xs font-semibold text-slate-700">Presentation gaps and overlaps between contiguous chunks</p>
      </div>
      <div className="space-y-2 px-4 py-4 sm:px-5">
        {timeline.map((window) => (
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5" key={window.key}>
            <span className="font-mono text-[10px] font-semibold text-slate-700">{shortChunkName({ logicalKey: window.key } as MediaSample)}</span>
            <span className="rounded-md bg-slate-200/60 px-2 py-0.5 text-[9px] font-medium uppercase tracking-wide text-slate-500">{window.kind}</span>
            <span className="text-[10px] text-slate-500">{window.segmentCount} segment{window.segmentCount === 1 ? "" : "s"}</span>
            {window.continuous ? (
              <span className="ml-auto inline-flex items-center gap-1.5 text-[10px] font-medium text-emerald-700"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />Continuous</span>
            ) : (
              <span className="ml-auto inline-flex items-center gap-1.5 text-[10px] font-medium text-amber-700"><span className="h-1.5 w-1.5 rounded-full bg-amber-500" />{window.gaps.length} gap{window.gaps.length === 1 ? "" : "s"} · {window.totalGapMs} ms total</span>
            )}
            {!window.continuous && (
              <details className="w-full">
                <summary className="cursor-pointer text-[9px] font-semibold uppercase tracking-wide text-slate-400">Boundary facts</summary>
                <div className="mt-2 space-y-1">
                  {window.gaps.map((gap, index) => (
                    <p className="font-mono text-[9px] leading-4 text-slate-500" key={`${gap.fromLogicalKey}-${gap.toLogicalKey}-${index}`}>
                      {gap.fromSequence ?? "—"} → {gap.toSequence ?? "—"}{gap.presentationGapMs !== undefined ? ` · ${gap.presentationGapMs} ms gap` : ` · ${gap.presentationOverlapMs} ms overlap`}
                    </p>
                  ))}
                </div>
              </details>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

function ObservedPlaybackSwitches({ evidence }: { evidence: Evidence }): JSX.Element {
  const switches = evidence.playbackSwitches;
  if (!switches?.length) return <></>;
  const downshifts = switches.filter((entry) => entry.direction === "DOWNSHIFT").length;
  const upshifts = switches.filter((entry) => entry.direction === "UPSHIFT").length;
  const failed = switches.filter((entry) => entry.deterministicFindings.some((finding) => finding.severity === "HIGH" || finding.severity === "CRITICAL")).length;
  return (
    <section className="mt-6 overflow-hidden rounded-2xl border border-slate-200 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-3 sm:px-5">
        <div>
          <p className="text-[9px] font-semibold uppercase tracking-[0.18em] text-sky-700">Observed playback switches</p>
          <p className="mt-1 text-xs font-semibold text-slate-700">Request-level ABR transitions from related Record playback runs</p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[10px] text-slate-600">{switches.length} observed</span>
          <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[10px] text-amber-700">{downshifts} down · {upshifts} up</span>
          {failed > 0 && <span className="rounded-full border border-rose-200 bg-rose-50 px-2.5 py-1 text-[10px] text-rose-700">{failed} high-risk</span>}
        </div>
      </div>
      <div className="divide-y divide-slate-100">
        {switches.map((entry) => {
          const source = entry.sourceRepresentation;
          const target = entry.targetRepresentation;
          const risky = entry.deterministicFindings.some((finding) => finding.severity === "HIGH" || finding.severity === "CRITICAL");
          return (
            <div className="flex flex-wrap items-center gap-2 px-4 py-3 sm:px-5" key={entry.switchId}>
              <span className={`h-2 w-2 rounded-full ${risky ? "bg-rose-500" : entry.direction === "DOWNSHIFT" ? "bg-amber-400" : "bg-emerald-500"}`} />
              <span className="font-mono text-[10px] font-semibold text-slate-700">{source.id}</span>
              <span className="text-[10px] text-slate-400">→</span>
              <span className="font-mono text-[10px] font-semibold text-slate-700">{target.id}</span>
              <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[9px] font-medium uppercase tracking-wide text-slate-500">{entry.direction.toLowerCase()}</span>
              <span className="rounded-md bg-slate-100 px-2 py-0.5 font-mono text-[9px] text-slate-500">{entry.switchKind === "RESOLUTION_CHANGING" ? `${source.height ?? "?"}×${source.width ?? "?"} → ${target.height ?? "?"}×${target.width ?? "?"}` : "same resolution"}</span>
              {risky && <span className="rounded-md border border-rose-200 bg-rose-50 px-2 py-0.5 text-[9px] font-medium text-rose-700">high risk</span>}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function drmSchemes(evidence: Evidence): string[] {
  const schemes = new Set<string>();
  for (const sample of evidence.mediaSamples) {
    const init = sample.probe?.fmp4?.init as { drm?: { pssh?: Array<{ classification?: string }> } } | undefined;
    for (const pssh of init?.drm?.pssh ?? []) {
      if (pssh.classification && pssh.classification !== "unknown") schemes.add(pssh.classification);
    }
  }
  return [...schemes];
}

function buildLadderRows(evidence: Evidence): LadderRow[] {
  const chunks = evidence.mediaSamples.filter((sample) => sample.kind === "media-segment");
  const rows: LadderRow[] = [];
  const assigned = new Set<string>();
  if (evidence.dash) {
    for (const representation of evidence.dash.representations) {
      const samples = sortSamples(chunks.filter((sample) => sample.representationId === representation.id));
      samples.forEach((sample) => assigned.add(sample.logicalKey));
      rows.push({
        id: `dash-${representation.periodIndex}-${representation.adaptationSetIndex}-${representation.id}`,
        label: representation.contentType === "video" && representation.width && representation.height ? `${representation.width}×${representation.height}` : representation.id,
        detail: [representation.id, formatBandwidth(representation.bandwidth), representation.codecs, representation.frameRate ? `${representation.frameRate} fps` : undefined].filter(Boolean).join(" · "),
        kind: representation.contentType,
        samples,
        declaredCount: representation.segmentCount,
        collectorSelection: samples.length > 0,
      });
    }
  } else if (evidence.hls?.variants.length) {
    const sampledVariantKeys = new Map(
      (evidence.hls.selection?.sampledVariants ?? []).map((entry) => [entry.index, entry.logicalKey]),
    );
    const selectedVariantKey = evidence.hls.selection?.variantLogicalKey;
    for (const variant of evidence.hls.variants) {
      const sourceKey = sampledVariantKeys.get(variant.index)
        ?? (variant.index === evidence.hls.selection?.variantIndex ? selectedVariantKey : undefined);
      const samples = sourceKey ? sortSamples(chunks.filter((sample) => sample.sourceManifestLogicalKey === sourceKey)) : [];
      samples.forEach((sample) => assigned.add(sample.logicalKey));
      rows.push({
        id: `hls-variant-${variant.index}`,
        label: variant.resolution ?? `Variant ${variant.index + 1}`,
        detail: [formatBandwidth(variant.averageBandwidth ?? variant.bandwidth), variant.codecs, variant.frameRate ? `${variant.frameRate} fps` : undefined].filter(Boolean).join(" · "),
        kind: "video",
        samples,
        declaredCount: manifestSegmentCount(evidence, sourceKey),
        collectorSelection: variant.index === evidence.hls.selection?.variantIndex,
      });
    }
    for (const rendition of evidence.hls.renditions.filter((entry) => entry.type.toUpperCase() === "AUDIO")) {
      const sourceKey = rendition.index === evidence.hls.selection?.audioRenditionIndex ? evidence.hls.selection.audioRenditionLogicalKey : undefined;
      const samples = sourceKey ? sortSamples(chunks.filter((sample) => sample.sourceManifestLogicalKey === sourceKey)) : [];
      samples.forEach((sample) => assigned.add(sample.logicalKey));
      rows.push({
        id: `hls-audio-${rendition.index}`,
        label: rendition.name ?? rendition.language ?? `Audio ${rendition.index + 1}`,
        detail: [rendition.language, rendition.channels ? `${rendition.channels} ch` : undefined, rendition.groupId].filter(Boolean).join(" · "),
        kind: "audio",
        samples,
        declaredCount: manifestSegmentCount(evidence, sourceKey),
        collectorSelection: rendition.index === evidence.hls.selection?.audioRenditionIndex,
      });
    }
  }
  const remaining = chunks.filter((sample) => !assigned.has(sample.logicalKey));
  const groups = groupSamples(remaining);
  for (const [key, samples] of groups) {
    const track = samples[0]?.probe?.tracks.find((entry) => entry.kind === "video") ?? samples[0]?.probe?.tracks[0];
    rows.push({
      id: `observed-${key}`,
      label: track?.width && track.height ? `${track.width}×${track.height}` : samples[0]?.representationId ?? "Media playlist",
      detail: [track?.kind, track?.codec].filter(Boolean).join(" · "),
      kind: track?.kind === "video" || track?.kind === "audio" ? track.kind : "unknown",
      samples: sortSamples(samples),
      declaredCount: manifestSegmentCount(evidence, samples[0]?.sourceManifestLogicalKey),
      collectorSelection: true,
    });
  }
  return rows.sort((left, right) => kindOrder(left.kind) - kindOrder(right.kind));
}

function visualGops(chunk: MediaSample): VisualGop[] {
  const boundary = chunk.probe?.boundary;
  if (boundary?.gops?.length) {
    return boundary.gops.map((gop) => ({
      key: `gop-${gop.index}`,
      label: `GOP ${gop.index + 1}`,
      source: "gop",
      frames: gop.frames.map(frameFromBoundary),
      frameCount: gop.frameCount,
      startsWithKeyFrame: gop.startsWithKeyFrame,
      firstPtsTime: gop.firstPtsTime,
      lastPtsTime: gop.lastPtsTime,
      truncated: gop.truncated,
    }));
  }
  if (boundary?.frames.length) {
    return [{ key: "frame-boundary", label: "Frame boundary", source: "frame-boundary", frames: boundary.frames.map(frameFromBoundary), frameCount: boundary.totalFrameCount, truncated: boundary.frames.length < boundary.totalFrameCount }];
  }
  const samples = chunk.probe?.fmp4?.fragment.samples ?? [];
  if (samples.length) {
    return [{
      key: "fmp4-boundary", label: "fMP4 boundary", source: "fmp4-boundary", frameCount: samples.length, truncated: false,
      frames: samples.map((sample) => ({
        type: randomAccessKind(sample.firstFrameKind, sample.sync), label: sample.firstFrameKind === "other" && sample.sync ? "SYNC" : sample.firstFrameKind.toUpperCase(), pts: sample.pts, dts: sample.dts,
        duration: sample.duration, sync: sample.sync, size: sample.size,
      })),
    }];
  }
  return [];
}

function frameFromBoundary(frame: BoundaryFrame): VisualFrame {
  const type = frame.pictureType?.toUpperCase();
  return {
    type: type === "I" || type === "P" || type === "B" ? type : frame.keyFrame ? "RA" : "?",
    label: type ?? (frame.keyFrame ? "KEY" : "UNKNOWN"), pts: frame.pts, ptsTime: frame.ptsTime,
    dts: frame.packetDts, dtsTime: frame.packetDtsTime, duration: frame.duration, keyFrame: frame.keyFrame, pixelFormat: frame.pixelFormat,
  };
}

function randomAccessKind(kind: string, sync: boolean | undefined): VisualFrame["type"] { return kind === "idr" || kind === "cra" || kind === "bla" || sync ? "RA" : "?"; }
function frameBarClass(type: VisualFrame["type"]): string { return type === "I" ? "h-[88%] bg-violet-500" : type === "P" ? "h-[58%] bg-sky-500" : type === "B" ? "h-[30%] bg-slate-300" : type === "RA" ? "h-full bg-amber-500" : "h-[42%] bg-slate-200"; }
function sourceLabel(source: VisualGop["source"]): string { return source === "gop" ? "Observed GOP" : source === "fmp4-boundary" ? "fMP4 sample boundary" : "Bounded FFprobe frames"; }

function groupSamples(samples: MediaSample[]): Map<string, MediaSample[]> {
  const groups = new Map<string, MediaSample[]>();
  for (const sample of samples) {
    const key = sample.representationId ?? sample.sourceManifestLogicalKey ?? "unassigned";
    groups.set(key, [...(groups.get(key) ?? []), sample]);
  }
  return groups;
}

function sortSamples(samples: MediaSample[]): MediaSample[] {
  return [...samples].sort((left, right) => (left.presentationStartSeconds ?? left.sampleIndex ?? left.sequence ?? 0) - (right.presentationStartSeconds ?? right.sampleIndex ?? right.sequence ?? 0));
}

function typicalDuration(chunks: MediaSample[], evidence: Evidence): number | undefined {
  const durations = chunks.flatMap((sample) => sample.declaredDuration === undefined ? [] : [sample.declaredDuration]).sort((left, right) => left - right);
  if (durations.length) return durations[Math.floor(durations.length / 2)];
  return evidence.manifests.find((manifest) => manifest.targetDuration !== undefined)?.targetDuration;
}

function videoCodecs(evidence: Evidence, chunks: MediaSample[]): string {
  const declared = evidence.dash?.representations.filter((entry) => entry.contentType === "video").flatMap((entry) => entry.codecs ? [entry.codecs] : [])
    ?? evidence.hls?.variants.flatMap((entry) => entry.codecs ? [entry.codecs] : [])
    ?? [];
  const probed = chunks.flatMap((sample) => sample.probe?.tracks.filter((track) => track.kind === "video" && track.codec).map((track) => track.codec!) ?? []);
  const observed = [...new Set(probed)];
  if (observed.length) return observed.slice(0, 2).join(" / ");
  const declaredVideo = declared.flatMap((value) => value.split(",").map((codec) => codec.trim()).filter((codec) => /^(avc|hvc|hev|vp|av01|dv)/i.test(codec)));
  return [...new Set(declaredVideo)].slice(0, 2).join(" / ");
}

function manifestSegmentCount(evidence: Evidence, logicalKey: string | undefined): number | undefined { return logicalKey ? evidence.manifests.find((manifest) => manifest.logicalKey === logicalKey)?.segmentCount : undefined; }
function kindOrder(kind: LadderRow["kind"]): number { return kind === "video" ? 0 : kind === "audio" ? 1 : 2; }
function formatBandwidth(value: number | undefined): string | undefined { return value === undefined ? undefined : value >= 1_000_000 ? `${formatNumber(value / 1_000_000, 2)} Mbps` : `${Math.round(value / 1_000)} kbps`; }
function formatNumber(value: number, digits: number): string { return value.toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: 0 }); }
function formatTimestamp(value: number | undefined, raw: string | undefined): string { return value === undefined ? raw ?? "—" : `${formatNumber(value, 3)}s`; }
function sizeLabel(bytes: number): string { return bytes >= 1_048_576 ? `${formatNumber(bytes / 1_048_576, 1)} MB` : `${Math.max(1, Math.round(bytes / 1_024))} KB`; }
function manifestName(url: string | undefined): string | undefined { if (!url) return undefined; try { const parts = new URL(url).pathname.split("/").filter(Boolean); return parts[parts.length - 1] ?? new URL(url).hostname; } catch { return undefined; } }
function shortChunkName(chunk: MediaSample): string { const parts = chunk.logicalKey.split("/").filter(Boolean); return parts.slice(-3).join("/") || chunk.logicalKey; }
function representationFromLogicalKey(chunk: MediaSample): string { return chunk.sourceManifestLogicalKey?.split("/").filter(Boolean).slice(-1)[0] ?? "media"; }
function codecDescription(track: Probe["tracks"][number] | undefined): string { return [track?.codec, track?.profile, track?.level === undefined ? undefined : `L${track.level}`, track?.pixelFormat].filter(Boolean).join(" · ") || "Not observed"; }
function timelineDescription(chunk: MediaSample, track: Probe["tracks"][number] | undefined): string { if (track?.firstPts !== undefined && track.lastPts !== undefined) return `${formatNumber(track.firstPts, 3)}s → ${formatNumber(track.lastPts, 3)}s`; if (chunk.presentationStartSeconds !== undefined && chunk.presentationEndSeconds !== undefined) return `${formatNumber(chunk.presentationStartSeconds, 3)}s → ${formatNumber(chunk.presentationEndSeconds, 3)}s`; return "Not observed"; }
function gopDescription(boundary: Boundary | undefined, gops: VisualGop[]): string { if (boundary?.totalGopCount) return `${boundary.totalGopCount} GOP${boundary.totalGopCount === 1 ? "" : "s"} · ${boundary.totalFrameCount} frames`; if (gops.length) return `${gops[0]!.label} · ${gops[0]!.frameCount} frames`; return "Not observed"; }
