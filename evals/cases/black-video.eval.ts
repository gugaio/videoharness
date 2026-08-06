import { generateSyntheticHls } from "../core/hls.js";
import type { EvalCase } from "../core/types.js";

export const blackVideo: EvalCase = {
  id: "black-video",
  title: "Imagem preta com audio continuo",
  problemDescription: "A imagem fica preta por aproximadamente dois segundos, mas o audio continua normalmente.",
  detector: "blackdetect",
  expectedInterval: {
    startSeconds: { min: 2.8, max: 3.2 },
    durationSeconds: { min: 1.8, max: 2.2 },
  },
  generate: (context) => generateSyntheticHls(
    context,
    "[0:v]drawbox=x=0:y=0:w=iw:h=ih:color=black:t=fill:enable='between(t,3,5)'[v];[1:a]anull[a]",
  ),
};
