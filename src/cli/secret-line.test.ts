import { describe, expect, it } from 'vitest';
import { SecretLineBuffer } from './secret-line.js';

function type(buf: SecretLineBuffer, text: string): void {
  for (const byte of Buffer.from(text, 'utf8')) buf.push(byte);
}

describe('SecretLineBuffer', () => {
  it('decodes multi-byte UTF-8 typed as separate bytes', () => {
    const buf = new SecretLineBuffer();
    type(buf, 'pässwörd');
    expect(buf.toString()).toBe('pässwörd');
  });

  it('backspace removes a whole code point, not one byte', () => {
    const buf = new SecretLineBuffer();
    type(buf, 'aé');
    buf.backspace();
    expect(buf.toString()).toBe('a');
    type(buf, '😀');
    buf.backspace();
    expect(buf.toString()).toBe('a');
    buf.backspace();
    expect(buf.toString()).toBe('');
  });

  it('backspace on an empty buffer is a no-op', () => {
    const buf = new SecretLineBuffer();
    expect(() => buf.backspace()).not.toThrow();
    expect(buf.length).toBe(0);
  });
});
