import type { ChatLlm, NeutralMsg } from './llm.js';
import { logger } from '../logger.js';

/**
 * Errors that mean "this provider can't serve us right now" — exhausted credits,
 * quota/rate limits, or dead credentials. Anything else (bad request, our bug,
 * network blip already retried by the SDK) is NOT grounds to switch providers.
 */
export function shouldFallback(err: unknown): boolean {
  const status = (err as { status?: number } | null)?.status;
  if (typeof status === 'number' && [401, 402, 403, 429, 529].includes(status)) return true;
  const m = err instanceof Error ? err.message : String(err);
  return /credit|billing|quota|insufficient/i.test(m);
}

/**
 * FallbackLlm — runs every turn on the primary until it fails with a
 * credits/quota/auth error, then permanently (for this conversation) switches to
 * a lazily-created secondary, seeded with the neutral transcript so the chat
 * continues where it left off. Rich tool history doesn't cross the switch —
 * carts live server-side, so the model can always review_cart again.
 */
export class FallbackLlm implements ChatLlm {
  readonly name = 'fallback';
  private active?: ChatLlm;

  constructor(
    private readonly primary: ChatLlm,
    private readonly makeSecondary: () => ChatLlm,
  ) {}

  get label(): string {
    return (this.active ?? this.primary).label;
  }

  transcript(): NeutralMsg[] {
    return (this.active ?? this.primary).transcript();
  }

  seed(transcript: NeutralMsg[]): void {
    (this.active ?? this.primary).seed(transcript);
  }

  async send(userText: string): Promise<string> {
    if (this.active) return this.active.send(userText);
    try {
      return await this.primary.send(userText);
    } catch (err) {
      if (!shouldFallback(err)) throw err;
      logger.warn('primary LLM unavailable — switching to fallback for this conversation', {
        primary: `${this.primary.name}:${this.primary.label}`,
        reason: err instanceof Error ? err.message : String(err),
      });
      const secondary = this.makeSecondary();
      secondary.seed(this.primary.transcript()); // completed turns carry over
      this.active = secondary;
      return secondary.send(userText);
    }
  }
}
