import { generateSyntheticHls } from "../core/hls.js";
import type { EvalCase } from "../core/types.js";

export const freezeRepeatedFrames: EvalCase = {
  id: "freeze-repeated-frames",
  title: "Frames repetidos com audio continuo",
  problemDescription: "A imagem congela apos 3 segundos, mostra frames repetidos e o audio continua normalmente.",
  detector: "freezedetect",
  expectedInterval: {
    startSeconds: { min: 2.8, max: 3.2 },
    durationSeconds: { min: 1.8, max: 2.2 },
  },
  generate: (context) => generateSyntheticHls(
    context,
    "[0:v]split=2[main][replacement];[main][replacement]freezeframes=first=90:last=149:replace=89[v];[1:a]anull[a]",
  ),
};
