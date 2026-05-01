import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';

// Apply stealth plugin to avoid bot detection
chromium.use(StealthPlugin());

/**
 * The fixed set of 15 grocery items to search for on Sprouts.
 * Requirements: 3.1, 3.2
 */
export const TARGET_LIST = [
    'eggs',
    'whole milk'
];

const USER_AGENT =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const BASE_URL = 'https://shop.sprouts.com';

/**
 * Waits a random delay between min and max milliseconds.
 */
function randomDelay(min = 2000, max = 3000) {
    const ms = Math.floor(Math.random() * (max - min + 1)) + min;
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Extracts RawProduct objects from Instacart GraphQL Items responses.
 *
 * @param {object[]} itemsResponses - Array of parsed Items GraphQL response bodies
 * @param {string} sourceUrl - The search URL used
 * @returns {Array<{name, price, originalPrice, sourceUrl}>}
 */
function extractProducts(itemsResponses, sourceUrl) {
    const products = [];
    for (const response of itemsResponses) {
        const items = response?.data?.items;
        if (!Array.isArray(items)) continue;
        for (const item of items) {
            const name = item.name || '';

            // Price data lives at item.price.viewSection.itemCard
            const itemCard = item?.price?.viewSection?.itemCard;
            // priceString: current (possibly sale) price e.g. "$6.99"
            const price = itemCard?.priceString || '';
            // plainFullPriceString: original price when on sale e.g. "$7.99", null otherwise
            const originalPrice = itemCard?.plainFullPriceString || null;

            const itemUrl = item.evergreenUrl
                ? `${BASE_URL}/store/sprouts/products/${item.evergreenUrl}`
                : sourceUrl;

            if (name && price) {
                products.push({ name, price, originalPrice, sourceUrl: itemUrl });
            }
        }
    }
    return products;
}

/**
 * Launches a stealth Playwright browser, searches shop.sprouts.com for each
 * item in TARGET_LIST by intercepting the Instacart GraphQL API responses,
 * and returns an array of raw product objects.
 *
 * @returns {Promise<Array<{name: string, price: string, originalPrice: string|null, sourceUrl: string}>>}
 */
export async function scrape() {
    let browser;

    try {
        browser = await chromium.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox'],
        });
    } catch (err) {
        console.error('[sprouts] Failed to launch browser:', err.message);
        throw err;
    }

    const results = [];

    try {
        const context = await browser.newContext({ userAgent: USER_AGENT });
        const page = await context.newPage();

        for (let i = 0; i < TARGET_LIST.length; i++) {
            const item = TARGET_LIST[i];
            const searchUrl = `${BASE_URL}/store/sprouts/s?k=${encodeURIComponent(item)}`;

            try {
                const itemsResponses = [];

                // Use route interception — fires synchronously before the response is consumed,
                // so we never miss a response regardless of timing.
                await page.route('**/graphql**', async (route, request) => {
                    const response = await route.fetch();
                    const url = request.url();

                    if (url.includes('operationName=Items')) {
                        try {
                            const body = await response.json().catch(() => null);
                            if (body?.data?.items) {
                                itemsResponses.push(body);
                            }
                        } catch (e) { }
                    }

                    await route.fulfill({ response });
                });

                await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

                // Wait for lazy-loaded Items calls to complete
                await page.waitForTimeout(5000);

                // Remove route handler before next iteration
                await page.unroute('**/graphql**');

                const products = extractProducts(itemsResponses, searchUrl);

                if (products.length === 0) {
                    console.warn(`[sprouts] No products found for "${item}"`);
                } else {
                    results.push(...products);
                    console.log(`[sprouts] "${item}" → ${products.length} product(s) found`);
                }
            } catch (err) {
                console.warn(`[sprouts] Error processing "${item}": ${err.message}`);
                // Clean up route handler on error
                await page.unroute('**/graphql**').catch(() => { });
            }

            // Random delay between requests (skip after last item)
            if (i < TARGET_LIST.length - 1) {
                await randomDelay(2000, 3000);
            }
        }
    } finally {
        if (browser) {
            await browser.close();
        }
    }

    return results;
}
