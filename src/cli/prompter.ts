import { createInterface, type Interface as ReadlineInterface } from 'node:readline';

/**
 * Long-lived CLI input helper. Two prompt modes:
 *
 *   - `ask(question)` — normal readline question, characters echoed as the user types.
 *   - `askSecret(question)` — question text stays visible, typed characters do NOT echo.
 *
 * The secret-prompt path pauses the long-lived readline interface, attaches a temporary
 * raw-mode listener directly to stdin, then restores readline once the user hits Enter.
 * That avoids two pitfalls of the previous implementation:
 *
 *   1. Using `rl.question('')` and muting `_writeToOutput` — readline's `_refreshLine`
 *      fires on every keystroke and rewrites the prompt, so muting everything also wipes
 *      the question text.
 *   2. Standing up two readline interfaces back-to-back — they fight over stdin and the
 *      second one's `isTTY` detection can be wrong, falling through to echoed input.
 */
export class Prompter {
  private readonly rl: ReadlineInterface;

  constructor() {
    this.rl = createInterface({ input: process.stdin, output: process.stdout });
  }

  ask(question: string): Promise<string> {
    return new Promise((resolve) => this.rl.question(question, resolve));
  }

  async askSecret(question: string): Promise<string> {
    process.stdout.write(question);

    const stdin = process.stdin;
    const canHide =
      stdin.isTTY === true &&
      typeof stdin.setRawMode === 'function' &&
      process.stdout.isTTY === true;

    if (!canHide) {
      // Piped or non-interactive shell — we can't suppress echo. Tell the user so they
      // notice the input will be visible and read a normal line.
      process.stdout.write('(not a TTY — input will be visible) ');
      return new Promise((resolve) => this.rl.question('', resolve));
    }

    this.rl.pause();
    try {
      return await readSecretRaw(stdin);
    } finally {
      this.rl.resume();
    }
  }

  close(): void {
    this.rl.close();
  }
}

/** Read a single line of input from `stdin` in raw mode without echoing characters. */
function readSecretRaw(stdin: NodeJS.ReadStream): Promise<string> {
  return new Promise((resolve, reject) => {
    const wasRaw = stdin.isRaw === true;
    const setRaw = stdin.setRawMode;
    if (typeof setRaw !== 'function') {
      reject(new Error('stdin has no setRawMode — refusing to read a secret in echoed mode.'));
      return;
    }

    setRaw.call(stdin, true);
    stdin.resume();

    let buffer = '';
    const cleanup = (): void => {
      stdin.removeListener('data', onData);
      // Restore the original raw state; safe to call even if the value didn't actually change.
      setRaw.call(stdin, wasRaw);
    };

    const onData = (chunk: Buffer): void => {
      for (const byte of chunk) {
        // Ctrl-C — abort the whole CLI cleanly.
        if (byte === 0x03) {
          cleanup();
          process.stdout.write('\n');
          process.exit(130);
          return;
        }
        // Enter (CR or LF) or Ctrl-D — submit the answer.
        if (byte === 0x0a || byte === 0x0d || byte === 0x04) {
          cleanup();
          process.stdout.write('\n');
          resolve(buffer);
          return;
        }
        // Backspace / Delete — remove the last byte from the buffer.
        if (byte === 0x7f || byte === 0x08) {
          buffer = buffer.slice(0, -1);
          continue;
        }
        // Printable byte — accumulate. We accept full UTF-8 sequences too; multi-byte
        // characters arrive as their constituent bytes within a single chunk, and
        // String.fromCharCode reads them as latin-1 which preserves them losslessly
        // for storage. Most secrets are ASCII anyway.
        if (byte >= 0x20) {
          buffer += String.fromCharCode(byte);
        }
      }
    };

    stdin.on('data', onData);
  });
}

export interface PromptIo {
  ask(question: string): Promise<string>;
  askSecret(question: string): Promise<string>;
  close?(): void;
}
