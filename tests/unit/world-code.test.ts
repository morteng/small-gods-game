import { describe, it, expect } from 'vitest';
import { encodeWorldCode, decodeWorldCode } from '@/game/world-code';

describe('world-code — encode/decode round trip', () => {
  it('round-trips genSeed/worldSeedName/contentVersion', () => {
    const code = encodeWorldCode({ genSeed: 12345, worldSeedName: 'default', contentVersion: 118 });
    const decoded = decodeWorldCode(code, 118);
    expect(decoded).toEqual({
      ok: true,
      code: { genSeed: 12345, worldSeedName: 'default', contentVersion: 118 },
    });
  });

  it('is a short, uppercase, human-typeable string', () => {
    const code = encodeWorldCode({ genSeed: 12345, worldSeedName: 'woodland', contentVersion: 118 });
    expect(code).toBe(code.toUpperCase());
    expect(code.length).toBeLessThan(20);
    expect(code).toContain('WOODLAND');
  });

  it('is case-insensitive on decode (a pasted lowercase code still works)', () => {
    const code = encodeWorldCode({ genSeed: 999, worldSeedName: 'default', contentVersion: 118 });
    const decoded = decodeWorldCode(code.toLowerCase(), 118);
    expect(decoded.ok).toBe(true);
  });

  it('tolerates surrounding whitespace (a paste often carries it)', () => {
    const code = encodeWorldCode({ genSeed: 1, worldSeedName: 'default', contentVersion: 118 });
    const decoded = decodeWorldCode(`  ${code}\n`, 118);
    expect(decoded.ok).toBe(true);
  });

  it('genSeed 0 round-trips (falsy is not the same as absent)', () => {
    const code = encodeWorldCode({ genSeed: 0, worldSeedName: 'default', contentVersion: 118 });
    const decoded = decodeWorldCode(code, 118);
    expect(decoded).toEqual({ ok: true, code: { genSeed: 0, worldSeedName: 'default', contentVersion: 118 } });
  });

  it('REFUSES a contentVersion mismatch, with the real numbers in the message', () => {
    const code = encodeWorldCode({ genSeed: 12345, worldSeedName: 'default', contentVersion: 117 });
    const decoded = decodeWorldCode(code, 118);
    expect(decoded.ok).toBe(false);
    if (decoded.ok) throw new Error('unreachable');
    expect(decoded.reason).toBe('version-mismatch');
    expect(decoded.message).toContain('117');
    expect(decoded.message).toContain('118');
  });

  it('REFUSES an empty string', () => {
    const decoded = decodeWorldCode('', 118);
    expect(decoded.ok).toBe(false);
    if (decoded.ok) throw new Error('unreachable');
    expect(decoded.reason).toBe('malformed');
  });

  it('REFUSES a malformed code (wrong shape)', () => {
    for (const bad of ['not-a-code', '1.2', '1.2.3.4', '...']) {
      const decoded = decodeWorldCode(bad, 118);
      expect(decoded.ok, `expected "${bad}" to be refused`).toBe(false);
    }
  });

  it('REFUSES a seed/version field with characters outside base36, without throwing', () => {
    // NOTE: base36 covers every [0-9a-z] character, so an alphabetic string
    // like "abc" is actually a VALID base36 numeral, not a good "malformed"
    // fixture — this uses characters outside that alphabet instead.
    const decoded = decodeWorldCode('#.default.#', 118);
    expect(decoded.ok).toBe(false);
  });
});
