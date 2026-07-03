import OpenAI from 'openai';
import type { AgentDeps, ChatLlm, NeutralMsg } from './llm.js';
import { logger } from '../logger.js';

export interface OpenAiAgentOptions extends AgentDeps {
  client: OpenAI;
  model: string;
}

type Msg = OpenAI.Chat.Completions.ChatCompletionMessageParam;

/**
 * OpenAiAgent — the ChatGPT twin of CookmateAgent, used as the fallback brain
 * (or the primary via COOKMATE_LLM=openai). Identical contract: manual tool loop
 * behind the same executor safety layer, streaming deltas when attached, an
 * iteration cap, and checkpoint/rollback so failed turns leave clean state.
 */
export class OpenAiAgent implements ChatLlm {
  readonly name = 'openai';
  readonly label: string;
  private messages: Msg[] = [];
  private neutral: NeutralMsg[] = [];

  constructor(private readonly opts: OpenAiAgentOptions) {
    this.label = opts.model;
  }

  transcript(): NeutralMsg[] {
    return [...this.neutral];
  }

  seed(transcript: NeutralMsg[]): void {
    this.neutral = [...transcript];
    this.messages = transcript.map((m) => ({ role: m.role, content: m.text }));
  }

  async send(userText: string): Promise<string> {
    const checkpoint = this.messages.length;
    this.messages.push({ role: 'user', content: userText });
    try {
      const text = await this.runLoop();
      this.neutral.push({ role: 'user', text: userText }, { role: 'assistant', text });
      return text;
    } catch (err) {
      this.messages.length = checkpoint; // clean state for a retry
      throw err;
    }
  }

  private toolParams(): OpenAI.Chat.Completions.ChatCompletionTool[] {
    return this.opts.tools.map((t) => ({
      type: 'function' as const,
      function: { name: t.name, description: t.description, parameters: t.input_schema },
    }));
  }

  private async runLoop(): Promise<string> {
    for (let iteration = 0; iteration < this.opts.maxIterations; iteration++) {
      const params = {
        model: this.opts.model,
        max_completion_tokens: 16000,
        // The system prompt is prepended per-call so seed()/rollback only ever
        // deal with plain conversation messages.
        messages: [{ role: 'system' as const, content: this.opts.system }, ...this.messages],
        tools: this.toolParams(),
      };

      let message: OpenAI.Chat.Completions.ChatCompletionMessage;
      if (this.opts.events?.onTextDelta) {
        const stream = this.opts.client.chat.completions.stream(params);
        stream.on('content', (delta) => this.opts.events?.onTextDelta?.(delta));
        message = (await stream.finalChatCompletion()).choices[0].message;
      } else {
        const res = await this.opts.client.chat.completions.create(params);
        message = res.choices[0].message;
      }

      this.messages.push(message as Msg);

      const calls = (message.tool_calls ?? []).filter((c) => c.type === 'function');
      if (calls.length === 0) {
        if (message.refusal) return '[The model declined this request for safety reasons.]';
        const text = (message.content ?? '').trim();
        this.opts.events?.onText?.(text);
        return text;
      }

      for (const call of calls) {
        let input: Record<string, unknown> = {};
        try {
          input = JSON.parse(call.function.arguments || '{}') as Record<string, unknown>;
        } catch {
          /* leave {} — the executor turns it into a recoverable validation error */
        }
        this.opts.events?.onToolCall?.(call.function.name, input);
        const { result, isError } = await this.opts.execute(call.function.name, input);
        this.messages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: isError ? `ERROR: ${result}` : result,
        });
      }
    }

    logger.warn('agent hit max tool iterations', { max: this.opts.maxIterations });
    return 'Sorry — I got stuck working through that. Could you simplify the request or try again?';
  }
}
