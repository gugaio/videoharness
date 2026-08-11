import type { AgentId } from "../domain/types.js";

/**
 * Runs one raw agent prompt against an LLM provider and returns the parsed
 * JSON response (not yet validated against the structured output contract).
 * The port is provider-agnostic: adapters own SDK specifics and the raw
 * response extraction; retry and contract parsing stay in the application.
 */
export type AgentModelRunner = (input: {
  investigationId: string;
  agentId: AgentId;
  systemPrompt: string;
  prompt: string;
  tools: readonly unknown[];
}) => Promise<unknown>;
