import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';

chromium.use(StealthPlugin());

const WEEKLY_AD_URL = 'https://flipp.com/en-us/san-luis-obispo-ca/weekly_ad/7916814-grocery-outlet-weekly?postal_code=93401';
const MERCHANT_ID = 2906;

export async function scrape() {
    let browser;
    try {
        browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    } catch (err) {
        console.error('[groceryoutlet] Failed to launch browser:', err.message);
        throw err;
    }

    try {
        const context = await browser.newContext({
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        });
        const page = await context.newPage();

        let flyerId = null;
        let flyerRunId = null;

        await page.route('**/*', async (route, request) => {
            if (request.url().includes('wishabi.com') || request.url().includes('onelink.me')) {
                await route.abort();
                return;
            }
            try {
                const response = await route.fetch();
                const ct = response.headers()['content-type'] || '';
                if (ct.includes('json') && request.url().includes('flippenterprise.net/api/flipp/data')) {
                    const body = await response.json().catch(() => null);
                    const flyer = body?.flyers?.find(f => f.merchant_id === MERCHANT_ID) ?? body?.flyers?.[0];
                    if (flyer) {
                        flyerId = flyer.id;
                        flyerRunId = flyer.flyer_run_id;
                    }
                }
                await route.fulfill({ response });
            } catch (_) {
                await route.abort();
            }
        });

        // Step 1: get current flyer ID from flipp/data
        await page.goto(WEEKLY_AD_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForTimeout(5000);

        if (!flyerId) {
            console.warn('[groceryoutlet] Could not find flyer ID');
            return [];
        }

        console.log(`[groceryoutlet] flyer_id=${flyerId} flyer_run_id=${flyerRunId}`);

        // Step 2: try Flipp's mobile backend endpoints for flyer items
        const endpoints = [
            `https://backflipp.wishabi.com/flipp/flyers/${flyerId}/flyer_items`,
            `https://backflipp.wishabi.com/flipp/flyer_items?flyer_id=${flyerId}`,
            `https://backflipp.wishabi.com/flipp/flyers/${flyerId}/items`,
            `https://backflipp.wishabi.com/flipp/items/search?flyer_id=${flyerId}&postal_code=93401&locale=en-us`,
            `https://cdn-gateflipp.flippback.com/bf/flipp/flyers/${flyerId}/flyer_items`,
            `https://gateflipp.flippback.com/bf/flipp/flyers/${flyerId}/flyer_items`,
        ];

        let rawItems = null;
        let workingEndpoint = null;
        for (const url of endpoints) {
            try {
                const res = await page.request.get(url, {
                    headers: { 'Accept': 'application/json' },
                    timeout: 10000,
                });
                const status = res.status();
                if (status === 200) {
                    const body = await res.json().catch(() => null);
                    const arr = Array.isArray(body) ? body : body?.flyer_items ?? body?.items;
                    if (arr && arr.length > 0) {
                        console.log(`[groceryoutlet] ✓ ${url} → ${arr.length} items`);
                        console.log('[groceryoutlet] sample keys:', Object.keys(arr[0]));
                        rawItems = arr;
                        workingEndpoint = url;
                        break;
                    } else {
                        console.log(`[groceryoutlet] ✗ ${url} → empty`);
                    }
                } else {
                    console.log(`[groceryoutlet] ✗ ${url} → ${status}`);
                }
            } catch (e) {
                console.log(`[groceryoutlet] ✗ ${url} → ${e.message}`);
            }
        }

        if (!rawItems) {
            console.warn('[groceryoutlet] No endpoint returned items');
            return [];
        }

        // Step 3: map items → products
        const products = [];
        const seen = new Set();
        for (const item of rawItems) {
            const name = item.name || item.description || item.title || '';
            if (!name || seen.has(name)) continue;
            seen.add(name);

            let price = item.price_text || item.current_price || '';
            if (!price && item.price != null) price = `$${Number(item.price).toFixed(2)}`;
            if (!price && item.current_price_text) price = item.current_price_text;
            if (!price && item.item_current_price != null) price = `$${Number(item.item_current_price).toFixed(2)}`;
            if (!price) continue;

            let originalPrice = null;
            if (item.original_price != null) originalPrice = `$${Number(item.original_price).toFixed(2)}`;
            else if (item.item_original_price != null) originalPrice = `$${Number(item.item_original_price).toFixed(2)}`;

            products.push({ name, price, originalPrice, sourceUrl: workingEndpoint });
        }

        console.log(`[groceryoutlet] Weekly ad → ${products.length} product(s) found`);
        return products;
    } finally {
        if (browser) await browser.close();
    }
}
