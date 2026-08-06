/** Extracts only explicit, user-reported clues. Nothing here is media evidence. */
export type ReportedContext = {
  approximateTimeSeconds?: number;
  reportsVideoFreeze: boolean;
  reportsAudioContinues: boolean;
  reportsAbrSwitch: boolean;
  reportsFourKToFullHd: boolean;
  uncertainties: string[];
};

export function parseReportedContext(description: string | undefined): ReportedContext {
  const text = description ?? "";
  const approximateTimeSeconds = parseClock(text);
  const reportsVideoFreeze = /(?:video|imagem).{0,30}(?:congel|trav)|(?:congel|trav).{0,30}(?:video|imagem)/iu.test(text);
  const reportsAudioContinues = /(?:audio|áudio|som).{0,40}(?:continua|continuou|segue|seguiu)/iu.test(text);
  const reportsAbrSwitch = /(?:abr|troca de representa|mudan[çc]a de qualid|switch)/iu.test(text);
  const reportsFourKToFullHd = /(?:4k|2160p|uhd).{0,80}(?:full\s*hd|1080p)|(?:full\s*hd|1080p).{0,80}(?:4k|2160p|uhd)/iu.test(text);
  const uncertainties: string[] = [];
  if (approximateTimeSeconds === undefined) uncertainties.push("The user report has no machine-readable incident time; representative DASH windows were sampled instead of a precise boundary.");
  if (!reportsAbrSwitch) uncertainties.push("The user report does not explicitly confirm an ABR switch; any representation boundary is a candidate, not a recorded player action.");
  return { ...(approximateTimeSeconds === undefined ? {} : { approximateTimeSeconds }), reportsVideoFreeze, reportsAudioContinues, reportsAbrSwitch, reportsFourKToFullHd, uncertainties };
}

function parseClock(text: string): number | undefined {
  const matches = [...text.matchAll(/(?:\b(?:at|em|por volta de|around)\s*)?(\d{1,2}):(\d{2})(?::(\d{2}))?\b/giu)];
  const match = matches[0];
  if (!match) return undefined;
  const first = Number(match[1]);
  const second = Number(match[2]);
  const third = match[3] === undefined ? undefined : Number(match[3]);
  if (third === undefined) return first * 60 + second;
  return first * 3600 + second * 60 + third;
}
