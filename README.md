# SLO Grocery Scraper

A standalone Node.js application that runs on a daily schedule, visits the [Sprouts Farmers Market](https://www.sprouts.com) website, extracts current grocery prices for 15 predefined items, and persists the results to a [Supabase](https://supabase.com) (Postgres) database.

This is a go/no-go pilot for San Luis Obispo grocery price tracking. If Sprouts scraping proves reliable, the system will be extended to cover Vons and Ralphs.

---

## How it works

The scraper follows a simple pipeline on each run:

```
Schedule → Scrape → Normalize → Upsert → Log
```

1. **Schedule** — `node-cron` triggers a run every day at 06:00 local time. An additional run fires immediately on startup.
2. **Scrape** — Playwright launches a headless Chromium browser with stealth anti-detection. It searches Sprouts for each of the 15 target items sequentially, with a random 2–3 second delay between requests.
3. **Normalize** — Raw product names are cleaned: trimmed, lowercased, stripped of special characters, and collapsed to single spaces.
4. **Upsert** — Each product is looked up in the `products` table with a case-insensitive match. If it doesn't exist, a new row is inserted. Either way, the UUID is used for the price record.
5. **Log** — A summary is printed: `Sprouts: N items scraped, M new products added`.

---

## Prerequisites

- Node.js v18 or later
- A Supabase project with the schema below applied
- The `stores` table pre-seeded with a Sprouts row

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
GROCERY_OUTLET_STORE_ID=your-groceryoutlet-store-uuid-here
```

To find `SPROUTS_STORE_ID`, run this query in your Supabase SQL editor after seeding the `stores` table:

```sql
SELECT id FROM stores WHERE name = 'Sprouts' LIMIT 1;
```

To find `GROCERY_OUTLET_STORE_ID`:

```sql
SELECT id FROM stores WHERE name = 'Grocery Outlet' LIMIT 1;
```

**4. Apply the database schema**

Run the following SQL in your Supabase SQL editor:

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

-- Seed the Sprouts store row
INSERT INTO stores (name, address)
VALUES ('Sprouts', '1014 Madonna Rd, San Luis Obispo, CA');

-- Seed the Grocery Outlet store row
INSERT INTO stores (name, address)
VALUES ('Grocery Outlet', '1314 Madonna Rd, San Luis Obispo, CA 93405');
```

---

## Running the scraper

```bash
npm start
# or
node index.js
```

The process will:
- Run one scrape immediately on startup
- Stay alive and re-run every day at 06:00

Expected console output per run:

```
[scraper] Starting Sprouts scrape run...
[sprouts] "eggs" → 3 product(s) found
[sprouts] "whole milk" → 4 product(s) found
...
Sprouts: 42 items scraped, 3 new products added
```

---

## Project structure

```
.
├── index.js                  # Entry point — orchestrator, cron schedule
├── stores/
│   └── sprouts.js            # Playwright scraper for Sprouts
├── utils/
│   ├── normalize.js          # normalize() and parsePrice() pure functions
│   └── supabase.js           # Supabase client with env-var validation
├── tests/
│   ├── normalize.test.js     # Unit + property tests for normalize/parsePrice
│   ├── supabase.test.js      # Unit tests for env-var validation
│   └── integration.test.js   # DB integration tests (requires live Supabase)
├── .env.example              # Environment variable template
└── package.json
```

---

## Module reference

### `index.js`

Entry point. Exports `runScrape()` and registers the cron schedule.

**`runScrape()`** — Orchestrates a full scraping run:
- Calls `scrape()` to get raw products
- Normalizes names with `normalize()`
- Parses prices with `parsePrice()` — skips products with unparseable prices
- Upserts each product into `products` (case-insensitive dedup via `.ilike()`)
- Inserts a new row into `prices` for every valid product
- Logs the run summary
- Catches all errors internally so the cron schedule is never interrupted

---

### `stores/sprouts.js`

**`TARGET_LIST`** — The fixed array of 15 grocery items searched on every run:

| | | | |
|---|---|---|---|
| eggs | whole milk | chicken breast | bread |
| bananas | greek yogurt | pasta | canned tomatoes |
| orange juice | cheddar cheese | butter | rice |
| baby spinach | ground beef | oat milk | |

**`scrape()`** — Launches a headless Chromium browser with the stealth plugin and a realistic user agent. For each item in `TARGET_LIST`:
- Navigates to `https://www.sprouts.com/search?query=<item>`
- Waits for product cards to appear (15s timeout)
- Extracts `name`, `price`, `originalPrice`, and `sourceUrl` from each card
- Waits a random 2–3 second delay before the next item
- On timeout or missing cards: logs a warning and continues

Returns `Promise<RawProduct[]>` where each `RawProduct` is:

```js
{
  name: string,           // raw product name from DOM
  price: string,          // current price string, e.g. "$3.99"
  originalPrice: string | null,  // regular price if on sale, else null
  sourceUrl: string       // the search URL used
}
```

---

### `utils/normalize.js`

Pure functions with no side effects or I/O.

**`normalize(raw: string): string`**

Cleans a raw product name through this pipeline:
1. Trim leading/trailing whitespace
2. Convert to lowercase
3. Remove all characters except `[a-z0-9 -]`
4. Collapse multiple spaces into one
5. Trim again

The function is **idempotent**: `normalize(normalize(x)) === normalize(x)` for all inputs.

```js
normalize('  Organic Baby Spinach  ')  // → 'organic baby spinach'
normalize('Cheddar-Cheese!')           // → 'cheddar-cheese'
normalize('')                          // → ''
```

**`parsePrice(raw: string): number | null`**

Strips non-numeric characters (except `.`), parses as a float, and rounds to 2 decimal places. Returns `null` if the result is not a valid number.

```js
parsePrice('$3.99')  // → 3.99
parsePrice('12.5')   // → 12.5
parsePrice('$0.00')  // → 0
parsePrice('abc')    // → null
parsePrice('')       // → null
```

---

### `utils/supabase.js`

Initializes and exports the Supabase client. Reads credentials from environment variables and **throws at module load time** if either is missing — this causes the process to exit immediately with a clear error before any scraping begins.

Required env vars:
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

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

**Property-based tests** use [fast-check](https://github.com/dubzzz/fast-check) with 100 iterations each:

| Property | What it verifies |
|---|---|
| P1: Idempotent normalization | `normalize(normalize(s)) === normalize(s)` for any string |
| P2: Lowercase output | `normalize(s) === normalize(s).toLowerCase()` for any string |
| P3: Trims whitespace | Result has no leading or trailing whitespace |
| P4: No special characters | Result matches `^[a-z0-9 -]*$` |
| P5: Valid decimal for price strings | `parsePrice("$X.XX")` returns a finite number with ≤ 2 decimal places |
| P6: Null for non-numeric strings | `parsePrice("abc...")` returns `null` |
| P7: Upsert idempotency *(integration)* | Same product name inserted twice → one row, stable UUID |
| P8: Price record completeness *(integration)* | All required fields present with correct types |

Integration tests auto-skip when `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `SPROUTS_STORE_ID` are not set.

---

## Error handling

| Scenario | Behavior |
|---|---|
| Missing env var at startup | Throws immediately, process exits with clear message |
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

See [MEMORY.md](./MEMORY.md) for a log of bugs encountered and how they were fixed, including:

- Why the original DOM scraping approach failed and how it was replaced with GraphQL interception
- How `dotenv` was added to fix missing environment variable errors
- Notes on the Instacart GraphQL response structure for future maintenance
