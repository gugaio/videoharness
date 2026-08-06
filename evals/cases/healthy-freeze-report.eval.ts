import { generateSyntheticHls } from "../core/hls.js";
import type { EvalCase } from "../core/types.js";

export const healthyFreezeReport: EvalCase = {
  id: "healthy-freeze-report",
  title: "Controle saudavel com relato de freeze",
  problemDescription: "A imagem parece congelar apos 3 segundos, mas precisamos confirmar o relato.",
  detector: "freezedetect",
  generate: (context) => generateSyntheticHls(context, "[0:v]null[v];[1:a]anull[a]"),
};
