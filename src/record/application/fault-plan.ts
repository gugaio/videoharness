import type { FaultPlan, FaultRule } from "../domain/playback-run.js";

export type PlaybackResource = { kind: string; targetId?: string; mediaSequence?: number };

/** Selects the first matching deterministic rule. Paths and origin URLs are deliberately not selectors. */
export function findFaultRule(plan: FaultPlan | undefined, resource: PlaybackResource): FaultRule | undefined {
  return plan?.rules.find((rule) => rule.when.resourceKind === resource.kind
    && (rule.when.targetId === undefined || rule.when.targetId === resource.targetId)
    && (rule.when.mediaSequence === undefined || rule.when.mediaSequence === resource.mediaSequence));
}

export type AppliedFault = { rule: FaultRule; matchOrdinal: number };

/**
 * Counts matching delivery attempts per active run and rule. The counter is
 * deliberately independent from resource paths, so retries are observable
 * attempts too. It has the same process-local recovery boundary as shaper
 * stages; applied failures themselves remain durable in the request journal.
 */
export class PlaybackFaultInjector {
  private readonly matches = new Map<string, number>();

  select(runId: string, plan: FaultPlan | undefined, resource: PlaybackResource): AppliedFault | undefined {
    const rule = findFaultRule(plan, resource);
    if (!rule) return undefined;
    const key = `${runId}:${rule.id}`;
    const matchOrdinal = (this.matches.get(key) ?? 0) + 1;
    this.matches.set(key, matchOrdinal);
    return matchOrdinal % (rule.everyNthMatch ?? 1) === 0 ? { rule, matchOrdinal } : undefined;
  }
}
