# Project Memory — SLO Grocery Scraper

A running log of bugs encountered, root causes, and fixes applied. Useful context for future debugging and development.

---

## [2026-05-01] Scraper returning no products — wrong URL and DOM approach

### Symptom

Running `npm start` produced timeout errors for every item:

```
page.waitForSelector: Timeout 15000ms exceeded.
Call log: waiting for '[data-testid="product-card"], .product-card, [class*="ProductCard"]' to be visible
```

After several timeouts, subsequent items failed with:

```
page.goto: Target page, context or browser has been closed
```

### Root Cause

Two compounding problems:

**1. Wrong URL**

The scraper was navigating to `https://www.sprouts.com/search?query=<item>`. This is a WordPress-powered marketing site that returns a **"Page not found" 404** in headless mode. It does not serve product search results to automated browsers.

The actual Sprouts online shop is at `https://shop.sprouts.com` (powered by Instacart). The correct search URL is:

```
https://shop.sprouts.com/store/sprouts/s?k=<item>
```

**2. Wrong data extraction strategy**

The original scraper tried to find product cards by CSS class selectors (`[data-testid="product-card"]`, `.product-card`, `[class*="ProductCard"]`). The Instacart frontend uses **hashed/obfuscated Emotion CSS class names** (e.g. `e-k4flv3`) that change with every deployment. These selectors will never match reliably.

Product data is not in the initial HTML at all — it is loaded client-side via **GraphQL API calls** after the page renders.

### Fix

Switched from DOM scraping to **GraphQL response interception** using Playwright's `page.route()`.

When `shop.sprouts.com` loads a search page, it fires multiple GraphQL requests to its own `/graphql` endpoint. The relevant ones use `operationName=Items` and return structured product JSON.

**Interception approach:**

```js
await page.route('**/graphql**', async (route, request) => {
    const response = await route.fetch();
    if (request.url().includes('operationName=Items')) {
        const body = await response.json();
        if (body?.data?.items) itemsResponses.push(body);
    }
    await route.fulfill({ response });
});
```

`page.route()` is used instead of `page.on('response')` because route handlers fire **synchronously before the response is consumed**, ensuring no responses are missed regardless of timing.

**Product data path in the GraphQL response:**

```
item.name                                    → product name
item.price.viewSection.itemCard.priceString  → current price e.g. "$6.99"
item.price.viewSection.itemCard.plainFullPriceString → original price if on sale e.g. "$7.99", null otherwise
item.evergreenUrl                            → used to build the product page URL
```

**Source URL pattern:**

```
https://shop.sprouts.com/store/sprouts/products/<evergreenUrl>
```

### Result

After the fix, a single search for "eggs" returns 28 products with correct names, prices, sale prices, and URLs. All 15 target items scrape successfully.

---

## [2026-05-01] `npm start` failing with missing SUPABASE_URL

### Symptom

```
Error: Missing required environment variable: SUPABASE_URL
```

### Root Cause

Node.js does not automatically load `.env` files. The `.env` file existed but its values were never read into `process.env`.

### Fix

Installed `dotenv` and added `import 'dotenv/config'` as the **first line** of `index.js`. This must come before any other imports that read `process.env` (including `utils/supabase.js`).

```js
import 'dotenv/config';  // must be first
import cron from 'node-cron';
// ...
```

---

## Architecture Notes

### Why GraphQL interception instead of DOM scraping

Instacart (which powers `shop.sprouts.com`) uses:
- Server-side rendered HTML with no product data in the initial payload
- Emotion CSS-in-JS with hashed class names that change on every deploy
- Client-side GraphQL queries that load product data after page render

DOM scraping is fragile here. GraphQL interception is stable because:
- The `operationName=Items` query name is a semantic identifier unlikely to change
- The response schema is typed and consistent
- No dependency on CSS class names or DOM structure

### Instacart GraphQL endpoint

```
https://shop.sprouts.com/graphql?operationName=Items&variables=...
```

The `variables` include `shopId`, `zoneId`, and `postalCode` — these are set automatically by the browser session based on the store URL. No manual configuration needed.

### If selectors break in the future

1. Run a diagnostic script that intercepts all JSON responses and logs their URLs
2. Look for `operationName=Items` in the captured URLs
3. Inspect the response JSON for the `data.items` array
4. Check `item.price.viewSection.itemCard` for price fields — if the path changes, update `extractProducts()` in `stores/sprouts.js`

