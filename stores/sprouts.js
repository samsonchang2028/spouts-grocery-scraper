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
    'greek yogurt',
    'pasta',
    'canned tomatoes',
    'orange juice',
    'cheddar cheese',
    'butter',
    'rice',
    'baby spinach',
    'ground beef',
    'oat milk',
];

const USER_AGENT =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

/**
 * Waits a random delay between min and max milliseconds.
 * @param {number} min
 * @param {number} max
 * @returns {Promise<void>}
 */
function randomDelay(min = 2000, max = 3000) {
    const ms = Math.floor(Math.random() * (max - min + 1)) + min;
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Launches a stealth Playwright browser, searches Sprouts for each item in
 * TARGET_LIST, and returns an array of raw product objects.
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
            const searchUrl = `https://www.sprouts.com/search?query=${encodeURIComponent(item)}`;

            try {
                await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

                // Wait for product cards to appear in the DOM
                await page.waitForSelector('[data-testid="product-card"], .product-card, [class*="ProductCard"]', {
                    timeout: 15000,
                });

                // Extract product data from all cards on the page
                const products = await page.evaluate((sourceUrl) => {
                    // Try multiple possible selectors for product cards
                    const cardSelectors = [
                        '[data-testid="product-card"]',
                        '.product-card',
                        '[class*="ProductCard"]',
                        '[class*="product-card"]',
                    ];

                    let cards = [];
                    for (const sel of cardSelectors) {
                        const found = document.querySelectorAll(sel);
                        if (found.length > 0) {
                            cards = Array.from(found);
                            break;
                        }
                    }

                    return cards.map((card) => {
                        // Product name
                        const nameEl =
                            card.querySelector('[data-testid="product-name"]') ||
                            card.querySelector('[class*="ProductName"]') ||
                            card.querySelector('[class*="product-name"]') ||
                            card.querySelector('h2') ||
                            card.querySelector('h3') ||
                            card.querySelector('a[href*="/shop/products/"]');
                        const name = nameEl ? nameEl.textContent.trim() : '';

                        // Current (sale) price
                        const priceEl =
                            card.querySelector('[data-testid="product-price"]') ||
                            card.querySelector('[class*="SalePrice"]') ||
                            card.querySelector('[class*="sale-price"]') ||
                            card.querySelector('[class*="CurrentPrice"]') ||
                            card.querySelector('[class*="current-price"]') ||
                            card.querySelector('[aria-label*="price"]') ||
                            card.querySelector('[class*="Price"]');
                        const price = priceEl ? priceEl.textContent.trim() : '';

                        // Original (regular) price — only present when item is on sale
                        const originalPriceEl =
                            card.querySelector('[data-testid="original-price"]') ||
                            card.querySelector('[class*="OriginalPrice"]') ||
                            card.querySelector('[class*="original-price"]') ||
                            card.querySelector('[class*="RegularPrice"]') ||
                            card.querySelector('[class*="regular-price"]') ||
                            card.querySelector('s') ||
                            card.querySelector('del');
                        const originalPrice = originalPriceEl ? originalPriceEl.textContent.trim() : null;

                        return { name, price, originalPrice, sourceUrl };
                    });
                }, searchUrl);

                if (products.length === 0) {
                    console.warn(`[sprouts] No product cards found for "${item}"`);
                } else {
                    // Only push products with a non-empty name
                    const valid = products.filter((p) => p.name);
                    results.push(...valid);
                    console.log(`[sprouts] "${item}" → ${valid.length} product(s) found`);
                }
            } catch (err) {
                console.warn(`[sprouts] Error processing "${item}": ${err.message}`);
            }

            // Random delay between requests (skip delay after last item)
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
