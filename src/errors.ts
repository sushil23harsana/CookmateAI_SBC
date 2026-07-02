/** Typed error hierarchy so callers can distinguish recoverable from fatal. */
export class CookmateError extends Error {
  constructor(
    message: string,
    readonly code: string,
    /** Recoverable = worth retrying or surfacing to the model to self-correct. */
    readonly retryable = false,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class ConfigError extends CookmateError {
  constructor(message: string) {
    super(message, 'CONFIG');
  }
}

/** Bad input to a tool — returned to the model so it can fix and retry. */
export class ValidationError extends CookmateError {
  constructor(message: string) {
    super(message, 'VALIDATION', true);
  }
}

/** A backend/provider failure. `retryable` for transient (network/5xx) cases. */
export class ProviderError extends CookmateError {
  constructor(message: string, retryable = false) {
    super(message, 'PROVIDER', retryable);
  }
}

/** A guardrail tripped — never auto-retry; the user must decide. */
export class SpendLimitError extends CookmateError {
  constructor(message: string) {
    super(message, 'SPEND_LIMIT');
  }
}
