export type Detector = "freezedetect" | "blackdetect" | "silencedetect";

export type IntervalExpectation = {
  startSeconds: { min: number; max: number };
  durationSeconds: { min: number; max: number };
};

export type EvalCase = {
  id: string;
  title: string;
  problemDescription: string;
  detector: Detector;
  expectedInterval?: IntervalExpectation;
  generate: (context: EvalGenerationContext) => Promise<void>;
};

export type EvalGenerationContext = {
  directory: string;
  playlistPath: string;
  segmentPattern: string;
  ffmpeg: (args: string[]) => Promise<void>;
};

export type DetectorInterval = {
  startSeconds: number;
  durationSeconds: number;
  endSeconds: number;
};

export type FixtureEvaluation = {
  id: string;
  directory: string;
  detector: Detector;
  intervals: DetectorInterval[];
  retained: boolean;
};
