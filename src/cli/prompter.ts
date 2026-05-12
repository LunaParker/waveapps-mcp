import { createInterface, type Interface as ReadlineInterface } from 'node:readline';

interface MutableInterface extends ReadlineInterface {
  _writeToOutput?: (chunk: string) => void;
}

/**
 * Single readline interface that supports both echoed prompts and silent password-style
 * prompts. The previous implementation split these into two factories which fought over
 * stdin (raw-mode + readline don't play nicely when both touch the same stream); this one
 * mutes echo by overriding readline's private `_writeToOutput` for the duration of a
 * secret prompt, so it works whether stdin is a TTY or piped.
 */
export class Prompter {
  private readonly rl: MutableInterface;
  private muted = false;

  constructor() {
    this.rl = createInterface({ input: process.stdin, output: process.stdout }) as MutableInterface;
    const original = this.rl._writeToOutput;
    if (typeof original === 'function') {
      const bound = original.bind(this.rl);
      this.rl._writeToOutput = (chunk: string): void => {
        // While muted, pass through CR/LF/escape sequences so cursor + line breaks
        // still happen, but drop the typed characters so the secret never echoes.
        if (this.muted && !/[\r\n]/.test(chunk)) return;
        bound(chunk);
      };
    }
  }

  ask(question: string): Promise<string> {
    this.muted = false;
    return new Promise((resolve) => this.rl.question(question, resolve));
  }

  askSecret(question: string): Promise<string> {
    return new Promise((resolve) => {
      // Print the question with echo on, then mute typed characters until the answer is in.
      process.stdout.write(question);
      this.muted = true;
      this.rl.question('', (answer) => {
        this.muted = false;
        // readline doesn't echo a newline after a muted answer; add one for visual continuity.
        process.stdout.write('\n');
        resolve(answer);
      });
    });
  }

  close(): void {
    this.rl.close();
  }
}

export interface PromptIo {
  ask(question: string): Promise<string>;
  askSecret(question: string): Promise<string>;
  close?(): void;
}
