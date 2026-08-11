import { StreamCollectionError } from "./errors.js";

export type DashSegmentReference = {
  number: number;
  time: bigint;
  duration: bigint;
  presentationStartSeconds: number;
  presentationEndSeconds: number;
  url?: string;
  range?: { start: number; end?: number };
};

export type DashRepresentation = {
  id: string;
  periodIndex: number;
  adaptationSetIndex: number;
  contentType: "video" | "audio" | "unknown";
  mimeType?: string;
  codecs?: string;
  bandwidth?: number;
  width?: number;
  height?: number;
  frameRate?: string;
  sar?: string;
  baseUrl: string;
  timescale: number;
  presentationTimeOffset: bigint;
  initializationUrl?: string;
  initializationRange?: { start: number; end?: number };
  mediaTemplate?: string;
  segmentAddressing: "template" | "list" | "base" | "unknown";
  segmentAlignment?: boolean;
  subsegmentAlignment?: boolean;
  startWithSap?: number;
  subsegmentStartsWithSap?: number;
  bitstreamSwitching?: boolean;
  contentProtection: DashContentProtection[];
  segments: DashSegmentReference[];
};

export type DashContentProtection = {
  schemeIdUri?: string;
  value?: string;
  defaultKid?: string;
  pssh: string[];
};

export type DashAdaptationSet = {
  periodIndex: number;
  index: number;
  id?: string;
  contentType: "video" | "audio" | "unknown";
  mimeType?: string;
  codecs?: string;
  width?: number;
  maxWidth?: number;
  height?: number;
  maxHeight?: number;
  frameRate?: string;
  maxFrameRate?: string;
  sar?: string;
  par?: string;
  segmentAlignment?: boolean;
  subsegmentAlignment?: boolean;
  startWithSap?: number;
  subsegmentStartsWithSap?: number;
  bitstreamSwitching?: boolean;
  initialization?: string;
  timescale: number;
  duration?: string;
  presentationTimeOffset: string;
  segmentTimeline: Array<{ time?: string; duration: string; repeat: number }>;
  contentProtection: DashContentProtection[];
  representationIds: string[];
  switchingContract: SwitchingContract;
};

export type SwitchingContract = {
  mode: "GENERAL_REINITIALIZATION" | "BITSTREAM_SWITCHING" | "CMAF_SWITCHING_SET" | "UNKNOWN";
  bitstreamSwitching?: boolean;
  segmentAlignment?: boolean;
  subsegmentAlignment?: boolean;
  startWithSap?: number;
  subsegmentStartsWithSap?: number;
  effectiveTimescale?: number;
  presentationTimeOffset?: string;
  codecFamily: string;
  sampleEntryExpectation?: string;
  representations: string[];
};

export type DashManifestInspection = {
  type: "static" | "dynamic";
  mediaPresentationDurationSeconds?: number;
  profiles: string[];
  periods: Array<{ index: number; id?: string; startSeconds: number; durationSeconds?: number }>;
  adaptationSets: DashAdaptationSet[];
  representations: DashRepresentation[];
  limitations: string[];
};

type XmlNode = { name: string; attributes: Record<string, string>; children: XmlNode[]; text: string };
type SegmentTemplate = {
  timescale?: number;
  presentationTimeOffset?: bigint;
  duration?: bigint;
  startNumber?: number;
  media?: string;
  initialization?: string;
  indexRange?: { start: number; end?: number };
  timeline?: Array<{ time?: bigint; duration: bigint; repeat: number }>;
};

