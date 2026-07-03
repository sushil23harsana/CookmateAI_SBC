import Anthropic from '@anthropic-ai/sdk';
import type { AgentDeps, ChatLlm, NeutralMsg } from './llm.js';
import { logger } from '../logger.js';

export interface AnthropicAgentOptions extends AgentDeps {
  client: Anthropic;
  model: string;
}

/**
 * CookmateAgent — the Claude (Anthropic) tool-use loop, holding one conversation.
 *
 * We use the MANUAL loop (not the SDK tool runner) on purpose: it's where the
 * human-in-the-loop confirm gate lives. The harness decides whether a tool runs
 * (e.g. place_order pauses for the user) instead of the model auto-executing.
 *
 * Adaptive thinking + effort:high power strong recipe/budget planning; the full
 * assistant content (including thinking blocks) is echoed back each turn, which
 * the API requires. An iteration cap prevents runaway tool loops.
 *
 * State discipline: a failed turn rolls `messages` back to its checkpoint, so a
 * retry — or a fallback provider seeded from transcript() — starts clean.
 */
export class CookmateAgent implements ChatLlm {
  readonly name = 'anthropic';
  readonly label: string;
  private messages: Anthropic.MessageParam[] = [];
  private neutral: NeutralMsg[] = [];

  constructor(private readonly opts: AnthropicAgentOptions) {
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
      this.messages.length = checkpoint; // clean state for a retry or fallback
      throw err;
    }
  }

  private async runLoop(): Promise<string> {
    for (let iteration = 0; iteration < this.opts.maxIterations; iteration++) {
      const params: Anthropic.MessageCreateParamsNonStreaming = {
        model: this.opts.model,
        max_tokens: 16000,
        thinking: { type: 'adaptive' },
        output_config: { effort: 'high' },
        system: this.opts.system,
        tools: this.opts.tools as Anthropic.Tool[],
        messages: this.messages,
      };

      // Stream when a delta consumer is attached (web); otherwise the simpler
      // non-streaming call (CLI). Both yield the same final Message.
      let res: Anthropic.Message;
      if (this.opts.events?.onTextDelta) {
        const stream = this.opts.client.messages.stream(params);
        stream.on('text', (delta) => this.opts.events?.onTextDelta?.(delta));
        res = await stream.finalMessage();
      } else {
        res = await this.opts.client.messages.create(params);
      }

      this.messages.push({ role: 'assistant', content: res.content });

      if (res.stop_reason === 'refusal') {
        return '[The model declined this request for safety reasons.]';
      }
      if (res.stop_reason === 'pause_turn') {
        continue; // server-side tool loop paused; resume
      }

      const toolUses = res.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');

      if (res.stop_reason !== 'tool_use' || toolUses.length === 0) {
        const text = res.content
          .filter((b): b is Anthropic.TextBlock => b.type === 'text')
          .map((b) => b.text)
          .join('\n')
          .trim();
        this.opts.events?.onText?.(text);
        return text;
      }

      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const tu of toolUses) {
        const input = (tu.input ?? {}) as Record<string, unknown>;
        this.opts.events?.onToolCall?.(tu.name, input);
        const { result, isError } = await this.opts.execute(tu.name, input);
        toolResults.push({
          type: 'tool_result',
          tool_use_id: tu.id,
          content: result,
          is_error: isError,
        });
      }
      this.messages.push({ role: 'user', content: toolResults });
    }

    logger.warn('agent hit max tool iterations', { max: this.opts.maxIterations });
    return 'Sorry — I got stuck working through that. Could you simplify the request or try again?';
  }
}
