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