/** Parses the DASH subset needed to map presentation time to complete fMP4 segments. */
export function parseDashMpd(xml: string, manifestUrl: string): DashManifestInspection {
  const root = parseXml(xml);
  if (localName(root.name) !== "MPD") {
    throw new StreamCollectionError("UNSUPPORTED_MANIFEST", "The DASH document has no MPD root element", false);
  }
  const type = root.attributes.type === "dynamic" ? "dynamic" : "static";
  const profiles = (root.attributes.profiles ?? "").split(/[\s,]+/).filter(Boolean);
  const mpdDuration = parseDuration(root.attributes.mediaPresentationDuration);
  const limitations: string[] = [];
  if (type === "dynamic") limitations.push("Dynamic MPD analysis is a snapshot; future segment availability was not inferred.");
  const rootBase = resolveBase(manifestUrl, childText(root, "BaseURL"));
  const rootTemplate = templateFrom(root);
  const periods: DashManifestInspection["periods"] = [];
  const adaptationSets: DashAdaptationSet[] = [];
  const representations: DashRepresentation[] = [];
  let inferredPeriodStart = 0;
  const periodNodes = children(root, "Period");
  periodNodes.forEach((period, periodIndex) => {
    const startSeconds = parseDuration(period.attributes.start) ?? inferredPeriodStart;
    const durationSeconds = parseDuration(period.attributes.duration)
      ?? (periodIndex === periodNodes.length - 1 && mpdDuration !== undefined ? Math.max(0, mpdDuration - startSeconds) : undefined);
    if (durationSeconds !== undefined) inferredPeriodStart = startSeconds + durationSeconds;
    periods.push({ index: periodIndex, ...(period.attributes.id ? { id: period.attributes.id } : {}), startSeconds, ...(durationSeconds === undefined ? {} : { durationSeconds }) });
    const periodBase = resolveBase(rootBase, childText(period, "BaseURL"));
    const periodTemplate = mergeTemplate(rootTemplate, templateFrom(period));
    children(period, "AdaptationSet").forEach((adaptationSet, adaptationSetIndex) => {
      const adaptationBase = resolveBase(periodBase, childText(adaptationSet, "BaseURL"));
      const adaptationTemplate = mergeTemplate(periodTemplate, templateFrom(adaptationSet));
      const inheritedType = contentType(adaptationSet.attributes.contentType, adaptationSet.attributes.mimeType, adaptationSet.attributes.codecs);
      const segmentAlignment = booleanAttribute(adaptationSet, "segmentAlignment");
      const subsegmentAlignment = booleanAttribute(adaptationSet, "subsegmentAlignment");
      const startWithSap = numberAttribute(adaptationSet, "startWithSAP");
      const subsegmentStartsWithSap = numberAttribute(adaptationSet, "subsegmentStartsWithSAP");
      const bitstreamSwitching = booleanAttribute(adaptationSet, "bitstreamSwitching") ?? booleanAttribute(root, "bitstreamSwitching");
      const adaptationProtection = contentProtectionFrom(adaptationSet);
      const representationIds: string[] = [];
      children(adaptationSet, "Representation").forEach((representation, representationIndex) => {
        const representationBase = resolveBase(adaptationBase, childText(representation, "BaseURL"));
        const template = mergeTemplate(adaptationTemplate, templateFrom(representation));
        const id = representation.attributes.id ?? `p${periodIndex}-a${adaptationSetIndex}-r${representationIndex}`;
        representationIds.push(id);
        const timescale = template.timescale ?? 1;
        const pto = template.presentationTimeOffset ?? 0n;
        const mediaTemplate = template.media;
        const bandwidth = numberAttribute(representation, "bandwidth");
        const width = numberAttribute(representation, "width") ?? numberAttribute(adaptationSet, "width");
        const height = numberAttribute(representation, "height") ?? numberAttribute(adaptationSet, "height");
        const protection = mergeContentProtection(adaptationProtection, contentProtectionFrom(representation));
        const segmentAddressing = template.media || template.initialization
          ? "template"
          : firstChild(representation, "SegmentList") || firstChild(adaptationSet, "SegmentList")
            ? "list"
            : firstChild(representation, "SegmentBase") || firstChild(adaptationSet, "SegmentBase")
              ? "base"
              : "unknown";
        const common = {
          id,
          periodIndex,
          adaptationSetIndex,
          contentType: contentType(representation.attributes.contentType ?? adaptationSet.attributes.contentType, representation.attributes.mimeType ?? adaptationSet.attributes.mimeType, representation.attributes.codecs ?? adaptationSet.attributes.codecs) || inheritedType,
          ...(representation.attributes.mimeType ?? adaptationSet.attributes.mimeType ? { mimeType: representation.attributes.mimeType ?? adaptationSet.attributes.mimeType } : {}),
          ...(representation.attributes.codecs ?? adaptationSet.attributes.codecs ? { codecs: representation.attributes.codecs ?? adaptationSet.attributes.codecs } : {}),
          ...(bandwidth === undefined ? {} : { bandwidth }),
          ...(width === undefined ? {} : { width }),
          ...(height === undefined ? {} : { height }),
          ...(representation.attributes.frameRate ?? adaptationSet.attributes.frameRate ? { frameRate: representation.attributes.frameRate ?? adaptationSet.attributes.frameRate } : {}),
          ...(representation.attributes.sar ?? adaptationSet.attributes.sar ? { sar: representation.attributes.sar ?? adaptationSet.attributes.sar } : {}),
          baseUrl: representationBase,
          timescale,
          presentationTimeOffset: pto,
          ...(template.initialization ? { initializationUrl: resolveBase(representationBase, substitute(template.initialization, id, bandwidth, 0n, template.startNumber ?? 1)) } : {}),
          ...(template.indexRange ? { initializationRange: template.indexRange } : {}),
          ...(mediaTemplate ? { mediaTemplate } : {}),
          segmentAddressing,
          ...(segmentAlignment === undefined ? {} : { segmentAlignment }),
          ...(subsegmentAlignment === undefined ? {} : { subsegmentAlignment }),
          ...(startWithSap === undefined ? {} : { startWithSap }),
          ...(subsegmentStartsWithSap === undefined ? {} : { subsegmentStartsWithSap }),
          ...(bitstreamSwitching === undefined ? {} : { bitstreamSwitching }),
          contentProtection: protection,
        } satisfies Omit<DashRepresentation, "segments">;
        const segments = buildSegments({ template, ...(durationSeconds === undefined ? {} : { periodDurationSeconds: durationSeconds }), periodStartSeconds: startSeconds, baseUrl: representationBase, id, ...(bandwidth === undefined ? {} : { bandwidth }) });
        if (segments.length === 0 && type === "static") {
          limitations.push(`Representation ${id} has no expandable SegmentTemplate timeline or duration.`);
        }
        representations.push({ ...common, segments });
      });
      const effectiveTimescale = adaptationTemplate.timescale ?? 1;
      const effectivePto = adaptationTemplate.presentationTimeOffset ?? 0n;
      const codecs = adaptationSet.attributes.codecs;
      adaptationSets.push({
        periodIndex,
        index: adaptationSetIndex,
        ...(adaptationSet.attributes.id ? { id: adaptationSet.attributes.id } : {}),
        contentType: inheritedType,
        ...(adaptationSet.attributes.mimeType ? { mimeType: adaptationSet.attributes.mimeType } : {}),
        ...(codecs ? { codecs } : {}),
        ...optionalNumber(adaptationSet, "width", "width"),
        ...optionalNumber(adaptationSet, "maxWidth", "maxWidth"),
        ...optionalNumber(adaptationSet, "height", "height"),
        ...optionalNumber(adaptationSet, "maxHeight", "maxHeight"),
        ...(adaptationSet.attributes.frameRate ? { frameRate: adaptationSet.attributes.frameRate } : {}),
        ...(adaptationSet.attributes.maxFrameRate ? { maxFrameRate: adaptationSet.attributes.maxFrameRate } : {}),
        ...(adaptationSet.attributes.sar ? { sar: adaptationSet.attributes.sar } : {}),
        ...(adaptationSet.attributes.par ? { par: adaptationSet.attributes.par } : {}),
        ...(segmentAlignment === undefined ? {} : { segmentAlignment }),
        ...(subsegmentAlignment === undefined ? {} : { subsegmentAlignment }),
        ...(startWithSap === undefined ? {} : { startWithSap }),
        ...(subsegmentStartsWithSap === undefined ? {} : { subsegmentStartsWithSap }),
        ...(bitstreamSwitching === undefined ? {} : { bitstreamSwitching }),
        ...(adaptationTemplate.initialization ? { initialization: adaptationTemplate.initialization } : {}),
        timescale: effectiveTimescale,
        ...(adaptationTemplate.duration === undefined ? {} : { duration: String(adaptationTemplate.duration) }),
        presentationTimeOffset: String(effectivePto),
        segmentTimeline: (adaptationTemplate.timeline ?? []).map((entry) => ({
          ...(entry.time === undefined ? {} : { time: String(entry.time) }),
          duration: String(entry.duration),
          repeat: entry.repeat,
        })),
        contentProtection: adaptationProtection,
        representationIds,
        switchingContract: buildSwitchingContract({
          profiles,
          ...(bitstreamSwitching === undefined ? {} : { bitstreamSwitching }),
          ...(segmentAlignment === undefined ? {} : { segmentAlignment }),
          ...(subsegmentAlignment === undefined ? {} : { subsegmentAlignment }),
          ...(startWithSap === undefined ? {} : { startWithSap }),
          ...(subsegmentStartsWithSap === undefined ? {} : { subsegmentStartsWithSap }),
          timescale: effectiveTimescale,
          presentationTimeOffset: effectivePto,
          ...(codecs ? { codecs } : {}),
          representationIds,
        }),
      });
    });
  });
  return { type, profiles, ...(mpdDuration === undefined ? {} : { mediaPresentationDurationSeconds: mpdDuration }), periods, adaptationSets, representations, limitations };
}

