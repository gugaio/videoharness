import { spawn } from "node:child_process";
import { z } from "zod";
import type { ConformanceSummary } from "../domain/evidence.js";

const ValidatorOutputSchema = z.object({
  validator: z.string().default("DASH-IF Conformance Validator"),
  findings: z.array(z.object({ code: z.string().default("DASH_IF"), severity: z.enum(["info", "warning", "error"]), scope: z.string().optional(), message: z.string() })).default([]),
});

export type DashIfFindingEvidence = { evidenceId: string; code: string; severity: "info" | "warning" | "error"; scope?: string; message: string; relatedEvidenceIds: string[] };

/** Optional CLI adapter. The configured wrapper must emit the normalized JSON contract on stdout. */
export class DashIfConformanceValidator {
  constructor(private readonly options: { binary: string; argumentsFor: (mpdPath: string) => string[]; timeoutMs?: number; maxOutputBytes?: number }) {}

  async validate(input: { switchId: string; mpdPath: string; evidenceByScope: Map<string, string> }): Promise<{ summary: ConformanceSummary; findings: DashIfFindingEvidence[] }> {
    const raw = await run(this.options.binary, this.options.argumentsFor(input.mpdPath), this.options.timeoutMs ?? 180_000, this.options.maxOutputBytes ?? 8_388_608);
    return mapDashIfConformanceOutput(input.switchId, JSON.parse(raw), input.evidenceByScope);
  }
}

export function mapDashIfConformanceOutput(switchId: string, raw: unknown, evidenceByScope: Map<string, string>): { summary: ConformanceSummary; findings: DashIfFindingEvidence[] } {
  const parsed = ValidatorOutputSchema.parse(raw);
  const findings = parsed.findings.map((finding, index) => ({ evidenceId: `dash-if:${switchId}:${index + 1}`, code: finding.code, severity: finding.severity, ...(finding.scope ? { scope: finding.scope } : {}), message: finding.message, relatedEvidenceIds: finding.scope ? matchScope(finding.scope, evidenceByScope) : [] }));
  return { summary: { evidenceId: `dash-if:${switchId}:summary`, status: findings.some((finding) => finding.severity === "error") ? "FAIL" : "PASS", validator: parsed.validator, findingEvidenceIds: findings.map((finding) => finding.evidenceId) }, findings };
}

function matchScope(scope: string, evidenceByScope: Map<string, string>): string[] { const exact = evidenceByScope.get(scope); if (exact) return [exact]; return [...evidenceByScope].filter(([candidate]) => scope.includes(candidate) || candidate.includes(scope)).map(([, evidenceId]) => evidenceId); }
function run(binary: string, args: string[], timeoutMs: number, maxOutputBytes: number): Promise<string> { return new Promise((resolve, reject) => { const child = spawn(binary, args, { stdio: ["ignore", "pipe", "pipe"] }); let stdout = ""; let stderr = ""; let settled = false; const timer = setTimeout(() => { child.kill("SIGKILL"); finish(() => reject(new Error("DASH-IF conformance validation timed out"))); }, timeoutMs); const finish = (callback: () => void): void => { if (settled) return; settled = true; clearTimeout(timer); callback(); }; child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString("utf8"); if (Buffer.byteLength(stdout) > maxOutputBytes) { child.kill("SIGKILL"); finish(() => reject(new Error("DASH-IF validator output exceeded the limit"))); } }); child.stderr.on("data", (chunk: Buffer) => { stderr = (stderr + chunk.toString("utf8")).slice(0, 2_000); }); child.once("error", () => finish(() => reject(new Error("DASH-IF conformance validator is unavailable")))); child.once("close", (code) => code === 0 ? finish(() => resolve(stdout)) : finish(() => reject(new Error(`DASH-IF conformance validation failed${stderr.trim() ? `: ${stderr.trim()}` : ""}`)))); }); }
