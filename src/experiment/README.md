# Experiment

Closed-loop diagnostic layer over the repository's existing Investigation and
Record modules.

- `domain/` owns Experiment state, hypotheses, iterations, CloneSpec v1,
  TestRequest/TestResult and qualitative evaluation records.
- `application/` validates/compiles CloneSpecs, assembles deterministic evidence
  and evaluates outcomes.
- `adapters/` persists the aggregate and observes the existing recording worker.
- `ports/` contains only the PostgreSQL/storage boundaries actually crossed.

An experimental clone references a normal `Recording`; this module does not
duplicate network fetching, storage, job leasing, or media delivery. The current
compiler supports bounded VOD snapshots and manifest-level selection. Unsupported
media transformations fail explicitly and no API accepts shell commands.

The device URL is stable per Experiment. Selecting a TestRequest changes the
published recording resolved by `/streams/experiments/:experimentId/*`; paths
remain local registered resources and never trigger an origin fetch.