function buildSegments(input: { template: SegmentTemplate; periodDurationSeconds?: number; periodStartSeconds: number; baseUrl: string; id: string; bandwidth?: number }): DashSegmentReference[] {
  const { template } = input;
  if (!template.media) return [];
  const timescale = template.timescale ?? 1;
  const startNumber = template.startNumber ?? 1;
  const values: Array<{ time: bigint; duration: bigint }> = [];
  if (template.timeline) {
    let cursor = 0n;
    for (const [timelineIndex, entry] of template.timeline.entries()) {
      const start = entry.time ?? cursor;
      const next = template.timeline[timelineIndex + 1]?.time;
      const periodEnd = input.periodDurationSeconds === undefined ? undefined : start + BigInt(Math.round(input.periodDurationSeconds * timescale));
      const repeatedUntil = entry.repeat < 0 ? next ?? periodEnd : undefined;
      const count = Math.min(entry.repeat < 0 && repeatedUntil !== undefined
        ? Math.max(1, Number((repeatedUntil - start) / entry.duration))
        : Math.max(0, entry.repeat) + 1, 100_000);
      for (let index = 0; index < count; index += 1) values.push({ time: start + BigInt(index) * entry.duration, duration: entry.duration });
      cursor = start + BigInt(count) * entry.duration;
    }
  } else if (template.duration && input.periodDurationSeconds !== undefined) {
    const count = Math.min(100_000, Math.ceil((input.periodDurationSeconds * timescale) / Number(template.duration)));
    for (let index = 0; index < count; index += 1) values.push({ time: BigInt(index) * template.duration, duration: template.duration });
  }
  return values.map((entry, index) => {
    const presentationStartSeconds = input.periodStartSeconds + Number(entry.time - (template.presentationTimeOffset ?? 0n)) / timescale;
    const presentationEndSeconds = presentationStartSeconds + Number(entry.duration) / timescale;
    return {
      number: startNumber + index,
      time: entry.time,
      duration: entry.duration,
      presentationStartSeconds,
      presentationEndSeconds,
      url: resolveBase(input.baseUrl, substitute(template.media!, input.id, input.bandwidth, entry.time, startNumber + index)),
    };
  });
}

