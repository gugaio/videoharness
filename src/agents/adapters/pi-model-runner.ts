import { Agent, type AgentTool } from "@earendil-works/pi-agent-core";
import { getModel, streamSimple } from "@earendil-works/pi-ai/compat";
import { logger } from "../../infra/logger.js";
import type { AgentModelRunner } from "../ports/agent-model-runner.js";

export type PiModelRunnerConfig = {
  apiKey: string;
  provider: string;
  apiUrl: string;
  model: string;
  timeoutMs: number;
};

/**
 * Provider adapter that runs one raw agent prompt through the Pi Agent core.
 * It owns the SDK specifics: model discovery, subscription lifecycle, abort
 * timeout, JSON extraction and safe response logging. Retry and structured
 * parsing are handled by the application layer.
 */
export function createPiModelRunner(config: PiModelRunnerConfig): AgentModelRunner {
  return async (input) => {
    const discovered = getModel(config.provider as never, config.model);
    const model = discovered ? { ...discovered, baseUrl: normalizeBaseUrl(config.apiUrl) } : undefined;
    if (!model) throw new Error("Configured Pi model is unavailable");
    const agent = new Agent({
      initialState: {
        systemPrompt: input.systemPrompt,
        model,
        thinkingLevel: "low",
        tools: input.tools as AgentTool[],
        messages: [],
      },
      streamFn: streamSimple,
      getApiKey: () => config.apiKey,
      onResponse: (response) => {
        logger.info("ai.provider_response", {
          investigationId: input.investigationId,
          agentId: input.agentId,
          provider: config.provider,
          model: config.model,
          status: response.status,
        });
      },
    });
    let timeout: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        new Promise<unknown>((resolve, reject) => {
          let unsubscribe: (() => void) | undefined;
          let settled = false;
          const finish = (callback: () => void): void => {
            if (settled) return;
            settled = true;
            unsubscribe?.();
            callback();
          };
          const value = agent.subscribe((event) => {
            const typed = event as {
              type?: string;
              messages?: Array<{ role?: string; content?: unknown; errorMessage?: string }>;
            };
            if (typed.type !== "agent_end") return;
            const messages = typed.messages ?? agent.state.messages;
            const message = [...messages].reverse().find((item) => item.role === "assistant");
            if (message && "errorMessage" in message && message.errorMessage) {
              const reason = providerFailureReason(message.errorMessage);
              logger.warn("ai.provider_unsuccessful", {
                investigationId: input.investigationId,
                agentId: input.agentId,
                provider: config.provider,
                model: config.model,
                reason,
              });
              finish(() => reject(new Error(`Pi provider unsuccessful: ${reason}`)));
              return;
            }
            const text = extractText(message && "content" in message ? message.content : undefined);
            if (!text) finish(() => reject(new Error("Pi returned empty content")));
            else finish(() => resolve(JSON.parse(extractJson(text))));
          });
          if (typeof value === "function") unsubscribe = value;
          agent.prompt(input.prompt).catch((error) => finish(() => reject(error)));
        }),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(() => {
            agent.abort();
            reject(new Error("Pi investigation timed out"));
          }, config.timeoutMs);
        }),
      ]);
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  };
}

function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .flatMap((part) => typeof part === "object" && part && "text" in part ? [String((part as { text: unknown }).text)] : [])
    .join("\n");
}

function extractJson(text: string): string {
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first < 0 || last <= first) throw new Error("Pi response did not contain JSON");
  return text.slice(first, last + 1);
}

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/chat\/completions\/?$/, "").replace(/\/$/, "");
}

function providerFailureReason(message: string): "rate_limit" | "server_error" | "context_limit" | "authentication" | "transport" | "unknown" {
  const normalized = message.toLowerCase();
  if (/\b429\b|rate.?limit|too many requests|capacity|concurren/.test(normalized)) return "rate_limit";
  if (/\b5\d\d\b|overload|internal server|service unavailable|bad gateway|gateway timeout/.test(normalized)) return "server_error";
  if (/context.{0,30}(?:length|window|limit)|token.{0,20}(?:limit|maximum)|payload.{0,20}(?:large|limit)/.test(normalized)) return "context_limit";
  if (/\b401\b|\b403\b|auth|api.?key|permission|forbidden|unauthorized/.test(normalized)) return "authentication";
  if (/abort|timeout|timed out|network|fetch|socket|econn|connection/.test(normalized)) return "transport";
  return "unknown";
}