---

## [2026-05-07] Multi-store expansion and GitHub Actions setup

### Changes made this session

**Anti-bot improvements to Sprouts scraper (`stores/sprouts.js`)**
- Increased delay between requests from 2–3s to 8–15s (random)
- Added rotating user agents (5 different browser signatures)
- Switched from a single shared browser context to a **fresh context per item** — each search looks like a new browser session, preventing Sprouts from correlating requests
- Added anti-bot detection logging: distinguishes between "blocked" (detects keywords like `access denied`, `captcha`, `robot`) and "no results found"

**Cron schedule changed to weekly**
- `index.js` cron changed from `0 6 * * *` (daily) to `0 6 * * 0` (every Sunday 6am)
- Added `--run-once` flag: when `node index.js --run-once` is passed, it runs one scrape and exits (used by GitHub Actions)

**Refactored `index.js` for multi-store support**
- `runScrape()` now loops over a `SCRAPERS` array — each entry has `{ name, scrape, storeIdEnv }`
- If a store's env var is not set, it is skipped with a warning rather than crashing
- Adding a new store = one line in the `SCRAPERS` array + a new scraper file

**New scrapers added**

| File | Store | Method |
|---|---|---|
| `stores/smartandfinal.js` | Smart & Final (1321 Johnson Ave, SLO) | Playwright DOM scraping — `article[class*="ProductCard"]`, `h3[class*="ProductCardNameWrapper"]`, `[data-testid*="productCardPricing"]` |
| `stores/calfresh.js` | California Fresh Market (771 E. Foothill Blvd, SLO) | Playwright DOM scraping of weekly ad at `californiafresh.market` — `.e-loop-item`, `h2.elementor-heading-title`, `span.redPrice` |
| `stores/traderjoes.js` | Trader Joe's (3977 S Higuera St, SLO) | Playwright DOM scraping — clicks "Products" filter tab first, then scrapes `article[class*="SearchResultCard"]`. Note: TJ's only lists a subset of products on their website, expect sparse results (1–3 per search term) |

**Smart & Final selector notes**
- Confirmed working in test run: 115 items scraped, 115 new products on first run
- Search URL: `https://www.smartandfinal.com/sm/delivery/rsid/913/results?q=<item>`
- Store ID in URL is `913` (SLO location)
- Sale price shown as `was $X.XX` text inside the pricing container

**California Fresh Market notes**
- No product search — scrapes the weekly ad page only
- Products vary week to week — not a consistent 15-item set
- DOM uses Elementor page builder: `.e-loop-item` cards, price in `span.redPrice` with `.currency` and `.amount` child spans

**Trader Joe's notes**
- Search URL: `https://www.traderjoes.com/home/search?q=<item>&global=yes`
- Search returns 100+ results mixing products, recipes, and other content
- Must click the "Products" filter tab to isolate actual products
- TJ's intentionally does not list all products online — sparse coverage expected

**GitHub Actions workflow (`.github/workflows/scrape.yml`)**
- Triggers every Sunday at 6am PT (`0 13 * * 0` in UTC)
- Also supports manual trigger via `workflow_dispatch`
- Passes all store ID secrets as env vars — missing secrets are safely skipped

**New env vars added**
```
SMART_AND_FINAL_STORE_ID
CAL_FRESH_STORE_ID
TRADER_JOES_STORE_ID
GROCERY_OUTLET_STORE_ID  (placeholder, scraper not yet built)
```

**Database — no schema changes needed**
- Existing `stores`, `products`, `prices` schema supports multiple stores via `store_id` FK
- New stores seeded via SQL `INSERT INTO stores` — UUIDs added to `.env`

**Files added/modified**
- `stores/smartandfinal.js` — new
- `stores/calfresh.js` — new
- `stores/traderjoes.js` — new
- `stores/sprouts.js` — anti-bot improvements
- `index.js` — multi-store refactor, `--run-once` flag, weekly cron
- `.github/workflows/scrape.yml` — new
- `GUIDE.md` — new user-facing setup guide
- `.env.example` — updated with all new store ID vars


---

## [2026-05-07] Grocery Outlet scraper — Flipp weekly ad

### Goal

Build a scraper for Grocery Outlet (1314 Madonna Rd, SLO) using the Flipp weekly ad at `flipp.com`, since Grocery Outlet has no searchable online store.

### What we tried and why it failed

**Attempt 1 — Intercept bulk flyer_items API**

