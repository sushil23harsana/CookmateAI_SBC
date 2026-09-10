import assert from 'node:assert/strict';
import type { ConverseCommandInput, ConverseStreamOutput } from '@aws-sdk/client-bedrock-runtime';
import { BedrockAgent, collectBedrockStream, type BedrockReply, type BedrockTransport } from './bedrock.js';
import { config, assertRuntimeConfig } from '../config.js';
import { createLlm, hasLlmFallback, primaryModelLabel } from './factory.js';

const tool = {
  name: 'review_cart',
  description: 'Review current cart',
  input_schema: { type: 'object', properties: {} },
};
const done: BedrockReply = {
  message: { role: 'assistant', content: [{ text: 'Your cart is ready.' }] },
  stopReason: 'end_turn',
};
const call: BedrockReply = {
  message: {
    role: 'assistant',
    content: [{ toolUse: { toolUseId: 'cart-1', name: 'review_cart', input: {} } }],
  },
  stopReason: 'tool_use',
};

function setup(replies: Array<BedrockReply | Error>, maxIterations = 4) {
  const requests: ConverseCommandInput[] = [];
  const executed: string[] = [];
  const transport: BedrockTransport = {
    async complete(input) {
      requests.push(structuredClone(input));
      const next = replies.shift();
      if (!next) throw new Error('Unexpected model request');
      if (next instanceof Error) throw next;
      return structuredClone(next);
    },
  };
  const agent = new BedrockAgent({
    transport,
    model: 'in.openai.gpt-5.6-luna',
    maxTokens: 512,
    system: 'Never place orders without confirmation.',
    tools: [tool],
    maxIterations,
    execute: async (name) => {
      executed.push(name);
      return { result: 'Please confirm your cart.', isError: true };
    },
  });
  return { agent, requests, executed };
}

// A real tool round-trip preserves IDs, errors, system prompt and output limits.
{
  const { agent, requests, executed } = setup([call, done]);
  assert.equal(await agent.send('Review my cart'), 'Your cart is ready.');
  assert.deepEqual(executed, ['review_cart']);
  assert.deepEqual(requests[0].inferenceConfig, { maxTokens: 512 });
  assert.equal(requests[0].system?.[0].text, 'Never place orders without confirmation.');
  const result = requests[1].messages?.[2].content?.[0].toolResult;
  assert.equal(result?.toolUseId, 'cart-1');
  assert.equal(result?.status, 'error');
  assert.equal(agent.transcript().length, 2);
}

// Model failures roll back only conversation state. No fallback or hidden retry occurs.
{
  const { agent, requests, executed } = setup([done, new Error('Account verification pending'), done]);
  await agent.send('first');
  await assert.rejects(agent.send('failed'), /verification/);
  assert.equal(agent.transcript().length, 2);
  await agent.send('retry');
  assert.equal(requests[2].messages?.length, 3);
  assert.equal(JSON.stringify(requests[2]).includes('failed'), false);
  assert.equal(executed.length, 0);
}

// Truncated, unknown, duplicated or malformed tool calls never reach the executor.
for (const invalid of [
  { ...call, stopReason: 'max_tokens' as const },
  {
    ...call,
    message: {
      role: 'assistant' as const,
      content: [{ toolUse: { toolUseId: 'x', name: 'unknown', input: {} } }],
    },
  },
  {
    ...call,
    message: { role: 'assistant' as const, content: [...call.message.content!, ...call.message.content!] },
  },
  {
    ...call,
    message: {
      role: 'assistant' as const,
      content: [{ toolUse: { toolUseId: 'x', name: 'review_cart', input: [] } }],
    },
  },
]) {
  const { agent, executed } = setup([invalid]);
  await assert.rejects(agent.send('go'));
  assert.equal(executed.length, 0);
  assert.deepEqual(agent.transcript(), []);
}

// Iteration cap stops further model calls and leaves a completed assistant turn.
{
  const { agent, requests, executed } = setup([call, done], 1);
  assert.match(await agent.send('cart'), /stuck/);
  await agent.send('next');
  assert.equal(executed.length, 1);
  assert.equal(requests[1].messages?.at(-2)?.role, 'assistant');
}

