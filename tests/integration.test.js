/**
 * Integration tests for database upsert and price insertion.
 *
 * These tests require a live Supabase instance with the following env vars set:
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   SPROUTS_STORE_ID  (UUID of the pre-seeded Sprouts store row)
 *
 * The tests clean up after themselves by deleting inserted rows.
 * Run with: npx vitest run tests/integration.test.js
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { parsePrice } from '../utils/normalize.js';

// Skip all integration tests if env vars are not set
const hasEnv =
    process.env.SUPABASE_URL &&
    process.env.SUPABASE_SERVICE_ROLE_KEY &&
    process.env.SPROUTS_STORE_ID;

const describeIf = hasEnv ? describe : describe.skip;

// Lazy-load supabase only when env vars are present to avoid startup throw
let supabase;
if (hasEnv) {
    const mod = await import('../utils/supabase.js');
    supabase = mod.default;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Upserts a product by normalized name. Returns the product UUID.
 * Mirrors the logic in index.js runScrape().
 */
async function upsertProduct(name) {
    const { data: existing } = await supabase
        .from('products')
        .select('id')
        .ilike('name', name)
        .maybeSingle();

    if (existing) return existing.id;

    const { data: inserted, error } = await supabase
        .from('products')
        .insert({ name })
        .select('id')
        .single();

    if (error) throw new Error(`Failed to insert product: ${error.message}`);
    return inserted.id;
}

// ─── Integration Tests ────────────────────────────────────────────────────────

describeIf('Integration — product upsert and price insertion', () => {
    const testProductName = `test-product-${Date.now()}`;
    let insertedProductId;
    let insertedPriceId;

    afterAll(async () => {
        // Clean up: delete price rows first (FK constraint), then product row
        if (insertedPriceId) {
            await supabase.from('prices').delete().eq('id', insertedPriceId);
        }
        if (insertedProductId) {
            await supabase.from('products').delete().eq('id', insertedProductId);
        }
    });

    // Feature: slo-grocery-scraper, Property 7: Product upsert idempotency
    it('Property 7: product upsert is idempotent — same name twice yields one row and stable UUID', async () => {
        // First upsert
        const id1 = await upsertProduct(testProductName);
        insertedProductId = id1;

        // Second upsert with different casing
        const id2 = await upsertProduct(testProductName.toUpperCase());

        // Both calls must return the same UUID
        expect(id1).toBe(id2);

        // Exactly one row should exist in products for this name
        const { data: rows, error } = await supabase
            .from('products')
            .select('id')
            .ilike('name', testProductName);

        expect(error).toBeNull();
        expect(rows).toHaveLength(1);
        expect(rows[0].id).toBe(id1);
    });

    // Feature: slo-grocery-scraper, Property 8: Price records contain all required fields with correct types
    it('Property 8: price record contains all required fields with correct types', async () => {
        const rawPrice = '$4.99';
        const rawOriginalPrice = '$6.49';
        const sourceUrl = 'https://www.sprouts.com/search?query=test';
        const scrapedAt = new Date().toISOString();

        const parsedPrice = parsePrice(rawPrice);
        const parsedOriginalPrice = parsePrice(rawOriginalPrice);

        // Ensure product exists
        const productId = insertedProductId || (await upsertProduct(testProductName));
        insertedProductId = productId;

        // Insert price record
        const { data: priceRow, error: insertError } = await supabase
            .from('prices')
            .insert({
                product_id: productId,
                store_id: process.env.SPROUTS_STORE_ID,
                price: parsedPrice,
                original_price: parsedOriginalPrice,
                scraped_at: scrapedAt,
                source_url: sourceUrl,
            })
            .select()
            .single();

        expect(insertError).toBeNull();
        insertedPriceId = priceRow.id;

        // Query it back and assert all fields
        const { data: fetched, error: fetchError } = await supabase
            .from('prices')
            .select('*')
            .eq('id', priceRow.id)
            .single();

        expect(fetchError).toBeNull();

        // product_id is a valid UUID referencing the product we inserted
        expect(fetched.product_id).toBe(productId);
        expect(fetched.product_id).toMatch(
            /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
        );

        // store_id matches the Sprouts store UUID
        expect(fetched.store_id).toBe(process.env.SPROUTS_STORE_ID);
        expect(fetched.store_id).toMatch(
            /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
        );

        // price equals parsePrice(rawPrice)
        expect(Number(fetched.price)).toBe(parsedPrice);

        // original_price is a valid decimal
        expect(Number(fetched.original_price)).toBe(parsedOriginalPrice);
        expect(Math.round(Number(fetched.original_price) * 100) / 100).toBe(
            Number(fetched.original_price)
        );

        // scraped_at is a timezone-aware timestamp (ISO 8601 with timezone info)
        expect(fetched.scraped_at).toBeTruthy();
        const parsedDate = new Date(fetched.scraped_at);
        expect(parsedDate.toString()).not.toBe('Invalid Date');

        // source_url is non-empty
        expect(fetched.source_url).toBeTruthy();
        expect(fetched.source_url.length).toBeGreaterThan(0);
    });
});
