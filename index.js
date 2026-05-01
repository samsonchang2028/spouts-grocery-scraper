import 'dotenv/config';
import cron from 'node-cron';
import { scrape } from './stores/sprouts.js';
import { normalize, parsePrice } from './utils/normalize.js';
import supabase from './utils/supabase.js';

/**
 * Main scraping orchestrator.
 * - Calls scrape() to get raw products from Sprouts
 * - Normalizes names and parses prices
 * - Upserts products table (case-insensitive dedup)
 * - Inserts price records into prices table
 * - Logs a run summary
 *
 * Requirements: 5.1–5.4, 6.1–6.3, 7.1, 10.1–10.3
 */
export async function runScrape() {
    try {
        console.log('[scraper] Starting Sprouts scrape run...');

        const rawProducts = await scrape();

        let insertedCount = 0;
        let newProductsCount = 0;

        for (const raw of rawProducts) {
            const normalizedName = normalize(raw.name);
            const price = parsePrice(raw.price);
            const originalPrice = raw.originalPrice ? parsePrice(raw.originalPrice) : null;

            // Skip if price is unparseable (Requirement 6.3)
            if (price === null) {
                console.warn(`[scraper] Skipping price record for "${normalizedName}": unparseable price "${raw.price}"`);
                continue;
            }

            // Skip if name is empty after normalization
            if (!normalizedName) {
                console.warn(`[scraper] Skipping product with empty name after normalization`);
                continue;
            }

            // Upsert product — case-insensitive lookup (Requirements 5.1–5.4)
            let productId;
            const { data: existing, error: lookupError } = await supabase
                .from('products')
                .select('id')
                .ilike('name', normalizedName)
                .maybeSingle();

            if (lookupError) {
                console.error(`[scraper] DB lookup error for "${normalizedName}":`, lookupError.message);
                continue;
            }

            if (existing) {
                productId = existing.id;
            } else {
                const { data: inserted, error: insertError } = await supabase
                    .from('products')
                    .insert({ name: normalizedName })
                    .select('id')
                    .single();

                if (insertError) {
                    console.error(`[scraper] Failed to insert product "${normalizedName}":`, insertError.message);
                    continue;
                }

                productId = inserted.id;
                newProductsCount++;
            }

            // Insert price record (Requirements 6.1, 6.2, 10.1–10.3)
            const { error: priceError } = await supabase.from('prices').insert({
                product_id: productId,
                store_id: process.env.SPROUTS_STORE_ID,
                price: price,
                original_price: originalPrice,
                scraped_at: new Date().toISOString(),
                source_url: raw.sourceUrl,
            });

            if (priceError) {
                console.error(`[scraper] Failed to insert price for "${normalizedName}":`, priceError.message);
                continue;
            }

            insertedCount++;
        }

        // Requirement 7.1 — run summary log
        console.log(`Sprouts: ${insertedCount} items scraped, ${newProductsCount} new products added`);
    } catch (err) {
        // Requirement 8.4 — log errors without re-throwing so cron stays alive
        console.error('[scraper] Unhandled error during scrape run:', err.message);
    }
}

// Requirement 8.1 — register daily cron at 06:00
cron.schedule('0 6 * * *', () => runScrape().catch(console.error));

// Requirement 8.2 — immediate run on startup
runScrape().catch(console.error);
