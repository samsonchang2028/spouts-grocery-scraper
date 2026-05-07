import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';

chromium.use(StealthPlugin());

const MERCHANT_ID = 2906;
// Weekly ad URL — triggers flipp/data API which gives us the current flyer ID
const WEEKLY_AD_URL = 'https://flipp.com/en-us/san-luis-obispo-ca/weekly_ad/7916814-grocery-outlet-weekly?postal_code=93401';

const USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
];

export async function scrape() {
    let browser;
    try {
        browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    } catch (err) {
        console.error('[groceryoutlet] Failed to launch browser:', err.message);
        throw err;
    }

    try {
        const context = await browser.newContext({ userAgent: USER_AGENTS[0] });
        const page = await context.newPage();

        let flyerId = null;

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
                    if (flyer?.id) flyerId = flyer.id;
                }
                await route.fulfill({ response });
            } catch (_) {
                await route.abort();
            }
        });

        await page.goto(WEEKLY_AD_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForTimeout(4000);

        if (!flyerId) {
            console.warn('[groceryoutlet] Could not find flyer ID');
            return [];
        }

        const flyerUrl = `https://flipp.com/en-us/san-luis-obispo-ca/weekly_ad/${flyerId}-grocery-outlet-weekly?postal_code=93401`;
        await page.goto(flyerUrl, { waitUntil: 'networkidle', timeout: 30000 });
        await page.waitForTimeout(3000);

        // Log what's on the page
        const info = await page.evaluate(() => {
            const selectors = [
                '[data-type="item"]', '[itemid]', '[class*="flyer-item"]',
                '[class*="item-"]', 'li[class*="item"]', '[role="button"]',
                'button', 'a[href*="item"]',
            ];
            return selectors.map(sel => ({
                sel,
                count: document.querySelectorAll(sel).length,
                sample: document.querySelector(sel)?.outerHTML?.slice(0, 150),
            })).filter(r => r.count > 0);
        });

        console.log('[groceryoutlet] page elements:', JSON.stringify(info, null, 2));
        return [];
    } finally {
        if (browser) await browser.close();
    }
}