Assumed Flipp would load all flyer items in a single JSON API call on page load (like Sprouts/Instacart does with GraphQL). Intercepted all JSON responses and looked for arrays with `name`/`description` fields.

Result: Only got city/state/merchant listing data from `flippback.com`. No product data.

Root cause: Flipp renders the flyer as a **static image/canvas**. It does NOT bulk-fetch item data on page load.

**Attempt 2 — Fetch flyer_items endpoint directly**

The `flipp/data` response contains `flyer_run_id`. Tried fetching:
```
https://dam.flippenterprise.net/flyer_runs/<flyer_run_id>/flyer_items
```
directly from inside `page.evaluate()`.

Result: 401/403 — the endpoint requires auth tokens that are baked into Flipp's own requests and not accessible without them.

**Attempt 3 — Navigate listing page to find flyer link**

Used `https://flipp.com/en-us/san-luis-obispo-ca/flyers/grocery-outlet?postal_code=93401` as the entry point, tried to find and click the flyer link.

Result: The listing page never triggers the `flipp/data` API call, so we never get the flyer ID. The `a[href*="grocery-outlet"]` selector found nothing.

**Attempt 4 — Navigate directly to weekly ad URL**

Used `https://flipp.com/en-us/san-luis-obispo-ca/weekly_ad/7916814-grocery-outlet-weekly?postal_code=93401`.

Result: This DOES trigger `dam.flippenterprise.net/api/flipp/data` which returns `{ flyers: [{id, flyer_run_id, merchant_id, ...}] }`. Flyer ID confirmed as `7916814`. But still no item data in any intercepted response.

**Crash bug**: `route.fetch()` throws on failed TLS connections (e.g. `wishabi.com` tracking pixels). Fixed by aborting known tracking domains and wrapping all `route.fetch()` calls in try/catch with `route.abort()` on error.

### Current state

The scraper can successfully:
- Navigate to the weekly ad URL
- Intercept `flipp/data` and extract the current flyer ID
- Confirm the page loads correctly (URL stays on the weekly ad page)

The scraper cannot yet:
- Extract product names and prices

### What needs to happen next

Flipp only loads individual item data when a user **clicks** on an item in the flyer image. The popup that appears contains:
- Product name in `h1`/`h2`
- Price in `<flipp-price value="5.99">` (custom element, price is in the `value` attribute)
- Original price possibly in a strikethrough/`[class*="original"]` element

The correct approach (**Option A — click every item**) is:
1. Navigate to the weekly ad URL
2. Wait for the flyer canvas to render
3. Find all clickable item elements (selector TBD — need to inspect DOM)
4. Click each one, wait for `flipp-dialog` popup, extract name + price
5. Press Escape to close, move to next item

The blocker is identifying the correct CSS selector for clickable items on the flyer. The DOM inspection step was not completed before the session ended.

### Key technical facts for next session

- Working weekly ad URL: `https://flipp.com/en-us/san-luis-obispo-ca/weekly_ad/7916814-grocery-outlet-weekly?postal_code=93401` (ID `7916814` may expire — refresh weekly)
- `flipp/data` API: `https://dam.flippenterprise.net/api/flipp/data?locale=en&postal_code=93401&sid=<session>`
- Grocery Outlet merchant ID in Flipp: `2906`
- Flyer run ID (current week): `1206408`
- Must abort `wishabi.com` and `onelink.me` in route handler to prevent crashes
- Use `route.fetch()` interception, not `page.on('response')` — the latter fires too late
- `GROCERY_OUTLET_STORE_ID=eefcee75-d1f4-49c3-8a40-c59982d72287` is set in `.env`
- Store seeded: `INSERT INTO stores (name, address) VALUES ('Grocery Outlet', '1314 Madonna Rd, San Luis Obispo, CA 93405')`
- `stores/groceryoutlet.js` exists and is registered in `index.js` SCRAPERS array

### To debug item selectors

Add this to the scraper after navigating to the flyer page and waiting:

```js
const info = await page.evaluate(() => {
    const selectors = ['a[href*="/item/"]', '[data-item-id]', '[class*="flyer-item"]', '[role="button"]'];
    return selectors.map(sel => ({
        sel,
        count: document.querySelectorAll(sel).length,
        sample: document.querySelector(sel)?.outerHTML?.slice(0, 200),
    })).filter(r => r.count > 0);
});
console.log(JSON.stringify(info, null, 2));
```