function templateFrom(node: XmlNode): SegmentTemplate | undefined {
  const template = firstChild(node, "SegmentTemplate");
  if (!template) return undefined;
  const timeline = firstChild(template, "SegmentTimeline");
  const timescale = numberAttribute(template, "timescale");
  const presentationTimeOffset = bigintAttribute(template, "presentationTimeOffset");
  const duration = bigintAttribute(template, "duration");
  const startNumber = numberAttribute(template, "startNumber");
  const indexRange = parseRange(template.attributes.indexRange);
  return {
    ...(timescale === undefined ? {} : { timescale }),
    ...(presentationTimeOffset === undefined ? {} : { presentationTimeOffset }),
    ...(duration === undefined ? {} : { duration }),
    ...(startNumber === undefined ? {} : { startNumber }),
    ...(template.attributes.media ? { media: template.attributes.media } : {}),
    ...(template.attributes.initialization ? { initialization: template.attributes.initialization } : {}),
    ...(indexRange ? { indexRange } : {}),
    ...(timeline ? { timeline: children(timeline, "S").flatMap((entry) => {
      const duration = bigintAttribute(entry, "d");
      const time = bigintAttribute(entry, "t");
      if (duration === undefined) return [];
      return [{ ...(time === undefined ? {} : { time }), duration, repeat: numberAttribute(entry, "r") ?? 0 }];
    }) } : {}),
  };
}

