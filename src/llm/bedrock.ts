import {
  BedrockRuntimeClient,
  ConverseCommand,
  ConverseStreamCommand,
  type ContentBlock,
  type ConverseCommandInput,
  type ConverseStreamOutput,
  type Message,
  type StopReason,
  type ToolInputSchema,
} from '@aws-sdk/client-bedrock-runtime';
import type { AgentDeps, ChatLlm, NeutralMsg } from './llm.js';
import { logger } from '../logger.js';

export interface BedrockReply {
  message: Message;
  stopReason: StopReason;
}

export interface BedrockTransport {
  complete(input: ConverseCommandInput, onDelta?: (text: string) => void): Promise<BedrockReply>;
}

function blockIndex(value: number | undefined): number {
  if (value === undefined || !Number.isInteger(value) || value < 0) {
    throw new Error('Invalid Bedrock content block index');
  }
  return value;
}

/** Collect the whole response before allowing any tool execution. */
export async function collectBedrockStream(
  stream: AsyncIterable<ConverseStreamOutput>,
  onDelta: (text: string) => void,
): Promise<BedrockReply> {
  const blocks = new Map<number, ContentBlock>();
  const toolJson = new Map<number, string>();
  const closed = new Set<number>();
  let stopReason: StopReason | undefined;
  let started = false;

  for await (const event of stream) {
    const failure =
      event.internalServerException ??
      event.modelStreamErrorException ??
      event.serviceUnavailableException ??
      event.throttlingException ??
      event.validationException;
    if (failure) throw new Error(failure.message ?? 'Bedrock stream failed');
    if (event.$unknown) throw new Error('Unsupported Bedrock stream event');
    if (event.messageStart) {
      if (event.messageStart.role !== 'assistant') throw new Error('Unexpected Bedrock message role');
      started = true;
    }
    if (event.contentBlockStart) {
      const { start } = event.contentBlockStart;
      const index = blockIndex(event.contentBlockStart.contentBlockIndex);
      if (!start?.toolUse) throw new Error('Unsupported Bedrock content block');
      if (blocks.has(index)) throw new Error('Duplicate Bedrock content block');
      blocks.set(index, { toolUse: { ...start.toolUse, input: {} } });
      toolJson.set(index, '');
    }
    if (event.contentBlockDelta) {
      const { delta } = event.contentBlockDelta;
      const index = blockIndex(event.contentBlockDelta.contentBlockIndex);
      if (closed.has(index)) throw new Error('Bedrock sent a delta after block completion');
      if (delta?.text !== undefined) {
        const previous = blocks.get(index);
        if (previous && previous.text === undefined) throw new Error('Bedrock block type changed');
        blocks.set(index, { text: (previous?.text ?? '') + delta.text });
        onDelta(delta.text);
      } else if (delta?.toolUse) {
        if (!toolJson.has(index)) throw new Error('Bedrock tool delta has no start');
        toolJson.set(index, toolJson.get(index)! + (delta.toolUse.input ?? ''));
      } else if (delta?.reasoningContent) {
        const reasoning = delta.reasoningContent;
        const previous = blocks.get(index)?.reasoningContent;
        if (reasoning.redactedContent) {
          const old = previous?.redactedContent ?? new Uint8Array();
          const bytes = new Uint8Array(old.length + reasoning.redactedContent.length);
          bytes.set(old);
          bytes.set(reasoning.redactedContent, old.length);
          blocks.set(index, { reasoningContent: { redactedContent: bytes } });
        } else if (reasoning.text !== undefined || reasoning.signature !== undefined) {
          blocks.set(index, {
            reasoningContent: {
              reasoningText: {
                text: (previous?.reasoningText?.text ?? '') + (reasoning.text ?? ''),
                signature: (previous?.reasoningText?.signature ?? '') + (reasoning.signature ?? ''),
              },
            },
          });
        } else {
          throw new Error('Unsupported Bedrock reasoning block');
        }
      } else {
        throw new Error('Unsupported Bedrock content delta');
      }
    }
    if (event.contentBlockStop) closed.add(blockIndex(event.contentBlockStop.contentBlockIndex));
    if (event.messageStop) stopReason = event.messageStop.stopReason;
  }

  if (!started || !stopReason || [...blocks.keys()].some((index) => !closed.has(index))) {
    throw new Error('Bedrock stream ended before the message was complete');
  }
  for (const [index, json] of toolJson) {
    const toolUse = blocks.get(index)!.toolUse!;
    // Parse only after the message finishes: incomplete tool arguments never run.
    toolUse.input = JSON.parse(json || '{}');
  }
  return {
    message: { role: 'assistant', content: [...blocks].sort(([a], [b]) => a - b).map(([, b]) => b) },
    stopReason,
  };
}

