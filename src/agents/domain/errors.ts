import { z } from "zod";

export function classifyAiError(error: unknown): string {
  if (error instanceof z.ZodError) return "response_validation";
  if (error instanceof SyntaxError) return "invalid_json";
  if (error instanceof Error && error.message.includes("did not contain JSON")) return "invalid_json";
  if (error instanceof Error && error.message.includes("timed out")) return "timeout";
  if (error instanceof Error && error.message.includes("empty content")) return "empty_content";
  if (error instanceof Error && error.message.includes("unavailable")) return "model_unavailable";
  if (error instanceof Error && error.message.includes("provider unsuccessful: rate_limit")) return "provider_rate_limit";
  if (error instanceof Error && error.message.includes("provider unsuccessful: server_error")) return "provider_server_error";
  if (error instanceof Error && error.message.includes("provider unsuccessful: context_limit")) return "provider_context_limit";
  if (error instanceof Error && error.message.includes("provider unsuccessful: authentication")) return "provider_authentication";
  if (error instanceof Error && error.message.includes("provider unsuccessful: transport")) return "provider_transport";
  if (typeof error === "object" && error && "status" in error && typeof error.status === "number") {
    return `provider_http_${error.status}`;
  }
  return "provider_error";
}

export function aiValidationIssues(error: unknown): string[] | undefined {
  if (!(error instanceof z.ZodError)) return undefined;
  return error.issues.slice(0, 8).map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join(".") : "response";
    return `${path}:${issue.code}`;
  });
}

export function aiRetryAfterMs(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null || !("retryAfterMs" in error)) return undefined;
  const value = error.retryAfterMs;
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.min(Math.max(Math.round(value), 1_000), 60_000)
    : undefined;
}

export function publicError(error: unknown): string {
  const errorType = classifyAiError(error);
  if (errorType === "response_validation" || errorType === "invalid_json" || errorType === "empty_content") {
    return "The AI response did not satisfy the structured analysis contract after retry.";
  }
  if (errorType === "timeout") return "The AI analysis timed out after retry.";
  if (errorType === "model_unavailable") return "The configured AI model is unavailable.";
  if (errorType === "provider_rate_limit") return "The AI provider rate-limited this analysis after retry.";
  if (errorType === "provider_server_error") return "The AI provider returned a server error after retry.";
  if (errorType === "provider_context_limit") return "The analysis packet exceeded the AI provider context limit after retry.";
  if (errorType === "provider_authentication") return "The AI provider rejected the configured credentials or permissions.";
  if (errorType === "provider_transport") return "The AI provider connection failed after retry.";
  return "The AI provider request failed after retry.";
}
