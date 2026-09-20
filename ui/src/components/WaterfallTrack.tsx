export interface WaterfallRequest {
  duration_ms: number;
  dns_ms?: number;
  connect_ms?: number;
  tls_ms?: number;
  ttfb_ms?: number;
  relay_ms?: number;
  local_serve_ms?: number;
}

export function waterfallPhases(request: WaterfallRequest): { value?: number; color: string; label: string }[] {
  return [
    { value: request.dns_ms, color: "pb-phase-dns", label: "DNS" },
    { value: request.connect_ms, color: "pb-phase-tcp", label: "TCP" },
    { value: request.tls_ms, color: "pb-phase-tls", label: "TLS" },
    { value: request.ttfb_ms, color: "pb-phase-ttfb", label: "TTFB" },
    {
      value: request.relay_ms ?? request.local_serve_ms,
      color: request.local_serve_ms != null ? "pb-phase-local" : "pb-phase-relay",
      label: request.local_serve_ms != null ? "local" : "relay",
    },
  ];
}

export function WaterfallTrack({
  request,
  maxDuration,
}: {
  request: WaterfallRequest;
  maxDuration: number;
}) {
  const phases = waterfallPhases(request);
  return (
    <span
      className="pb-waterfall-track"
      style={{ width: `${Math.max(8, (request.duration_ms / Math.max(1, maxDuration)) * 100)}%` }}
    >
      {phases.map((phase) =>
        phase.value == null ? null : (
          <span
            key={phase.label}
            title={`${phase.label}: ${phase.value} ms`}
            className={phase.color}
            style={{ width: `${Math.max(2, (phase.value / Math.max(1, request.duration_ms)) * 100)}%` }}
          />
        ),
      )}
      {phases.every((phase) => phase.value == null) && (
        <span
          title={`servido localmente: ${request.duration_ms} ms`}
          className="pb-phase-none"
          style={{ width: "100%" }}
        />
      )}
    </span>
  );
}
