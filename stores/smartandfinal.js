import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';

chromium.use(StealthPlugin());

export const TARGET_LIST = [
    'eggs',
    'whole milk',
    'chicken breast',
    'bread',
];

const USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4.1 Safari/605.1.15',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0',
];

const BASE_URL = 'https://www.smartandfinal.com';
const STORE_ID = '913'; // SLO store

function randomDelay(min = 8000, max = 15000) {
    const ms = Math.floor(Math.random() * (max - min + 1)) + min;
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomUserAgent() {
    return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

/**
 * Launches a stealth Playwright browser, searches Smart & Final for each item
 * in TARGET_LIST by scraping the server-rendered search results page.
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
        console.error('[smartandfinal] Failed to launch browser:', err.message);
        throw err;
    }

    const results = [];

    try {
        for (let i = 0; i < TARGET_LIST.length; i++) {
            const item = TARGET_LIST[i];
            const searchUrl = `${BASE_URL}/sm/delivery/rsid/${STORE_ID}/results?q=${encodeURIComponent(item)}`;

            const context = await browser.newContext({ userAgent: randomUserAgent() });
            const page = await context.newPage();

            try {
                await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

                // Wait for product cards to render
                await page.waitForSelector('article[class*="ProductCard"]', {
                    timeout: 15000,
                }).catch(() => null);

                await page.waitForTimeout(2000);

                const products = await page.evaluate((sourceUrl) => {
                    const results = [];

                    const cards = document.querySelectorAll('article[class*="ProductCard"]');

                    cards.forEach((card) => {
                        const nameEl = card.querySelector('h3[class*="ProductCardNameWrapper"]');
                        const name = (nameEl?.textContent?.trim() || '').replace(/open product description$/i, '').trim();

                        const pricingEl = card.querySelector('[data-testid*="productCardPricing"]');
                        if (!pricingEl) return;

                        // All text nodes in the pricing block — first dollar amount is current price
                        const priceEls = pricingEl.querySelectorAll('[class*="price"], [class*="Price"]');
                        const price = priceEls[0]?.textContent?.trim() || '';

                        // "was $X.XX" text for sale items
                        const wasEl = pricingEl.querySelector('[class*="was"], [class*="Was"], [class*="original"], [class*="Original"]');
                        const originalPrice = wasEl?.textContent?.trim() || null;

                        if (name && price) {
                            results.push({ name, price, originalPrice, sourceUrl });
                        }
                    });

                    return results;
                }, searchUrl);

                if (products.length === 0) {
                    const title = await page.title().catch(() => '');
                    const bodyText = await page.locator('body').innerText({ timeout: 2000 }).catch(() => '');
                    const blocked = /access denied|robot|captcha|blocked|unusual traffic/i.test(title + bodyText);
                    if (blocked) {
                        console.warn(`[smartandfinal] BLOCKED (anti-bot) for "${item}" — page title: "${title}"`);
                    } else {
                        console.warn(`[smartandfinal] No products found for "${item}"`);
                    }
                } else {
                    results.push(...products);
                    console.log(`[smartandfinal] "${item}" → ${products.length} product(s) found`);
                }
            } catch (err) {
                console.warn(`[smartandfinal] Error processing "${item}": ${err.message}`);
            } finally {
                await context.close();
            }

            if (i < TARGET_LIST.length - 1) {
                await randomDelay(8000, 15000);
            }
        }
    } finally {
        if (browser) await browser.close();
    }

    return results;
}
