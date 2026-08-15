import type { AbrSeverity, AbrSwitchMatrixEntry, EvidenceRef } from "./evidence.js";
import type { CapabilityProjection } from "../application/project-decoder-capability.js";

export type AbrAssessmentVerdict =
  | "NO_ISSUE_DETECTED"
  | "ISSUES_FOUND"
  | "INCONCLUSIVE"
  | "NOT_APPLICABLE";

export type AbrAssessmentCategory =
  | "LADDER_TOPOLOGY"
  | "LADDER_CONSISTENCY"
  | "TRANSITION_SAFETY"
  | "DELIVERY_BEHAVIOR"
  | "COVERAGE";

export type AbrRepresentation = EvidenceRef & {
  id: string;
  groupId: string;
  bandwidth?: number;
  averageBandwidth?: number;
  width?: number;
  height?: number;
  frameRate?: number;
  codecs?: string;
  audioGroupId?: string;
  segmentCount?: number;
};

export type AbrAssessmentFinding = EvidenceRef & {
  ruleId: string;
  category: AbrAssessmentCategory;
  severity: AbrSeverity;
  title: string;
  explanation: string;
  evidenceIds: string[];
};

export type AbrReportedPriority = {
  abrProblemReported: boolean;
  direction?: "UPSHIFT" | "DOWNSHIFT" | "LATERAL";
  sourceHeight?: number;
  targetHeight?: number;
  approximateTimeSeconds?: number;
};

export type AbrTransitionAssessment = EvidenceRef & {
  transitionId: string;
  protocol: "hls" | "dash";
  evidenceBasis: "URL_STATIC_ANALYSIS" | "PLAYBACK_NETWORK_OBSERVED";
  transitionStatus: "CANDIDATE" | "OBSERVED";
  sourceRepresentation: AbrRepresentation;
  targetRepresentation: AbrRepresentation;
  direction: "UPSHIFT" | "DOWNSHIFT" | "LATERAL";
  switchKind: "SAME_RESOLUTION_BITRATE" | "RESOLUTION_CHANGING" | "UNKNOWN";
  outcome: "PASS" | "FAIL" | "RISK" | "NOT_TESTED";
  findingRuleIds: string[];
};

export type AbrAssessment = EvidenceRef & {
  schemaVersion: 1;
  protocol: "hls" | "dash";
  verdict: AbrAssessmentVerdict;
  reportedPriority: AbrReportedPriority;
  coverage: {
    level: "MANIFEST_ONLY" | "SAMPLED_MEDIA" | "OBSERVED_PLAYBACK";
    manifestObserved: true;
    mediaSampleCount: number;
    representationCount: number;
    transitionPairsAnalyzed: number;
    playbackObserved: boolean;
    limitations: string[];
  };
  ladder: {
    representations: AbrRepresentation[];
    videoRepresentationCount: number;
    audioRenditionCount: number;
  };
  findings: AbrAssessmentFinding[];
  /** Protocol-neutral transition summaries. Detailed protocol evidence lives in its specialization. */
  transitions: AbrTransitionAssessment[];
  transitionMatrix: AbrSwitchMatrixEntry[];
  recommendedMeasurements: string[];
  capability?: CapabilityProjection;
};
