/** Extracts only explicit, user-reported clues. Nothing here is media evidence. */
export type ReportedContext = {
  approximateTimeSeconds?: number;
  reportsVideoFreeze: boolean;
  reportsAudioContinues: boolean;
  reportsAbrSwitch: boolean;
  reportedAbrDirection?: "UPSHIFT" | "DOWNSHIFT";
  reportedResolutionTransition?: { sourceHeight: number; targetHeight: number };
  reportedDevice?: {
    manufacturer?: string;
    modelCode?: string;
    firmwareVersion?: string;
    operatingSystem?: string;
    operatingSystemVersion?: string;
    applicationVersion?: string;
    playerName?: string;
    playerVersion?: string;
    drmSystem?: string;
    displayOrHdrMode?: string;
  };
  mentionedPlayerEvents: string[];
  descriptionExcerpt?: string;
  uncertainties: string[];
};

export function parseReportedContext(description: string | undefined): ReportedContext {
  const text = description ?? "";
  const approximateTimeSeconds = parseClock(text);
  const reportsVideoFreeze = /(?:video|imagem).{0,30}(?:congel|trav)|(?:congel|trav).{0,30}(?:video|imagem)/iu.test(text);
  const reportsAudioContinues = /(?:audio|áudio|som).{0,40}(?:continua|continuou|segue|seguiu)/iu.test(text);
  const reportsAbrSwitch = /(?:abr|troca de representa|mudan[çc]a de qualid|switch)/iu.test(text);
  const reportedResolutionTransition = parseResolutionTransition(text);
  const reportedAbrDirection = reportedResolutionTransition
    ? reportedResolutionTransition.targetHeight > reportedResolutionTransition.sourceHeight ? "UPSHIFT" : reportedResolutionTransition.targetHeight < reportedResolutionTransition.sourceHeight ? "DOWNSHIFT" : undefined
    : /(?:downshift|redu[çc][aã]o|queda).{0,30}(?:qualidade|bitrate|representa)/iu.test(text) ? "DOWNSHIFT"
      : /(?:upshift|aumento|subida).{0,30}(?:qualidade|bitrate|representa)/iu.test(text) ? "UPSHIFT" : undefined;
  const reportedDevice = parseReportedDevice(text);
  const mentionedPlayerEvents = PLAYER_EVENT_NAMES.filter((event) => new RegExp(`\\b${escapeRegExp(event)}\\b`, "iu").test(text));
  const uncertainties: string[] = [];
  if (approximateTimeSeconds === undefined) uncertainties.push("The user report has no machine-readable incident time; representative media windows were sampled instead of a precise boundary.");
  if (!reportsAbrSwitch) uncertainties.push("The user report does not explicitly confirm an ABR switch; any quality boundary is a candidate, not a recorded player action.");
  return {
    ...(approximateTimeSeconds === undefined ? {} : { approximateTimeSeconds }),
    reportsVideoFreeze,
    reportsAudioContinues,
    reportsAbrSwitch,
    ...(reportedAbrDirection ? { reportedAbrDirection } : {}),
    ...(reportedResolutionTransition ? { reportedResolutionTransition } : {}),
    ...(reportedDevice ? { reportedDevice } : {}),
    mentionedPlayerEvents,
    ...(text.trim() ? { descriptionExcerpt: boundedRelevantExcerpt(text) } : {}),
    uncertainties,
  };
}

const PLAYER_EVENT_NAMES = [
  "PLAYER_MSG_BITRATE_CHANGE", "PLAYER_MSG_RESOLUTION_CHANGED", "PLAYER_MSG_HTTP_ERROR_CODE",
  "onbufferingstart", "onbufferingprogress", "onbufferingcomplete", "oncurrentplaytime", "onevent", "onerror", "onerrormsg", "ondrmevent",
  "LEVEL_SWITCHING", "LEVEL_SWITCHED", "FRAG_CHANGED", "variantchanged", "adaptation",
] as const;

