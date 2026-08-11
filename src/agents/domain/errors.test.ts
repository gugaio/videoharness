import { describe, expect, it } from "vitest";
import { classifyAiError, publicError } from "./errors.js";

describe("AI provider error classification", () => {
  it("reports rate limiting without exposing the provider response", () => {
    const error = new Error("Pi provider unsuccessful: rate_limit");
    expect(classifyAiError(error)).toBe("provider_rate_limit");
    expect(publicError(error)).toBe("The AI provider rate-limited this analysis after retry.");
  });

  it("distinguishes server and context failures", () => {
    expect(classifyAiError(new Error("Pi provider unsuccessful: server_error"))).toBe("provider_server_error");
    expect(publicError(new Error("Pi provider unsuccessful: context_limit"))).toContain("context limit");
  });
});
