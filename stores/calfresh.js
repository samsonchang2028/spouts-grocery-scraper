import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';

chromium.use(StealthPlugin());

const USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0',
];

const SOURCE_URL = 'https://www.californiafresh.market/';

function randomUserAgent() {
    return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

/**
 * Scrapes the California Fresh Market weekly ad page.
 * Returns whatever products are featured that week — not a fixed list.
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
        console.error('[calfresh] Failed to launch browser:', err.message);
        throw err;
    }

    try {
        const context = await browser.newContext({ userAgent: randomUserAgent() });
        const page = await context.newPage();

        await page.goto(SOURCE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });

        // Wait for product loop items to render
        await page.waitForSelector('.e-loop-item', { timeout: 15000 }).catch(() => null);
        await page.waitForTimeout(2000);

        const products = await page.evaluate((sourceUrl) => {
            const results = [];

            document.querySelectorAll('.e-loop-item').forEach((card) => {
                const nameEl = card.querySelector('h2.elementor-heading-title, h3.elementor-heading-title');
                const name = nameEl?.textContent?.trim() || '';

                const priceEl = card.querySelector('span.redPrice');
                if (!priceEl) return;

                // Build price string from currency + amount spans
                const currency = priceEl.querySelector('.currency')?.textContent?.trim() || '$';
                const amount = priceEl.querySelector('.amount')?.textContent?.trim() || '';
                const price = amount ? `${currency}${amount}` : priceEl.textContent.trim();

                if (name && price) {
                    results.push({ name, price, originalPrice: null, sourceUrl });
                }
            });

            return results;
        }, SOURCE_URL);

        if (products.length === 0) {
            console.warn('[calfresh] No products found on weekly ad page');
        } else {
            console.log(`[calfresh] Weekly ad → ${products.length} product(s) found`);
        }

        return products;
    } finally {
        if (browser) await browser.close();
    }
}
