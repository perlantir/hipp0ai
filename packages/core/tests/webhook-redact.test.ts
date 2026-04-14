/**
 * Phase 15 — webhook bot_token redaction.
 *
 * Ensures that any log-bound string that has leaked a bot_token path,
 * a bot_token query param, or an Authorization bearer value gets scrubbed
 * before we write it to stderr / an error tracker.
 */

import { describe, it, expect } from 'vitest';
import { redactBotToken } from '../src/webhooks/index.js';

describe('redactBotToken', () => {
  it('redacts Telegram bot URL in fetch error messages', () => {
    const err = 'getaddrinfo ENOTFOUND api.telegram.org/bot123456:ABCDEFghijk_XYZ/sendMessage';
    const out = redactBotToken(err);
    expect(out).not.toContain('ABCDEFghijk');
    expect(out).toContain('/bot***REDACTED***');
    expect(out).toContain('api.telegram.org');
  });

  it('redacts bot_token in JSON body leaks', () => {
    const s = '{"bot_token": "987654:SECRETSECRET_abc-def", "chat_id": "42"}';
    const out = redactBotToken(s);
    expect(out).not.toContain('SECRETSECRET');
    expect(out).toContain('"bot_token": "***REDACTED***');
  });

  it('redacts bot-token= variant (dash + equals)', () => {
    const s = 'bot-token=987654:SECRET_abc';
    const out = redactBotToken(s);
    expect(out).not.toContain('SECRET_abc');
  });

  it('redacts bearer tokens in Authorization headers', () => {
    const s = 'authorization: Bearer sk-proj-abcdef123456.tail';
    const out = redactBotToken(s);
    expect(out).not.toContain('sk-proj-abcdef123456');
  });

  it('passes through clean strings untouched', () => {
    const s = 'Connection refused to example.com';
    expect(redactBotToken(s)).toBe(s);
  });

  it('handles empty input', () => {
    expect(redactBotToken('')).toBe('');
  });

  it('redacts multiple occurrences in one string', () => {
    const s = '/bot111:AAA/send failed after /bot222:BBB/send succeeded';
    const out = redactBotToken(s);
    expect(out).not.toContain('AAA');
    expect(out).not.toContain('BBB');
    expect((out.match(/REDACTED/g) || []).length).toBe(2);
  });
});