async function* events(items: ConverseStreamOutput[]) {
  yield* items;
}
const streamed: ConverseStreamOutput[] = [
  { messageStart: { role: 'assistant' } },
  { contentBlockDelta: { contentBlockIndex: 0, delta: { reasoningContent: { text: 'internal' } } } },
  { contentBlockDelta: { contentBlockIndex: 0, delta: { reasoningContent: { signature: 'signature' } } } },
  { contentBlockStop: { contentBlockIndex: 0 } },
  { contentBlockDelta: { contentBlockIndex: 1, delta: { text: 'Checking ' } } },
  { contentBlockDelta: { contentBlockIndex: 1, delta: { text: 'cart' } } },
  { contentBlockStop: { contentBlockIndex: 1 } },
  {
    contentBlockStart: {
      contentBlockIndex: 2,
      start: { toolUse: { toolUseId: 'cart-1', name: 'review_cart' } },
    },
  },
  { contentBlockDelta: { contentBlockIndex: 2, delta: { toolUse: { input: '{"cart' } } } },
  { contentBlockDelta: { contentBlockIndex: 2, delta: { toolUse: { input: 'Id":"abc"}' } } } },
  { contentBlockStop: { contentBlockIndex: 2 } },
  { messageStop: { stopReason: 'tool_use' } },
];
{
  const deltas: string[] = [];
  const reply = await collectBedrockStream(events(streamed), (text) => deltas.push(text));
  assert.deepEqual(deltas, ['Checking ', 'cart']);
  assert.equal(reply.message.content?.[0].reasoningContent?.reasoningText?.signature, 'signature');
  assert.deepEqual(reply.message.content?.[2].toolUse?.input, { cartId: 'abc' });
  await assert.rejects(
    collectBedrockStream(events(streamed.slice(0, -1)), () => {}),
    /complete/,
  );
  await assert.rejects(
    collectBedrockStream(
      events([
        {
          throttlingException: {
            name: 'ThrottlingException',
            $fault: 'client',
            $metadata: {},
            message: 'rate limited',
          },
        },
      ]),
      () => {},
    ),
    /rate limited/,
  );
  const malformed = structuredClone(streamed);
  malformed[9] = { contentBlockDelta: { contentBlockIndex: 2, delta: { toolUse: { input: 'bad json' } } } };
  await assert.rejects(
    collectBedrockStream(events(malformed), () => {}),
    SyntaxError,
  );
}

// A dropped stream after tool arguments must not execute even a complete-looking call.
{
  let executions = 0;
  const agent = new BedrockAgent({
    transport: { complete: async () => collectBedrockStream(events(streamed.slice(0, -1)), () => {}) },
    model: 'test',
    maxTokens: 64,
    system: 'test',
    tools: [tool],
    maxIterations: 1,
    execute: async () => {
      executions++;
      return { result: 'unexpected' };
    },
  });
  await assert.rejects(agent.send('cart'), /complete/);
  assert.equal(executions, 0);
}

// Bedrock starts without direct API keys and never opts into their fallback billing.
{
  const original = { ...config };
  try {
    Object.assign(config, {
      llm: 'bedrock',
      awsProfile: 'test-profile-not-resolved',
      anthropicApiKey: '',
      openaiApiKey: '',
    });
    assert.doesNotThrow(assertRuntimeConfig);
    Object.assign(config, { anthropicApiKey: 'test-only', openaiApiKey: 'test-only' });
    const agent = createLlm({
      system: 'test',
      tools: [],
      maxIterations: 1,
      execute: async () => ({ result: 'unused' }),
    });
    assert.equal(agent.name, 'bedrock');
    assert.equal(hasLlmFallback(), false);
    assert.equal(primaryModelLabel(), config.bedrockModel);
  } finally {
    Object.assign(config, original);
  }
}

console.log('✓ Bedrock tool loop, streaming and billing isolation tests passed');
