# SLO Grocery Scraper

A Node.js application that runs on a weekly schedule, visits grocery store websites, extracts current prices, and persists the results to a [Supabase](https://supabase.com) (Postgres) database.

Tracking grocery prices across San Luis Obispo stores. Currently scraping:

| Store | Method |
|---|---|
| Sprouts Farmers Market | GraphQL interception (Instacart) |
| Smart & Final | Playwright DOM scraping |
| California Fresh Market | Playwright DOM scraping (weekly ad) |
| Trader Joe's | Playwright DOM scraping |
| Grocery Outlet | Playwright DOM scraping (Flipp weekly ad) — in progress |

---

## How it works

```
Schedule → Scrape → Normalize → Upsert → Log
```

1. **Schedule** — `node-cron` triggers a run every Sunday at 06:00 local time. An additional run fires immediately on startup. Pass `--run-once` to run once and exit (used by GitHub Actions).
2. **Scrape** — Each store scraper runs sequentially. Sprouts uses GraphQL response interception; others use Playwright DOM scraping with stealth anti-detection.
3. **Normalize** — Raw product names are cleaned: trimmed, lowercased, stripped of special characters, collapsed to single spaces.
4. **Upsert** — Each product is looked up in the `products` table with a case-insensitive match. If it doesn't exist, a new row is inserted. Either way, the UUID is used for the price record.
5. **Log** — A summary is printed per store: `<Store>: N items scraped, M new products added`.

If a store's env var is not set, that store is skipped with a warning — the run continues for other stores.

---

## Prerequisites

- Node.js v18 or later
- A Supabase project with the schema below applied
- The `stores` table pre-seeded with a row for each store you want to scrape

---

## Setup

**1. Install dependencies**

```bash
npm install
```

**2. Install Playwright browsers**

```bash
npx playwright install chromium
```

**3. Configure environment variables**

Copy `.env.example` to `.env` and fill in your values:

```bash
cp .env.example .env
```

```dotenv
SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key-here
SPROUTS_STORE_ID=your-sprouts-store-uuid-here
SMART_AND_FINAL_STORE_ID=your-smartandfinal-store-uuid-here
GROCERY_OUTLET_STORE_ID=your-groceryoutlet-store-uuid-here
CAL_FRESH_STORE_ID=your-calfresh-store-uuid-here
TRADER_JOES_STORE_ID=your-traderjoes-store-uuid-here
```

To find a store's UUID after seeding:

```sql
SELECT id, name FROM stores;
```

Only set the env vars for stores you want to scrape. Missing vars are skipped gracefully.

**4. Apply the database schema**

```sql
CREATE TABLE stores (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL,
  address    TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE products (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE prices (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id     UUID NOT NULL REFERENCES products(id),
  store_id       UUID NOT NULL REFERENCES stores(id),
  price          NUMERIC(8,2) NOT NULL,
  original_price NUMERIC(8,2),
  scraped_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  source_url     TEXT
);

-- Seed stores
INSERT INTO stores (name, address) VALUES
  ('Sprouts', '1014 Madonna Rd, San Luis Obispo, CA'),
  ('Smart & Final', '1321 Johnson Ave, San Luis Obispo, CA'),
  ('Grocery Outlet', '1314 Madonna Rd, San Luis Obispo, CA 93405'),
  ('California Fresh Market', '771 E. Foothill Blvd, San Luis Obispo, CA'),
  ('Trader Joe''s', '3977 S Higuera St, San Luis Obispo, CA');
```

---

## Running the scraper

```bash
npm start
# or
node index.js
```

Run once and exit (e.g. for CI):

```bash
node index.js --run-once
```

The process will run one scrape immediately on startup, then stay alive and re-run every Sunday at 06:00.

Expected console output per run:

```
[scraper] Starting Sprouts scrape run...
[sprouts] "eggs" → 28 product(s) found
...
Sprouts: 42 items scraped, 3 new products added
[scraper] Starting Smart & Final scrape run...
...
Smart & Final: 115 items scraped, 0 new products added
```

---

## Project structure

```
.
├── index.js                  # Entry point — orchestrator, cron schedule
├── stores/
│   ├── sprouts.js            # GraphQL interception scraper (Instacart)
│   ├── smartandfinal.js      # DOM scraper
│   ├── calfresh.js           # DOM scraper (weekly ad)
│   ├── traderjoes.js         # DOM scraper
│   └── groceryoutlet.js      # Flipp weekly ad scraper (in progress)
├── utils/
│   ├── normalize.js          # normalize() and parsePrice() pure functions
│   └── supabase.js           # Supabase client with env-var validation
├── tests/
│   ├── normalize.test.js     # Unit + property tests for normalize/parsePrice
│   ├── supabase.test.js      # Unit tests for env-var validation
│   └── integration.test.js   # DB integration tests (requires live Supabase)
├── .github/
│   └── workflows/
│       └── scrape.yml        # GitHub Actions — runs every Sunday at 6am PT
├── .env.example
└── package.json
```

---

## Module reference

### `index.js`

Entry point. Exports `runScrape()` and registers the cron schedule.

**`SCRAPERS`** — Array of store configs. Each entry: `{ name, scrape, storeIdEnv }`. To add a new store, add one entry here and create a scraper file in `stores/`.

**`runScrape()`** — Loops over `SCRAPERS`, skipping any whose env var is unset. For each active store:
- Calls `scrape()` to get raw products
- Normalizes names with `normalize()`
- Parses prices with `parsePrice()` — skips products with unparseable prices
- Upserts each product into `products` (case-insensitive dedup via `.ilike()`)
- Inserts a new row into `prices` for every valid product
- Logs the run summary
- Catches all errors internally so the cron schedule is never interrupted

---

### `stores/sprouts.js`

Scrapes [shop.sprouts.com](https://shop.sprouts.com) via **GraphQL response interception** using `page.route()`. The Instacart frontend loads product data via `operationName=Items` GraphQL queries — DOM scraping is not viable here due to hashed CSS class names.

**Anti-bot measures:** rotating user agents, fresh browser context per item, 8–15s random delay between requests.

**`TARGET_LIST`** — 15 grocery items searched on every run:

| | | | |
|---|---|---|---|
| eggs | whole milk | chicken breast | bread |
| bananas | greek yogurt | pasta | canned tomatoes |
| orange juice | cheddar cheese | butter | rice |
| baby spinach | ground beef | oat milk | |

Returns `Promise<RawProduct[]>`.

---

### `stores/smartandfinal.js`

Scrapes [smartandfinal.com](https://www.smartandfinal.com) using Playwright DOM scraping. Store ID `913` (SLO location). Searches the same 15-item `TARGET_LIST`.

Selectors: `article[class*="ProductCard"]`, `h3[class*="ProductCardNameWrapper"]`, `[data-testid*="productCardPricing"]`.

---

### `stores/calfresh.js`

Scrapes the weekly ad at [californiafresh.market](https://californiafresh.market). Does not search — scrapes all items from the weekly ad page. Products vary week to week.

Selectors: `.e-loop-item` (Elementor cards), `h2.elementor-heading-title`, `span.redPrice`.

---

### `stores/traderjoes.js`

Scrapes [traderjoes.com](https://www.traderjoes.com) using Playwright DOM scraping. Clicks the "Products" filter tab before extracting results. Searches the same 15-item `TARGET_LIST`.

Note: Trader Joe's only lists a subset of products on their website — expect sparse results (1–3 per search term).

Selectors: `article[class*="SearchResultCard"]`.

---

### `stores/groceryoutlet.js`

Scrapes the Grocery Outlet weekly ad via [Flipp](https://flipp.com). **Currently in progress** — navigation and flyer ID extraction work, but item-level data extraction is not yet complete. See MEMORY.md for details.

---

### `utils/normalize.js`

**`normalize(raw: string): string`** — Cleans a raw product name: trim → lowercase → remove non-`[a-z0-9 -]` chars → collapse spaces → trim. Idempotent.

```js
normalize('  Organic Baby Spinach  ')  // → 'organic baby spinach'
normalize('Cheddar-Cheese!')           // → 'cheddar-cheese'
```

**`parsePrice(raw: string): number | null`** — Strips non-numeric characters (except `.`), parses as float, rounds to 2 decimal places. Returns `null` if not a valid number.

```js
parsePrice('$3.99')  // → 3.99
parsePrice('abc')    // → null
```

---

### `utils/supabase.js`

Initializes and exports the Supabase client. Throws at module load time if `SUPABASE_URL` or `SUPABASE_SERVICE_ROLE_KEY` are missing.

---

## Database schema

### `stores` (pre-seeded, read-only for the scraper)

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | Primary key |
| `name` | `text` | e.g. `'Sprouts'` |
| `address` | `text` | Store address |
| `created_at` | `timestamptz` | Auto-set |

### `products` (upserted by scraper)

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | Primary key |
| `name` | `text` | Normalized name, unique |
| `created_at` | `timestamptz` | Auto-set |

### `prices` (append-only, one row per scraped item per run)

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | Primary key |
| `product_id` | `uuid` | FK → `products.id` |
| `store_id` | `uuid` | FK → `stores.id` |
| `price` | `numeric(8,2)` | Current price |
| `original_price` | `numeric(8,2)` | Regular price if on sale, else null |
| `scraped_at` | `timestamptz` | Timestamp of the scrape |
| `source_url` | `text` | Search URL used |

---

## GitHub Actions

The workflow at `.github/workflows/scrape.yml` runs every Sunday at 6:00 AM PT (`0 13 * * 0` UTC) and on manual trigger.

Required repository secrets:
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SPROUTS_STORE_ID`
- `SMART_AND_FINAL_STORE_ID`
- `CAL_FRESH_STORE_ID`
- `TRADER_JOES_STORE_ID`
- `GROCERY_OUTLET_STORE_ID`

Missing secrets are skipped gracefully — you don't need all of them set to run.

---

## Testing

```bash
# Run all unit and property tests
npm test

# Watch mode during development
npm run test:watch

# Run integration tests (requires live Supabase env vars)
npx vitest run tests/integration.test.js
```

### Test coverage

| File | Type | Tests | What it covers |
|---|---|---|---|
| `tests/normalize.test.js` | Unit + Property | 16 | `normalize()` and `parsePrice()` |
| `tests/supabase.test.js` | Unit | 2 | Env-var validation at module load |
| `tests/integration.test.js` | Integration | 2 | DB upsert idempotency, price record fields |

Property-based tests use [fast-check](https://github.com/dubzzz/fast-check) with 100 iterations each. Integration tests auto-skip when Supabase env vars are not set.

---

## Error handling

| Scenario | Behavior |
|---|---|
| Missing env var at startup | Throws immediately, process exits with clear message |
| Store env var not set | Logs warning, skips that store, run continues |
| Browser fails to launch | Logs error, skips run, cron stays alive |
| Item search times out | Logs warning, skips item, run continues |
| No product cards found | Logs warning, skips item, run continues |
| Price string unparseable | Logs warning, skips price insert, run continues |
| DB insert fails | Logs error, skips that record, run continues |
| Unhandled error in cron | Logs error, process stays alive for next scheduled run |

---

## Dependencies

| Package | Version | Purpose |
|---|---|---|
| `playwright` | 1.52.0 | Browser automation |
| `playwright-extra` | 4.3.6 | Plugin system for Playwright |
| `puppeteer-extra-plugin-stealth` | 2.11.2 | Anti-bot-detection evasions |
| `@supabase/supabase-js` | 2.49.4 | Supabase database client |
| `node-cron` | 3.0.3 | Cron scheduling |
| `dotenv` | — | Loads `.env` into `process.env` |
| `fast-check` *(dev)* | 3.23.2 | Property-based testing |
| `vitest` *(dev)* | 3.2.3 | Test runner |

---

## Debugging history

See [MEMORY.md](./MEMORY.md) for a log of bugs encountered and fixes applied, including:

- Why DOM scraping failed for Sprouts and how it was replaced with GraphQL interception
- How `dotenv` was added to fix missing environment variable errors
- Notes on the Instacart GraphQL response structure
- Multi-store expansion details and per-store selector notes
- Grocery Outlet / Flipp scraping attempts and current status
