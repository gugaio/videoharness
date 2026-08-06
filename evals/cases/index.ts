import { audioSilence } from "./audio-silence.eval.js";
import { blackVideo } from "./black-video.eval.js";
import { freezeRepeatedFrames } from "./freeze-repeated-frames.eval.js";
import { healthyFreezeReport } from "./healthy-freeze-report.eval.js";

export const evalCases = [freezeRepeatedFrames, healthyFreezeReport, blackVideo, audioSilence] as const;
