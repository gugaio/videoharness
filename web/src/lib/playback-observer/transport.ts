import type { ObserverEvent } from "./types";

export class HTTPBatchTransport {
  private queue: ObserverEvent[] = [];
  private timer: number | null = null;
  private sending = false;

  constructor(private readonly ingestUrl: string, private readonly intervalMS = 1500, private readonly maxBatch = 20) {}

  enqueue(event: ObserverEvent): void {
    this.queue.push(event);
    if (this.queue.length >= this.maxBatch) void this.flush();
    else if (this.timer === null) this.timer = window.setTimeout(() => void this.flush(), this.intervalMS);
  }

  async flush(): Promise<void> {
    if (this.sending || this.queue.length === 0) return;
    if (this.timer !== null) { window.clearTimeout(this.timer); this.timer = null; }
    const batch = this.queue.splice(0, this.maxBatch);
    this.sending = true;
    try {
      const response = await fetch(this.ingestUrl, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ events: batch }), keepalive: true,
      });
      if (!response.ok && response.status >= 500) {
        await fetch(this.ingestUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ events: batch }), keepalive: true }).catch(() => undefined);
      }
    } catch {
      // Telemetry is deliberately fail-open and never propagates to playback.
    } finally {
      this.sending = false;
      if (this.queue.length > 0) this.timer = window.setTimeout(() => void this.flush(), 0);
    }
  }

  closeWithBeacon(): void {
    if (this.timer !== null) { window.clearTimeout(this.timer); this.timer = null; }
    if (this.queue.length === 0) return;
    const batch = this.queue.splice(0, this.maxBatch);
    const body = JSON.stringify({ events: batch });
    if (!navigator.sendBeacon?.(this.ingestUrl, new Blob([body], { type: "application/json" }))) {
      void fetch(this.ingestUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true }).catch(() => undefined);
    }
  }
}