function mergeTemplate(parent?: SegmentTemplate, child?: SegmentTemplate): SegmentTemplate {
  return { ...parent, ...child, ...(child?.timeline === undefined ? {} : { timeline: child.timeline }) };
}

function parseXml(value: string): XmlNode {
  const document: XmlNode = { name: "#document", attributes: {}, children: [], text: "" };
  const stack = [document];
  const tokens = value.replace(/^\uFEFF/, "").match(/<!--[\s\S]*?-->|<\?[^]*?\?>|<!\[[\s\S]*?\]\]>|<[^>]+>|[^<]+/g) ?? [];
  for (const token of tokens) {
    if (token.startsWith("<!--") || token.startsWith("<?") || token.startsWith("<![")) continue;
    if (token.startsWith("</")) { if (stack.length > 1) stack.pop(); continue; }
    if (token.startsWith("<")) {
      const parsed = /^<\s*([^\s/>]+)([\s\S]*?)(\/?)>$/.exec(token);
      if (!parsed) continue;
      const node: XmlNode = { name: parsed[1]!, attributes: parseAttributes(parsed[2]!), children: [], text: "" };
      stack.at(-1)!.children.push(node);
      if (parsed[3] !== "/") stack.push(node);
    } else stack.at(-1)!.text += decodeXml(token);
  }
  const root = document.children[0];
  if (!root) throw new StreamCollectionError("UNSUPPORTED_MANIFEST", "The DASH document is empty", false);
  return root;
}

