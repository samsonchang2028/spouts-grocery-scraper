import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { normalize, parsePrice } from '../utils/normalize.js';

// ─── normalize: Unit Tests ────────────────────────────────────────────────────

describe('normalize — unit tests', () => {
    it('returns empty string for empty input', () => {
        expect(normalize('')).toBe('');
    });

    it('trims and lowercases a padded mixed-case name', () => {
        expect(normalize('  Organic Baby Spinach  ')).toBe('organic baby spinach');
    });

    it('lowercases and removes trailing punctuation', () => {
        expect(normalize('Cheddar-Cheese!')).toBe('cheddar-cheese');
    });

    it('collapses multiple spaces into one', () => {
        expect(normalize('whole   milk')).toBe('whole milk');
    });

    it('removes special characters but keeps hyphens', () => {
        // '(', ')', '&', '!' are stripped; multiple spaces collapse to single space
        expect(normalize('free-range (eggs) & more!')).toBe('free-range eggs more');
    });
});

// ─── normalize: Property-Based Tests ─────────────────────────────────────────

describe('normalize — property tests', () => {
    // Feature: slo-grocery-scraper, Property 1: Normalization is idempotent
    it('Property 1: normalization is idempotent', () => {
        fc.assert(
            fc.property(fc.string(), (s) => {
                expect(normalize(normalize(s))).toBe(normalize(s));
            }),
            { numRuns: 100 }
        );
    });

    // Feature: slo-grocery-scraper, Property 2: Normalization produces lowercase output
    it('Property 2: normalization produces lowercase output', () => {
        fc.assert(
            fc.property(fc.string(), (s) => {
                const result = normalize(s);
                expect(result).toBe(result.toLowerCase());
            }),
            { numRuns: 100 }
        );
    });

    // Feature: slo-grocery-scraper, Property 3: Normalization trims whitespace
    it('Property 3: normalization trims whitespace', () => {
        fc.assert(
            fc.property(
                fc.string().map((s) => '   ' + s + '   '),
                (s) => {
                    const result = normalize(s);
                    expect(result).toBe(result.trim());
                }
            ),
            { numRuns: 100 }
        );
    });

    // Feature: slo-grocery-scraper, Property 4: Normalization removes special characters
    it('Property 4: normalization removes special characters', () => {
        fc.assert(
            fc.property(fc.string(), (s) => {
                const result = normalize(s);
                expect(result).toMatch(/^[a-z0-9 \-]*$/);
            }),
            { numRuns: 100 }
        );
    });
});

// ─── parsePrice: Unit Tests ───────────────────────────────────────────────────

describe('parsePrice — unit tests', () => {
    it('parses "$3.99" to 3.99', () => {
        expect(parsePrice('$3.99')).toBe(3.99);
    });

    it('returns null for "abc"', () => {
        expect(parsePrice('abc')).toBeNull();
    });

    it('returns null for empty string', () => {
        expect(parsePrice('')).toBeNull();
    });

    it('parses "$0.00" to 0', () => {
        expect(parsePrice('$0.00')).toBe(0);
    });

    it('parses "12.5" to 12.5', () => {
        expect(parsePrice('12.5')).toBe(12.5);
    });
});

// ─── parsePrice: Property-Based Tests ────────────────────────────────────────

describe('parsePrice — property tests', () => {
    // Feature: slo-grocery-scraper, Property 5: parsePrice returns a valid decimal for valid price strings
    it('Property 5: parsePrice returns a valid decimal for valid price strings', () => {
        fc.assert(
            fc.property(
                fc.float({ min: 0, max: 9999, noNaN: true, noDefaultInfinity: true }).map((n) => {
                    const rounded = Math.round(n * 100) / 100;
                    return `$${rounded.toFixed(2)}`;
                }),
                (priceStr) => {
                    const result = parsePrice(priceStr);
                    expect(result).not.toBeNull();
                    expect(Number.isFinite(result)).toBe(true);
                    expect(Math.round(result * 100) / 100).toBe(result);
                }
            ),
            { numRuns: 100 }
        );
    });

    // Feature: slo-grocery-scraper, Property 6: parsePrice returns null for invalid price strings
    it('Property 6: parsePrice returns null for invalid price strings', () => {
        fc.assert(
            fc.property(
                fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz'.split('')), { minLength: 1 }),
                (alphaStr) => {
                    expect(parsePrice(alphaStr)).toBeNull();
                }
            ),
            { numRuns: 100 }
        );
    });
});
