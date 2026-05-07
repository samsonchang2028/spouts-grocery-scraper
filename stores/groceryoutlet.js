import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';

chromium.use(StealthPlugin());

const LISTING_URL = 'https://flipp.com/en-us/san-luis-obispo-ca/flyers/grocery-outlet?postal_code=93401';
const MERCHANT_ID = 2906;

const USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
];

function randomUserAgent() {
    return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

export async function scrape() {
    let browser;
    try {
        browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    } catch (err) {
        console.error('[groceryoutlet] Failed to launch browser:', err.message);
        throw err;
    }

    try {
        const context = await browser.newContext({ userAgent: randomUserAgent() });
        const page = await context.newPage();

        // Abort tracking to avoid crashes
        await page.route('**/*', async (route, request) => {
            if (request.url().includes('wishabi.com') || request.url().includes('onelink.me')) {
                await route.abort();
            } else {
                await route.continue();
            }
        });

        // Step 1: get current flyer ID from listing page
        let flyerId = null;
        page.on('response', async (response) => {
            if (!response.url().includes('flippenterprise.net/api/flipp/data')) return;
            try {
                const body = await response.json();
                const flyer = body?.flyers?.find(f => f.merchant_id === MERCHANT_ID) ?? body?.flyers?.[0];
                if (flyer?.id) flyerId = flyer.id;
            } catch (_) {}
        });

        await page.goto(LISTING_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForTimeout(4000);

        if (!flyerId) {
            console.warn('[groceryoutlet] Could not find current flyer ID');
            return [];
        }

        const flyerUrl = `https://flipp.com/en-us/san-luis-obispo-ca/weekly_ad/${flyerId}-grocery-outlet-weekly?postal_code=93401`;
        console.log(`[groceryoutlet] Loading flyer: ${flyerUrl}`);
        await page.goto(flyerUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForTimeout(4000);

        // Step 2: find all clickable item elements on the flyer
        const itemSelector = '[data-type="item"], [class*="flyer-item"], [itemid]';
        await page.waitForSelector(itemSelector, { timeout: 15000 }).catch(() => null);
        const itemCount = await page.locator(itemSelector).count();
        console.log(`[groceryoutlet] Found ${itemCount} items to click`);

        const products = [];
        const seen = new Set();

        for (let i = 0; i < itemCount; i++) {
            try {
                const items = page.locator(itemSelector);
                await items.nth(i).click({ timeout: 5000 });

                // Wait for popup
                await page.waitForSelector('flipp-dialog, [class*="flyer-item-dialog"], [class*="slideable"]', { timeout: 5000 });
                await page.waitForTimeout(500);

                const data = await page.evaluate(() => {
                    const dialog = document.querySelector('flipp-dialog, [class*="flyer-item-dialog"]');
                    if (!dialog) return null;

                    const name = dialog.querySelector('h1, h2, [class*="title"]')?.textContent?.trim() || '';
                    const priceEl = dialog.querySelector('flipp-price');
                    const price = priceEl ? `$${priceEl.getAttribute('value')}` : '';
                    const originalPriceEl = dialog.querySelector('[class*="original"], [class*="was"], s');
                    const originalPrice = originalPriceEl?.textContent?.trim() || null;

                    return name && price ? { name, price, originalPrice } : null;
                });

                if (data && !seen.has(data.name)) {
                    seen.add(data.name);
                    products.push({ ...data, sourceUrl: flyerUrl });
                }

                // Close popup with Escape
                await page.keyboard.press('Escape');
                await page.waitForTimeout(300);
            } catch (_) {
                // Item not clickable or popup didn't appear — skip
            }
        }

        console.log(`[groceryoutlet] Weekly ad → ${products.length} product(s) found`);
        return products;
    } finally {
        if (browser) await browser.close();
    }
}