function parseAttributes(value: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  for (const match of value.matchAll(/([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) attributes[localName(match[1]!)] = decodeXml(match[2] ?? match[3] ?? "");
  return attributes;
}
function localName(value: string): string { return value.split(":").at(-1) ?? value; }
function children(node: XmlNode, name: string): XmlNode[] { return node.children.filter((child) => localName(child.name) === name); }
function firstChild(node: XmlNode, name: string): XmlNode | undefined { return children(node, name)[0]; }
function childText(node: XmlNode, name: string): string | undefined { const child = firstChild(node, name); return child?.text.trim() || undefined; }
function numberAttribute(node: XmlNode, name: string): number | undefined { const value = Number(node.attributes[name]); return Number.isFinite(value) ? value : undefined; }
function bigintAttribute(node: XmlNode, name: string): bigint | undefined { try { return node.attributes[name] === undefined ? undefined : BigInt(node.attributes[name]); } catch { return undefined; } }
function booleanAttribute(node: XmlNode, name: string): boolean | undefined { const value = node.attributes[name]; return value === "true" ? true : value === "false" ? false : undefined; }
function optionalNumber<K extends string>(node: XmlNode, attribute: string, key: K): Partial<Record<K, number>> { const value = numberAttribute(node, attribute); return value === undefined ? {} : { [key]: value } as Partial<Record<K, number>>; }
function contentProtectionFrom(node: XmlNode): DashContentProtection[] {
  return children(node, "ContentProtection").map((protection) => ({
    ...(protection.attributes.schemeIdUri ? { schemeIdUri: protection.attributes.schemeIdUri } : {}),
    ...(protection.attributes.value ? { value: protection.attributes.value } : {}),
    ...(protection.attributes.default_KID ? { defaultKid: protection.attributes.default_KID } : {}),
    pssh: children(protection, "pssh").map((entry) => entry.text.trim()).filter(Boolean),
  }));
}
function mergeContentProtection(left: DashContentProtection[], right: DashContentProtection[]): DashContentProtection[] {
  const keyed = new Map<string, DashContentProtection>();
  for (const entry of [...left, ...right]) keyed.set(`${entry.schemeIdUri ?? ""}|${entry.value ?? ""}|${entry.defaultKid ?? ""}`, entry);
  return [...keyed.values()];
}
function buildSwitchingContract(input: {
  profiles: string[];
  bitstreamSwitching?: boolean;
  segmentAlignment?: boolean;
  subsegmentAlignment?: boolean;
  startWithSap?: number;
  subsegmentStartsWithSap?: number;
  timescale: number;
  presentationTimeOffset: bigint;
  codecs?: string;
  representationIds: string[];
}): SwitchingContract {
  const sampleEntryExpectation = /(?:^|,)(hvc1|hev1)(?:\.|,|$)/i.exec(input.codecs ?? "")?.[1]?.toLowerCase();
  const codecFamily = /^(?:hvc1|hev1)/i.test(input.codecs ?? "") ? "HEVC" : (input.codecs?.split(/[.,]/)[0]?.toUpperCase() ?? "UNKNOWN");
  const mode: SwitchingContract["mode"] = input.profiles.some((profile) => /cmaf/i.test(profile))
    ? "CMAF_SWITCHING_SET"
    : input.bitstreamSwitching === true
      ? "BITSTREAM_SWITCHING"
      : input.bitstreamSwitching === false || sampleEntryExpectation === "hvc1"
        ? "GENERAL_REINITIALIZATION"
        : "UNKNOWN";
  return {
    mode,
    ...(input.bitstreamSwitching === undefined ? {} : { bitstreamSwitching: input.bitstreamSwitching }),
    ...(input.segmentAlignment === undefined ? {} : { segmentAlignment: input.segmentAlignment }),
    ...(input.subsegmentAlignment === undefined ? {} : { subsegmentAlignment: input.subsegmentAlignment }),
    ...(input.startWithSap === undefined ? {} : { startWithSap: input.startWithSap }),
    ...(input.subsegmentStartsWithSap === undefined ? {} : { subsegmentStartsWithSap: input.subsegmentStartsWithSap }),
    effectiveTimescale: input.timescale,
    presentationTimeOffset: String(input.presentationTimeOffset),
    codecFamily,
    ...(sampleEntryExpectation ? { sampleEntryExpectation } : {}),
    representations: input.representationIds,
  };
}
function parseRange(value: string | undefined): { start: number; end?: number } | undefined { if (!value) return undefined; const parsed = value.split("-").map(Number); const start = parsed[0]; const end = parsed[1]; return start !== undefined && Number.isFinite(start) ? { start, ...(end !== undefined && Number.isFinite(end) ? { end } : {}) } : undefined; }
function parseDuration(value: string | undefined): number | undefined { if (!value) return undefined; const match = /^P(?:([\d.]+)D)?(?:T(?:([\d.]+)H)?(?:([\d.]+)M)?(?:([\d.]+)S)?)?$/.exec(value); if (!match) return undefined; return Number(match[1] ?? 0) * 86400 + Number(match[2] ?? 0) * 3600 + Number(match[3] ?? 0) * 60 + Number(match[4] ?? 0); }
function resolveBase(base: string, next: string | undefined): string { return next ? new URL(next, base).toString() : base; }
function substitute(template: string, id: string, bandwidth: number | undefined, time: bigint, number: number): string { return template.replace(/\$\$(?!\$)|\$(RepresentationID|Bandwidth|Time|Number)(%0(\d+)d)?\$/g, (match, key: string, _format: string | undefined, width: string | undefined) => { if (match === "$$") return "$"; const raw = key === "RepresentationID" ? id : key === "Bandwidth" ? String(bandwidth ?? "") : key === "Time" ? String(time) : String(number); return width ? raw.padStart(Number(width), "0") : raw; }); }
function contentType(value: string | undefined, mimeType: string | undefined, codecs: string | undefined): "video" | "audio" | "unknown" { if (value === "video" || value === "audio") return value; if (mimeType?.startsWith("video/")) return "video"; if (mimeType?.startsWith("audio/")) return "audio"; if (/^(?:hvc|hev|avc|vp0|av01)/i.test(codecs ?? "")) return "video"; if (/^(?:mp4a|ac-3|ec-3|opus)/i.test(codecs ?? "")) return "audio"; return "unknown"; }
function decodeXml(value: string): string { return value.replace(/&(?:amp|lt|gt|quot|apos);/g, (entity) => ({ "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": "\"", "&apos;": "'" })[entity]!); }
