import Anthropic from '@anthropic-ai/sdk';
import * as readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

import { config, assertRuntimeConfig } from './config.js';
import { logger } from './logger.js';
import { CookmateError } from './errors.js';
import { CookmateAgent } from './llm/agent.js';
import { systemPrompt } from './llm/prompt.js';
import { CartStore } from './core/cart.js';
import { createExecutor, toolDefs } from './engine/executor.js';
import type { InstamartProvider } from './instamart/provider.js';
import { MockInstamartProvider } from './instamart/mock.js';
import { SwiggyInstamartProvider } from './instamart/swiggyMcp.js';
import type { Cart } from './types.js';

const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RESET = '\x1b[0m';

/** `--once "<prompt>"` runs a single non-interactive turn and exits (for demos/CI). */
function parseOnce(argv: string[]): string | undefined {
  const i = argv.indexOf('--once');
  if (i === -1) return undefined;
  return (
    argv
      .slice(i + 1)
      .join(' ')
      .trim() || undefined
  );
}

function formatCart(cart: Cart): string {
  const lines = cart.lines.map((l) => `  • ${l.name} ×${l.qty} — ₹${l.lineTotal}`).join('\n');
  const mov = cart.belowMinOrderValue
    ? `\n  ${YELLOW}below ₹${cart.minOrderValue} min order value${RESET}`
    : '';
  return `${lines}\n  ${DIM}delivery ₹${cart.fees}${RESET}\n  ${BOLD}total ₹${cart.total}${RESET}${mov}`;
}

async function main(): Promise<void> {
  assertRuntimeConfig();

  const provider: InstamartProvider =
    config.provider === 'swiggy' ? new SwiggyInstamartProvider() : new MockInstamartProvider();
  const carts = new CartStore();

  const once = parseOnce(process.argv);
  const rl = once ? undefined : readline.createInterface({ input: stdin, output: stdout });
  let closed = false;
  const cleanup = async () => {
    if (closed) return;
    closed = true;
    rl?.close();
    await provider.close().catch((e) => logger.error('provider close failed', e));
  };
  process.on('SIGINT', () => {
    cleanup().finally(() => process.exit(0));
  });

  console.log(`${BOLD}Cookmate AI${RESET} ${DIM}(provider=${provider.name} · model=${config.model})${RESET}`);
  console.log(
    `${DIM}Tell me a dish or a budget. e.g. "healthy pasta for 2" or "₹400 pasta dinner". Ctrl+C to quit.${RESET}\n`,
  );

  const client = new Anthropic({
    apiKey: config.anthropicApiKey,
    maxRetries: config.maxRetries,
    timeout: config.requestTimeoutMs,
  });

  const execute = createExecutor({
    provider,
    carts,
    confirmOrder: async (cart) => {
      console.log(`\n${YELLOW}${BOLD}⚠ Confirm order${RESET}\n${formatCart(cart)}`);
      if (!rl) {
        console.log(`${DIM}[--once] no human present — auto-declining.${RESET}`);
        return false;
      }
      try {
        const ans = (await rl.question(`${BOLD}Place this order? (yes/no) ${RESET}`)).trim().toLowerCase();
        return ans === 'yes' || ans === 'y';
      } catch {
        return false; // input closed mid-confirm — fail safe to "not placed"
      }
    },
    onOrderPlaced: (order) => console.log(`${GREEN}✓ order placed: ${order.orderId}${RESET}`),
  });

  const agent = new CookmateAgent({
    client,
    model: config.model,
    system: systemPrompt(),
    tools: toolDefs(),
    execute,
    maxIterations: config.maxToolIterations,
    events: {
      onToolCall: (name, input) => {
        const preview = JSON.stringify(input);
        logger.debug(`tool ${name}`, preview.length > 120 ? preview.slice(0, 120) + '…' : preview);
      },
    },
  });

  try {
    if (once) {
      console.log(`${BOLD}you ›${RESET} ${once}`);
      console.log(`\n${BOLD}cookmate ›${RESET} ${await agent.send(once)}\n`);
      return;
    }
    while (true) {
      let userText: string;
      try {
        userText = (await rl!.question(`${BOLD}you ›${RESET} `)).trim();
      } catch {
        break; // stdin closed (EOF / Ctrl-D / piped input ended) — exit cleanly
      }
      if (!userText) continue;
      if (['exit', 'quit', ':q'].includes(userText.toLowerCase())) break;
      try {
        console.log(`\n${BOLD}cookmate ›${RESET} ${await agent.send(userText)}\n`);
      } catch (err) {
        logger.error('turn failed', err);
        console.error(`${YELLOW}Something went wrong on that turn — try again.${RESET}`);
      }
    }
  } finally {
    await cleanup();
  }
}

main().catch((err) => {
  if (err instanceof CookmateError) {
    console.error(`${YELLOW}${err.code}:${RESET} ${err.message}`);
  } else {
    logger.error('fatal', err);
  }
  process.exit(1);
});
