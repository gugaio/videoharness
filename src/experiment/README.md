# Experiment

Closed-loop diagnostic layer over the repository's existing Investigation and
Record modules.

- `domain/` owns Experiment state, hypotheses, iterations, CloneSpec v1,
  TestRequest/TestResult and qualitative evaluation records.
- `application/` validates/compiles CloneSpecs, assembles the deterministic
  causal guardrail and runs the recoverable evaluation workflow.
- `adapters/` persists the aggregate, observes the existing recording worker and
  runs the post-experiment AI team through the provider boundary.
- `ports/` contains only the PostgreSQL/storage boundaries actually crossed.

An experimental clone references a normal `Recording`; this module does not
duplicate network fetching, storage, job leasing, or media delivery. The current
compiler supports bounded VOD snapshots and manifest-level selection. Unsupported
media transformations fail explicitly and no API accepts shell commands.
CONTROL preserves the complete selected source ladder under the duration, byte,
resource and 32-representation safety ceilings. `representation_subset` supports
diagnosis-specific groups such as AAC-only without turning every diagnosis into
the same low-bitrate treatment.

The device URL is stable per Experiment. Selecting a TestRequest changes the
published recording resolved by `/streams/experiments/:experimentId/*`; paths
remain local registered resources and never trigger an origin fetch.

After attributed TestResults exist, `experiment-evaluation` runs Evidence
Auditor, Causal Analyst and Lead Experiment Investigator in series. The
deterministic comparison owns observations and causal ceilings; agents explain
the bounded effect, alternatives, limitations and the next discriminating test.
They never turn a treatment correlation into unobserved decode, render, origin
latency or delivery facts.