export function createBedrockTransport(client: BedrockRuntimeClient, timeoutMs: number): BedrockTransport {
  return {
    async complete(input, onDelta) {
      const abortSignal = AbortSignal.timeout(timeoutMs);
      if (onDelta) {
        const response = await client.send(new ConverseStreamCommand(input), { abortSignal });
        if (!response.stream) throw new Error('Bedrock returned no response stream');
        return collectBedrockStream(response.stream, onDelta);
      }
      const response = await client.send(new ConverseCommand(input), { abortSignal });
      if (!response.output?.message || !response.stopReason)
        throw new Error('Bedrock returned no complete assistant message');
      return { message: response.output.message, stopReason: response.stopReason };
    },
  };
}

export interface BedrockAgentOptions extends AgentDeps {
  transport: BedrockTransport;
  model: string;
  maxTokens: number;
}

/** Bedrock uses the same executor and human confirmation gates as the other agents. */
export class BedrockAgent implements ChatLlm {
  readonly name = 'bedrock';
  readonly label: string;
  private messages: Message[] = [];
  private neutral: NeutralMsg[] = [];

  constructor(private readonly opts: BedrockAgentOptions) {
    this.label = opts.model;
  }

  transcript(): NeutralMsg[] {
    return [...this.neutral];
  }

  seed(transcript: NeutralMsg[]): void {
    this.neutral = [...transcript];
    this.messages = transcript.map((m) => ({ role: m.role, content: [{ text: m.text }] }));
  }

  async send(userText: string): Promise<string> {
    const checkpoint = this.messages.length;
    this.messages.push({ role: 'user', content: [{ text: userText }] });
    try {
      const text = await this.runLoop();
      this.neutral.push({ role: 'user', text: userText }, { role: 'assistant', text });
      return text;
    } catch (error) {
      this.messages.length = checkpoint;
      throw error;
    }
  }

  private async runLoop(): Promise<string> {
    for (let iteration = 0; iteration < this.opts.maxIterations; iteration++) {
      const reply = await this.opts.transport.complete(
        {
          modelId: this.opts.model,
          system: [{ text: this.opts.system }],
          messages: this.messages,
          inferenceConfig: { maxTokens: this.opts.maxTokens },
          ...(this.opts.tools.length
            ? {
                toolConfig: {
                  tools: this.opts.tools.map((tool) => ({
                    toolSpec: {
                      name: tool.name,
                      description: tool.description,
                      inputSchema: { json: tool.input_schema as NonNullable<ToolInputSchema['json']> },
                    },
                  })),
                },
              }
            : {}),
        },
        this.opts.events?.onTextDelta,
      );

      if (reply.message.role !== 'assistant') throw new Error('Unexpected Bedrock message role');
      if (reply.stopReason === 'max_tokens')
        throw new Error('Bedrock response exceeded the output token limit');
      if (reply.stopReason === 'guardrail_intervened' || reply.stopReason === 'content_filtered') {
        const text = 'The model declined this request. Please rephrase it.';
        this.messages.push({ role: 'assistant', content: [{ text }] });
        this.opts.events?.onText?.(text);
        return text;
      }
      const content = reply.message.content ?? [];
      const tools = content.flatMap((block) => (block.toolUse ? [block.toolUse] : []));
      if (tools.length && reply.stopReason !== 'tool_use')
        throw new Error('Bedrock returned incomplete tool calls');
      if (!tools.length && reply.stopReason === 'tool_use')
        throw new Error('Bedrock requested tools without any calls');
      this.messages.push(reply.message);
      if (!tools.length) {
        if (!['end_turn', 'stop_sequence'].includes(reply.stopReason))
          throw new Error('Unexpected Bedrock stop reason');
        const text = content
          .flatMap((block) => (block.text === undefined ? [] : [block.text]))
          .join('\n')
          .trim();
        if (!text) throw new Error('Bedrock returned an empty answer');
        this.opts.events?.onText?.(text);
        return text;
      }
      // Validate the complete set before running any tool.
      const ids = new Set<string>();
      for (const tool of tools) {
        if (
          !tool.toolUseId ||
          !tool.name ||
          ids.has(tool.toolUseId) ||
          !this.opts.tools.some((t) => t.name === tool.name)
        ) {
          throw new Error('Bedrock returned an unknown or duplicate tool call');
        }
        if (!tool.input || typeof tool.input !== 'object' || Array.isArray(tool.input)) {
          throw new Error('Bedrock tool arguments must be an object');
        }
        ids.add(tool.toolUseId);
      }
      const results: ContentBlock[] = [];
      for (const tool of tools) {
        const input = tool.input as Record<string, unknown>;
        this.opts.events?.onToolCall?.(tool.name!, input);
        const { result, isError } = await this.opts.execute(tool.name!, input);
        results.push({
          toolResult: {
            toolUseId: tool.toolUseId,
            content: [{ text: result }],
            status: isError ? 'error' : 'success',
          },
        });
      }
      this.messages.push({ role: 'user', content: results });
    }
    logger.warn('Bedrock agent hit max tool iterations', { max: this.opts.maxIterations });
    const text = 'Sorry — I got stuck working through that. Could you simplify the request or try again?';
    this.messages.push({ role: 'assistant', content: [{ text }] });
    return text;
  }
}
