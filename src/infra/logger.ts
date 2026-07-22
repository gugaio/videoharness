type LogLevel = "info" | "warn" | "error";

function write(level: LogLevel, event: string, details: Record<string, unknown> = {}): void {
  const payload = JSON.stringify({
    level,
    event,
    at: new Date().toISOString(),
    ...details,
  });
  if (level === "error") {
    console.error(payload);
    return;
  }
  if (level === "warn") {
    console.warn(payload);
    return;
  }
  console.info(payload);
}

export const logger = {
  info: (event: string, details?: Record<string, unknown>): void => write("info", event, details),
  warn: (event: string, details?: Record<string, unknown>): void => write("warn", event, details),
  error: (event: string, details?: Record<string, unknown>): void => write("error", event, details),
};
