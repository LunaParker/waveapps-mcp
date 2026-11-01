/** Bytes typed at a hidden prompt, decoded as UTF-8 once; backspace drops a whole code point. */
export class SecretLineBuffer {
  private readonly bytes: number[] = [];

  push(byte: number): void {
    this.bytes.push(byte);
  }

  backspace(): void {
    // Pop continuation bytes (10xxxxxx) until the lead byte of the last code point goes too.
    while (this.bytes.length > 0) {
      const b = this.bytes.pop() as number;
      if ((b & 0xc0) !== 0x80) break;
    }
  }

  get length(): number {
    return this.bytes.length;
  }

  toString(): string {
    return Buffer.from(this.bytes).toString('utf8');
  }
}
