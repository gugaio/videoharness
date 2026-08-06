import { generateSyntheticHls } from "../core/hls.js";
import type { EvalCase } from "../core/types.js";

export const audioSilence: EvalCase = {
  id: "audio-silence",
  title: "Silencio de audio com video continuo",
  problemDescription: "O video continua, mas o audio some por aproximadamente dois segundos.",
  detector: "silencedetect",
  expectedInterval: {
    startSeconds: { min: 2.8, max: 3.2 },
    durationSeconds: { min: 1.8, max: 2.2 },
  },
  generate: (context) => generateSyntheticHls(
    context,
    "[0:v]null[v];[1:a]volume=enable='between(t,3,5)':volume=0[a]",
  ),
};
