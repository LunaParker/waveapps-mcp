import { cliCommand } from '../util/cli-command.js';

export class WaveError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options as ErrorOptions);
    this.name = 'WaveError';
  }
}

export class WaveAuthError extends WaveError {
  constructor(message = `Wave auth rejected — session likely expired. Run \`${cliCommand('login')}\` to sign in again.`) {
    super(message);
    this.name = 'WaveAuthError';
  }
}

const BODY_EXCERPT_LIMIT = 1000;

/** The response body, cut down so a failed call still tells the model what Wave objected to. */
function bodyExcerpt(body: unknown): string {
  if (body === null || body === undefined) return '';
  const text = typeof body === 'string' ? body.trim() : JSON.stringify(body);
  if (!text || text === '{}' || text === '[]') return '';
  return text.length > BODY_EXCERPT_LIMIT ? `${text.slice(0, BODY_EXCERPT_LIMIT)}...` : text;
}

export class WaveApiError extends WaveError {
  readonly status: number;
  readonly url: string;
  readonly body: unknown;
  constructor(opts: { status: number; url: string; body: unknown; message?: string }) {
    const excerpt = bodyExcerpt(opts.body);
    super(opts.message ?? `Wave API ${opts.status} on ${opts.url}${excerpt ? `: ${excerpt}` : ''}`);
    this.name = 'WaveApiError';
    this.status = opts.status;
    this.url = opts.url;
    this.body = opts.body;
  }
}

export interface WaveGraphQLErrorEntry {
  message: string;
  extensions?: unknown;
  path?: ReadonlyArray<string | number> | null;
}

function describeGraphQLError(e: WaveGraphQLErrorEntry): string {
  const code = (e.extensions as { code?: unknown } | undefined)?.code;
  const parts = [e.message];
  if (typeof code === 'string') parts.push(`(${code})`);
  if (e.path && e.path.length > 0) parts.push(`at ${e.path.join('.')}`);
  return parts.join(' ');
}

export class WaveGraphQLError extends WaveError {
  readonly operationName: string;
  readonly errors: ReadonlyArray<WaveGraphQLErrorEntry>;
  constructor(opts: { operationName: string; errors: ReadonlyArray<WaveGraphQLErrorEntry> }) {
    super(`Wave GraphQL "${opts.operationName}" returned errors: ${opts.errors.map(describeGraphQLError).join('; ')}`);
    this.name = 'WaveGraphQLError';
    this.operationName = opts.operationName;
    this.errors = opts.errors;
  }
}

/** One entry of a mutation payload's `inputErrors`. */
export interface WaveInputError {
  message: string;
  path?: ReadonlyArray<string | number> | null;
  code?: string | null;
}

function describeInputError(e: WaveInputError): string {
  const where = e.path && e.path.length > 0 ? `${e.path.join('.')}: ` : '';
  const code = e.code ? ` (${e.code})` : '';
  return `${where}${e.message}${code}`;
}

/** A GraphQL mutation that answered 200 with `didSucceed: false`. */
export class WaveMutationError extends WaveError {
  readonly operationName: string;
  readonly inputErrors: ReadonlyArray<WaveInputError>;
  constructor(opts: { operationName: string; inputErrors?: ReadonlyArray<WaveInputError> | null }) {
    const inputErrors = opts.inputErrors ?? [];
    const detail = inputErrors.length > 0 ? inputErrors.map(describeInputError).join('; ') : 'no reason given';
    super(`Wave rejected ${opts.operationName}: ${detail}`);
    this.name = 'WaveMutationError';
    this.operationName = opts.operationName;
    this.inputErrors = inputErrors;
  }
}

/** Throw unless a mutation payload reports success, so the model sees Wave's reason instead of a quiet `didSucceed: false`. */
export function requireDidSucceed<T extends { didSucceed?: boolean | null; inputErrors?: ReadonlyArray<WaveInputError> | null }>(
  operationName: string,
  payload: T | null | undefined,
): T {
  if (!payload || payload.didSucceed !== true) {
    throw new WaveMutationError({ operationName, inputErrors: payload?.inputErrors });
  }
  return payload;
}