function parseReportedDevice(text: string): ReportedContext["reportedDevice"] {
  const modelCode = capture(text, /(?:model(?:o|\s*code)?|device|tv)\s*[:=]\s*([A-Z0-9][A-Z0-9._-]{2,31})/iu)
    ?? capture(text, /\bSamsung\s+([A-Z]{2,}[A-Z0-9._-]*\d[A-Z0-9._-]*)\b/iu);
  const manufacturer = /\bSamsung\b/iu.test(text) ? "Samsung" : /\bLG\b/iu.test(text) ? "LG" : /\bRoku\b/iu.test(text) ? "Roku" : /\bApple\s*TV\b/iu.test(text) ? "Apple" : undefined;
  const firmwareVersion = capture(text, /(?:firmware|fw)\s*(?:version|vers[aã]o)?\s*[:=]\s*([A-Z0-9][A-Z0-9._-]{0,31})/iu);
  const operatingSystem = /\bTizen\b/iu.test(text) ? "Tizen" : /\bwebOS\b/iu.test(text) ? "webOS" : /\bAndroid(?:\s+TV)?\b/iu.test(text) ? "Android TV" : /\btvOS\b/iu.test(text) ? "tvOS" : /\bRoku\s*OS\b/iu.test(text) ? "Roku OS" : undefined;
  const operatingSystemVersion = capture(text, /(?:tizen|webos|android(?:\s+tv)?|tvos|roku\s*os)\s*(?:version|vers[aã]o)?\s*[:=]?\s*(\d+(?:\.\d+){0,2})/iu);
  const applicationVersion = capture(text, /(?:application|app)\s*(?:version|vers[aã]o)\s*[:=]\s*([A-Z0-9][A-Z0-9._-]{0,31})/iu);
  const playerName = /\bAVPlay\b/iu.test(text) ? "AVPlay" : /\bhls\.js\b/iu.test(text) ? "hls.js" : /\bShaka(?:\s+Player)?\b/iu.test(text) ? "Shaka Player" : /\bExoPlayer\b/iu.test(text) ? "ExoPlayer" : undefined;
  const playerVersion = capture(text, /(?:avplay|hls\.js|shaka(?:\s+player)?|exoplayer)\s*(?:version|vers[aã]o)?\s*[:=]\s*([A-Z0-9][A-Z0-9._-]{0,31})/iu);
  const drmSystem = capture(text, /\bdrm\s*[:=]\s*([A-Z0-9][A-Z0-9._+-]{1,31})/iu);
  const displayOrHdrMode = capture(text, /\b(?:display|hdr)\s*(?:mode|modo)?\s*[:=]\s*([A-Z0-9][A-Z0-9+._-]{1,31})/iu);
  return manufacturer || modelCode || firmwareVersion || operatingSystem || operatingSystemVersion || applicationVersion || playerName || playerVersion || drmSystem || displayOrHdrMode
    ? { ...(manufacturer ? { manufacturer } : {}), ...(modelCode ? { modelCode } : {}), ...(firmwareVersion ? { firmwareVersion } : {}), ...(operatingSystem ? { operatingSystem } : {}), ...(operatingSystemVersion ? { operatingSystemVersion } : {}), ...(applicationVersion ? { applicationVersion } : {}), ...(playerName ? { playerName } : {}), ...(playerVersion ? { playerVersion } : {}), ...(drmSystem ? { drmSystem } : {}), ...(displayOrHdrMode ? { displayOrHdrMode } : {}) }
    : undefined;
}

function parseResolutionTransition(text: string): { sourceHeight: number; targetHeight: number } | undefined {
  const match = /\b(4k|uhd|full\s*hd|fhd|\d{3,4}p)\b.{0,80}?(?:to|para|->|→)\s*\b(4k|uhd|full\s*hd|fhd|\d{3,4}p)\b/iu.exec(text);
  if (!match) return undefined;
  const sourceHeight = resolutionHeight(match[1]!);
  const targetHeight = resolutionHeight(match[2]!);
  return Number.isFinite(sourceHeight) && Number.isFinite(targetHeight) ? { sourceHeight, targetHeight } : undefined;
}

function resolutionHeight(value: string): number { const normalized = value.replace(/\s+/g, "").toLowerCase(); return normalized === "4k" || normalized === "uhd" ? 2160 : normalized === "fullhd" || normalized === "fhd" ? 1080 : Number(normalized.replace(/p$/, "")); }
function capture(text: string, pattern: RegExp): string | undefined { return pattern.exec(text)?.[1]; }
function escapeRegExp(value: string): string { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function boundedRelevantExcerpt(text: string): string { const trimmed = text.trim(); if (trimmed.length <= 4_000) return trimmed; const relevant = trimmed.split(/\r?\n/).filter((line) => /(?:abr|switch|quality|qualidade|bitrate|player|buffer|error|firmware|device|model|\d{3,4}p|freeze|stall|congel|trav|audio|áudio)/iu.test(line)).join("\n").trim(); return (relevant || trimmed).slice(0, 4_000); }

function parseClock(text: string): number | undefined {
  const match = [...text.matchAll(/(?:\b(?:at|em|por volta de|around)\s*)?(\d{1,2}):(\d{2})(?::(\d{2}))?\b/giu)][0];
  if (!match) return undefined;
  const first = Number(match[1]);
  const second = Number(match[2]);
  const third = match[3] === undefined ? undefined : Number(match[3]);
  return third === undefined ? first * 60 + second : first * 3600 + second * 60 + third;
}
