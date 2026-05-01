/**
 * Cleans and standardizes a raw product name string.
 * Pure function — no side effects, no I/O.
 *
 * Transformation pipeline (applied in order):
 *   1. Trim leading/trailing whitespace
 *   2. Convert to lowercase
 *   3. Remove characters that are not alphanumeric, spaces, or hyphens
 *   4. Collapse multiple consecutive spaces into one
 *   5. Trim again (in case step 3 left leading/trailing spaces)
 *
 * Idempotent: normalize(normalize(x)) === normalize(x) for all valid inputs.
 *
 * @param {string} raw - Raw product name string
 * @returns {string} Cleaned, normalized product name
 */
export function normalize(raw) {
    return raw
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9 \-]/g, '')
        .replace(/ {2,}/g, ' ')
        .trim();
}

/**
 * Parses a price string into a numeric value rounded to 2 decimal places.
 * Strips all non-numeric characters except '.' before parsing.
 *
 * @param {string} raw - Raw price string, e.g. "$3.99", "3.99", "12.5"
 * @returns {number|null} Parsed price as a number, or null if unparseable
 */
export function parsePrice(raw) {
    if (typeof raw !== 'string') return null;
    const cleaned = raw.replace(/[^0-9.]/g, '');
    const n = parseFloat(cleaned);
    if (isNaN(n)) return null;
    return Math.round(n * 100) / 100;
}
