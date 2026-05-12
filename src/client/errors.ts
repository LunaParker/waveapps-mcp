export class WaveError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options as ErrorOptions);
    this.name = 'WaveError';
  }
}

export class WaveAuthError extends WaveError {
  constructor(message = 'Wave auth rejected — token likely expired. Re-grab the `waveapps` cookie from a logged-in browser.') {
    super(message);
    this.name = 'WaveAuthError';
  }
}

export class WaveApiError extends WaveError {
  readonly status: number;
  readonly url: string;
  readonly body: unknown;
  constructor(opts: { status: number; url: string; body: unknown; message?: string }) {
    super(opts.message ?? `Wave API ${opts.status} on ${opts.url}`);
    this.name = 'WaveApiError';
    this.status = opts.status;
    this.url = opts.url;
    this.body = opts.body;
  }
}

export class WaveGraphQLError extends WaveError {
  readonly operationName: string;
  readonly errors: ReadonlyArray<{ message: string; extensions?: unknown; path?: ReadonlyArray<string | number> }>;
  constructor(opts: { operationName: string; errors: WaveGraphQLError['errors'] }) {
    super(`Wave GraphQL "${opts.operationName}" returned errors: ${opts.errors.map((e) => e.message).join('; ')}`);
    this.name = 'WaveGraphQLError';
    this.operationName = opts.operationName;
    this.errors = opts.errors;
  }
}
