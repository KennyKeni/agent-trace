import type { HookInput } from "../core/types";
import { maybeString } from "../core/utils";

export function sessionIdFor(input: HookInput): string | undefined {
  return (
    maybeString(input.session_id) ??
    maybeString(input.conversation_id) ??
    maybeString(input.generation_id)
  );
}

export function normalizeModelId(model?: string): string | undefined {
  if (!model) return undefined;
  if (model.includes("/")) return model;
  const prefixes: Record<string, string> = {
    "claude-": "anthropic",
    "gpt-": "openai",
    o1: "openai",
    o3: "openai",
    o4: "openai",
    "gemini-": "google",
  };
  for (const [prefix, provider] of Object.entries(prefixes)) {
    if (model.startsWith(prefix)) return `${provider}/${model}`;
  }
  return model;
}
