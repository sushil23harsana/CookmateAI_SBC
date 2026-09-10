import { config } from '../config.js';
import { createLlm } from './factory.js';

if (config.llm !== 'bedrock') {
  throw new Error('Set COOKMATE_LLM=bedrock and AWS_PROFILE=cookmate for this local smoke test.');
}

// Synthetic data only; no Swiggy calls, customer data, or purchases.
const deltas: string[] = [];
const agent = createLlm({
  system: 'You are testing connectivity. Reply briefly. No shopping actions are available.',
  tools: [],
  execute: async () => {
    throw new Error('Tools are disabled in this connection test.');
  },
  maxIterations: 1,
  events: { onTextDelta: (text) => deltas.push(text) },
});
const reply = await agent.send('Reply with exactly: Cookmate connection ready');
if (!deltas.length || !reply.trim()) throw new Error('Bedrock returned no streamed text.');
console.log(JSON.stringify({ provider: agent.name, model: agent.label, streamed: true, reply }));
