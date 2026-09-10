import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { config } from '../config.js';
import type { AgentDeps, ChatLlm } from './llm.js';
import { CookmateAgent } from './agent.js';
import { OpenAiAgent } from './openai.js';
import { FallbackLlm } from './fallback.js';
import { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';
import { fromIni } from '@aws-sdk/credential-providers';
import { BedrockAgent, createBedrockTransport } from './bedrock.js';

/**
 * Build the conversation brain from config:
 *  - COOKMATE_LLM=anthropic (default): Claude primary; if OPENAI_API_KEY is set,
 *    OpenAI is a live fallback (credits/quota/auth failures switch mid-session).
 *  - COOKMATE_LLM=openai: ChatGPT primary; Claude becomes the fallback if keyed.
 */
export function createLlm(deps: AgentDeps): ChatLlm {
  if (config.llm === 'bedrock') {
    const client = new BedrockRuntimeClient({
      region: config.awsRegion,
      maxAttempts: config.maxRetries + 1,
      ...(config.awsProfile ? { credentials: fromIni({ profile: config.awsProfile }) } : {}),
    });
    return new BedrockAgent({
      ...deps,
      model: config.bedrockModel,
      maxTokens: config.bedrockMaxTokens,
      transport: createBedrockTransport(client, config.requestTimeoutMs),
    });
  }
  const anthropic = (): ChatLlm =>
    new CookmateAgent({
      ...deps,
      model: config.model,
      client: new Anthropic({
        apiKey: config.anthropicApiKey,
        maxRetries: config.maxRetries,
        timeout: config.requestTimeoutMs,
      }),
    });
  const openai = (): ChatLlm =>
    new OpenAiAgent({
      ...deps,
      model: config.openaiModel,
      client: new OpenAI({
        apiKey: config.openaiApiKey,
        maxRetries: config.maxRetries,
        timeout: config.requestTimeoutMs,
      }),
    });

  if (config.llm === 'openai') {
    return config.anthropicApiKey ? new FallbackLlm(openai(), anthropic) : openai();
  }
  return config.openaiApiKey ? new FallbackLlm(anthropic(), openai) : anthropic();
}

/** The model id the primary brain will use (for banners/health). */
export function primaryModelLabel(): string {
  if (config.llm === 'bedrock') return config.bedrockModel;
  return config.llm === 'openai' ? config.openaiModel : config.model;
}

export function hasLlmFallback(): boolean {
  if (config.llm === 'bedrock') return false;
  return config.llm === 'openai' ? Boolean(config.anthropicApiKey) : Boolean(config.openaiApiKey);
}
