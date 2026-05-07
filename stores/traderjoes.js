import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';

chromium.use(StealthPlugin());

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

const USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0',
];

const BASE_URL = 'https://www.traderjoes.com';

function randomDelay(min = 8000, max = 15000) {
    const ms = Math.floor(Math.random() * (max - min + 1)) + min;
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomUserAgent() {
    return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

/**
 * Scrapes Trader Joe's search results for each item in TARGET_LIST.
 * Note: TJ's website doesn't list all products — results may be sparse.
 *
 * @returns {Promise<Array<{name: string, price: string, originalPrice: null, sourceUrl: string}>>}
 */
export async function scrape() {
    let browser;

    try {
        browser = await chromium.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox'],
        });
    } catch (err) {
        console.error('[traderjoes] Failed to launch browser:', err.message);
        throw err;
    }

    const results = [];

    try {
        for (let i = 0; i < TARGET_LIST.length; i++) {
            const item = TARGET_LIST[i];
            const searchUrl = `${BASE_URL}/home/search?q=${encodeURIComponent(item)}&global=yes`;

            const context = await browser.newContext({ userAgent: randomUserAgent() });
            const page = await context.newPage();

            try {
                await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

                // Click the "Products" filter tab to show only products, not recipes
                await page.waitForSelector('button[class*="SearchResults_sectionButton"], a[class*="SearchResults_sectionButton"]', {
                    timeout: 10000,
                }).catch(() => null);

                const productsTab = await page.$('button:has-text("Products"), a:has-text("Products")');
                if (productsTab) await productsTab.click();

                await page.waitForSelector('article[class*="SearchResultCard"]', {
                    timeout: 15000,
                }).catch(() => null);

                await page.waitForTimeout(2000);

                const products = await page.evaluate((sourceUrl) => {
                    const results = [];

                    document.querySelectorAll('article[class*="SearchResultCard"]').forEach((card) => {
                        const nameEl = card.querySelector('h3[class*="SearchResultCard_searchResultCard__title"]');
                        const name = nameEl?.textContent?.trim() || '';

                        const priceEl = card.querySelector('span[class*="ProductPrice_productPrice__price"]');
                        const price = priceEl?.textContent?.trim() || '';

                        if (name && price) {
                            results.push({ name, price, originalPrice: null, sourceUrl });
                        }
                    });

                    return results;
                }, searchUrl);

                if (products.length === 0) {
                    const title = await page.title().catch(() => '');
                    const bodyText = await page.locator('body').innerText({ timeout: 2000 }).catch(() => '');
                    const blocked = /access denied|robot|captcha|blocked|unusual traffic/i.test(title + bodyText);
                    if (blocked) {
                        console.warn(`[traderjoes] BLOCKED (anti-bot) for "${item}" — page title: "${title}"`);
                    } else {
                        console.warn(`[traderjoes] No products found for "${item}"`);
                    }
                } else {
                    results.push(...products);
                    console.log(`[traderjoes] "${item}" → ${products.length} product(s) found`);
                }
            } catch (err) {
                console.warn(`[traderjoes] Error processing "${item}": ${err.message}`);
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
