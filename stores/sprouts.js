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
    'whole milk',
    'chicken breast',
    'bread',
    'bananas',
];

const USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4.1 Safari/605.1.15',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0',
];

const BASE_URL = 'https://shop.sprouts.com';

function randomDelay(min = 8000, max = 15000) {
    const ms = Math.floor(Math.random() * (max - min + 1)) + min;
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomUserAgent() {
    return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
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
        for (let i = 0; i < TARGET_LIST.length; i++) {
            const item = TARGET_LIST[i];
            const searchUrl = `${BASE_URL}/store/sprouts/s?k=${encodeURIComponent(item)}`;

            // Fresh context per item — each search looks like a new browser session
            const context = await browser.newContext({ userAgent: randomUserAgent() });
            const page = await context.newPage();

            try {
                const itemsResponses = [];

                await page.route('**/graphql**', async (route, request) => {
                    const response = await route.fetch();
                    if (request.url().includes('operationName=Items')) {
                        try {
                            const body = await response.json().catch(() => null);
                            if (body?.data?.items) itemsResponses.push(body);
                        } catch (e) { }
                    }
                    await route.fulfill({ response });
                });

                await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
                await page.waitForTimeout(5000);

                const products = extractProducts(itemsResponses, searchUrl);

                if (products.length === 0) {
                    const title = await page.title().catch(() => '');
                    const bodyText = await page.locator('body').innerText({ timeout: 2000 }).catch(() => '');
                    const blocked = /access denied|robot|captcha|blocked|unusual traffic/i.test(title + bodyText);
                    if (blocked) {
                        console.warn(`[sprouts] BLOCKED (anti-bot) for "${item}" — page title: "${title}"`);
                    } else {
                        console.warn(`[sprouts] No products found for "${item}"`);
                    }
                } else {
                    results.push(...products);
                    console.log(`[sprouts] "${item}" → ${products.length} product(s) found`);
                }
            } catch (err) {
                console.warn(`[sprouts] Error processing "${item}": ${err.message}`);
            } finally {
                await context.close();
            }

            // Long random delay between requests (skip after last item)
            if (i < TARGET_LIST.length - 1) {
                await randomDelay(8000, 15000);
            }
        }
    } finally {
        if (browser) await browser.close();
    }

    return results;
}
