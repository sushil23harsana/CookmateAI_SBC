import assert from 'node:assert/strict';
import { FallbackLlm, shouldFallback } from './fallback.js';
import type { ChatLlm, NeutralMsg } from './llm.js';

/** A scriptable fake provider: returns text, or throws when told to. */
class FakeLlm implements ChatLlm {
  readonly label = 'fake-model';
  sent: string[] = [];
  seeded: NeutralMsg[] | null = null;
  private t: NeutralMsg[] = [];

  constructor(
    readonly name: string,
    private readonly behavior: (text: string) => string,
  ) {}

  async send(text: string): Promise<string> {
    const reply = this.behavior(text); // may throw
    this.sent.push(text);
    this.t.push({ role: 'user', text }, { role: 'assistant', text: reply });
    return reply;
  }
  transcript(): NeutralMsg[] {
    return [...this.t];
  }
  seed(transcript: NeutralMsg[]): void {
    this.seeded = [...transcript];
    this.t = [...transcript];
  }
}

const creditError = () => Object.assign(new Error('Your credit balance is too low'), { status: 400 });

// 1) shouldFallback classification: quota/credit/auth yes, ordinary errors no.
{
  assert.equal(shouldFallback(creditError()), true); // 400 + credit message
  assert.equal(shouldFallback(Object.assign(new Error('rate limited'), { status: 429 })), true);
  assert.equal(shouldFallback(Object.assign(new Error('nope'), { status: 401 })), true);
  assert.equal(shouldFallback(new Error('insufficient quota')), true);
  assert.equal(shouldFallback(new Error('boom')), false);
  assert.equal(shouldFallback(Object.assign(new Error('bad request'), { status: 400 })), false);
}

// 2) Healthy primary -> secondary is never created.
{
  let created = 0;
  const primary = new FakeLlm('anthropic', () => 'from claude');
  const llm = new FallbackLlm(primary, () => {
    created++;
    return new FakeLlm('openai', () => 'from gpt');
  });
  assert.equal(await llm.send('hi'), 'from claude');
  assert.equal(created, 0);
}

// 3) Credit failure -> switches, seeds the transcript, and stays switched.
{
  const primary = new FakeLlm('anthropic', (text) => {
    if (text === 'turn2') throw creditError();
    return 'claude:' + text;
  });
  const secondary = new FakeLlm('openai', (text) => 'gpt:' + text);
  const llm = new FallbackLlm(primary, () => secondary);

  assert.equal(await llm.send('turn1'), 'claude:turn1'); // primary serves turn 1
  assert.equal(await llm.send('turn2'), 'gpt:turn2'); // credit death -> fallback answers
  // the completed first turn carried over to the secondary
  assert.deepEqual(secondary.seeded, [
    { role: 'user', text: 'turn1' },
    { role: 'assistant', text: 'claude:turn1' },
  ]);
  assert.equal(await llm.send('turn3'), 'gpt:turn3'); // sticky: no bouncing back
  assert.deepEqual(primary.sent, ['turn1']);
}

// 4) Non-quota errors surface unchanged — no provider switch.
{
  const primary = new FakeLlm('anthropic', () => {
    throw new Error('boom');
  });
  let created = 0;
  const llm = new FallbackLlm(primary, () => {
    created++;
    return new FakeLlm('openai', () => 'gpt');
  });
  await assert.rejects(() => llm.send('hi'), /boom/);
  assert.equal(created, 0);
}

console.log('✓ LLM fallback tests passed');
