import { describe, expect, it } from "vitest";
import type { CloneSpec } from "./clone-spec.js";
import { assertExperimentTransition, defaultExperimentPolicy, validateIterationBudget } from "./experiment.js";

const investigationId = "c56a4180-65aa-42ec-a945-5fd21dec0538";
const control = spec("control");
const treatment = spec("treatment");

describe("experiment domain", () => {
  it("allows only explicit lifecycle transitions", () => {
    expect(() => assertExperimentTransition("DRAFT", "PLANNED")).not.toThrow();
    expect(() => assertExperimentTransition("DRAFT", "CONCLUDED")).toThrow(/cannot transition/);
    expect(() => assertExperimentTransition("CONCLUDED", "PLANNED")).toThrow(/cannot transition/);
  });

  it("requires one control in the first iteration", () => {
    expect(() => validateIterationBudget({ iterationNumber: 1, existingCloneCount: 0, specs: [treatment], policy: defaultExperimentPolicy })).toThrow("EXPERIMENT_CONTROL_REQUIRED");
    expect(() => validateIterationBudget({ iterationNumber: 1, existingCloneCount: 0, specs: [control, treatment], policy: defaultExperimentPolicy })).not.toThrow();
  });

  it("enforces configurable iteration and clone budgets", () => {
    expect(() => validateIterationBudget({ iterationNumber: 1, existingCloneCount: 0, specs: [control, treatment, treatment, treatment, treatment], policy: defaultExperimentPolicy })).toThrow("EXPERIMENT_CLONE_LIMIT");
    expect(() => validateIterationBudget({ iterationNumber: 4, existingCloneCount: 4, specs: [treatment], policy: defaultExperimentPolicy })).toThrow("EXPERIMENT_ITERATION_LIMIT");
    expect(() => validateIterationBudget({ iterationNumber: 3, existingCloneCount: 12, specs: [treatment], policy: defaultExperimentPolicy })).toThrow("EXPERIMENT_TOTAL_CLONE_LIMIT");
  });
});

function spec(role: "control" | "treatment"): CloneSpec {
  return {
    version: "1", source: { investigationId, mode: "recorded_snapshot" }, mode: "manifest_only",
    reason: { role, shortLabel: role === "control" ? "CONTROL" : "LOW", hypothesisIds: role === "control" ? [] : ["8dc67e09-4b25-4fe5-a69a-58f896fb5197"], description: "Test.", expectedDiscriminatingSignal: "Differs." },
  };
}
