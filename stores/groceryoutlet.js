import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';

chromium.use(StealthPlugin());

const WEEKLY_AD_URL = 'https://flipp.com/en-us/san-luis-obispo-ca/weekly_ad/7916814-grocery-outlet-weekly?postal_code=93401';
const MERCHANT_ID = 2906;

export async function scrape() {
    let browser;
    try {
        // Non-headless — Flipp detects headless and serves an error page.
        // Use headless: 'new' if available, otherwise run visibly.
        browser = await chromium.launch({
            headless: false,
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled'],
        });
    } catch (err) {
        console.error('[groceryoutlet] Failed to launch browser:', err.message);
        throw err;
    }

    try {
        const context = await browser.newContext({
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            viewport: { width: 1920, height: 1080 },
        });
        const page = await context.newPage();

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
                    if (flyer?.flyer_run_id) flyerRunId = flyer.flyer_run_id;
                }
                await route.fulfill({ response });
            } catch (_) {
                await route.abort();
            }
        });

        await page.goto(WEEKLY_AD_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForTimeout(6000);

        if (!flyerRunId) {
            console.warn('[groceryoutlet] Could not find flyer_run_id');
            return [];
        }

        console.log(`[groceryoutlet] flyer_run_id: ${flyerRunId}`);

        // Use page.request so cookies/headers match the browser context
        const itemsEndpoints = [
            `https://dam.flippenterprise.net/api/flipp/flyer_runs/${flyerRunId}/flyer_items`,
            `https://dam.flippenterprise.net/api/flipp/flyer_items?flyer_run_id=${flyerRunId}`,
            `https://dam.flippenterprise.net/api/flipp/flyers/${flyerRunId}/flyer_items`,
        ];

        let items = null;
        for (const url of itemsEndpoints) {
            const res = await page.request.get(url).catch(() => null);
            if (res && res.ok()) {
                const body = await res.json().catch(() => null);
                const arr = Array.isArray(body) ? body : body?.flyer_items ?? body?.items;
                if (arr && arr.length > 0) {
                    console.log(`[groceryoutlet] Found items via: ${url} (${arr.length})`);
                    items = arr;
                    console.log('[groceryoutlet] sample item keys:', Object.keys(arr[0]));
                    console.log('[groceryoutlet] sample item:', JSON.stringify(arr[0]).slice(0, 500));
                    break;
                }
            } else {
                console.log(`[groceryoutlet] ${url} → ${res?.status() ?? 'network error'}`);
            }
        }

        if (!items) return [];

        const products = [];
        for (const item of items) {
            const name = item.name || item.description || '';
            if (!name) continue;
            let price = item.price_text || item.current_price || '';
            if (!price && item.price != null) price = `$${Number(item.price).toFixed(2)}`;
            if (!price) continue;
            const originalPrice = item.original_price != null ? `$${Number(item.original_price).toFixed(2)}` : null;
            products.push({ name, price, originalPrice, sourceUrl: WEEKLY_AD_URL });
        }

        console.log(`[groceryoutlet] Weekly ad → ${products.length} product(s) found`);
        return products;
    } finally {
        if (browser) await browser.close();
    }
}
