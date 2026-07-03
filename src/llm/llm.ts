import type { ToolDef, ToolResult } from '../types.js';

/** UI/logging hooks fired as the agent works. */
export interface AgentEvents {
  onText?: (text: string) => void;
  onToolCall?: (name: string, input: Record<string, unknown>) => void;
  /** Streams assistant text deltas as the model writes them. Enables live typing. */
  onTextDelta?: (delta: string) => void;
}

/** Everything an LLM agent needs besides its SDK client + model id. */
export interface AgentDeps {
  system: string;
  tools: ToolDef[];
  execute: (name: string, input: Record<string, unknown>) => Promise<ToolResult>;
  /** Safety valve: max tool round-trips per user turn before bailing out. */
  maxIterations: number;
  events?: AgentEvents;
}

/**
 * A provider-neutral record of COMPLETED turns (plain text, no tool blocks).
 * This is what carries a conversation across an LLM fallback: rich tool history
 * stays inside each provider's agent, but user/assistant text survives a switch.
 */
export interface NeutralMsg {
  role: 'user' | 'assistant';
  text: string;
}

/** A conversational LLM running the Cookmate tool loop. One instance = one conversation. */
export interface ChatLlm {
  /** Provider id, e.g. 'anthropic' | 'openai' | 'fallback'. */
  readonly name: string;
  /** Model id for display/logging, e.g. 'claude-opus-4-8'. */
  readonly label: string;
  send(userText: string): Promise<string>;
  /** Completed turns as neutral text (used to seed a fallback provider). */
  transcript(): NeutralMsg[];
  /** Replace conversation state with a neutral transcript. */
  seed(transcript: NeutralMsg[]): void;
}
