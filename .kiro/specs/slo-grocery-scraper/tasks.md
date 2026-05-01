# Implementation Plan: SLO Grocery Scraper

## Overview

Implement a standalone Node.js scraper that runs on a daily cron schedule, visits Sprouts Farmers Market's website using Playwright with stealth anti-detection, extracts prices for 15 predefined grocery items, and persists results to a Supabase (Postgres) database. The implementation follows the pipeline: **Schedule → Scrape → Normalize → Upsert → Log**.

## Tasks

- [x] 1. Initialize project structure and install dependencies
  - Create `package.json` with `"type": "module"` (or CommonJS as appropriate) and define `main` as `index.js`
  - Install production dependencies: `playwright`, `playwright-extra`, `puppeteer-extra-plugin-stealth`, `@supabase/supabase-js`, `node-cron`
  - Install dev dependencies: `fast-check`, a test runner (e.g. `vitest` or `jest`)
  - Create directory structure: `stores/`, `utils/`, `tests/`
  - Create a `.env.example` file documenting `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`
  - _Requirements: 9.1, 9.2_

- [x] 2. Implement `utils/supabase.js` — Supabase client with env-var validation
  - [x] 2.1 Implement the Supabase client module
    - Read `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` from `process.env`
    - Throw a descriptive `Error` at module load time if either variable is missing, identifying the missing variable by name
    - Initialize and export the `@supabase/supabase-js` client
    - _Requirements: 9.1, 9.2, 9.3_

  - [x] 2.2 Write unit test for missing env-var behavior
    - Test: unset `SUPABASE_URL`, require the module, assert it throws with a message containing `'SUPABASE_URL'`
    - Test: unset `SUPABASE_SERVICE_ROLE_KEY`, assert it throws with a message containing `'SUPABASE_SERVICE_ROLE_KEY'`
    - _Requirements: 9.3_

- [x] 3. Implement `utils/normalize.js` — pure product name normalizer
  - [x] 3.1 Implement the `normalize(raw)` function
    - Apply the transformation pipeline in order: trim → lowercase → remove non-`[a-z0-9 \-]` characters → collapse multiple spaces → trim again
    - Export as a named or default export
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5_

  - [x] 3.2 Write property test: normalization is idempotent (Property 1)
    - **Property 1: Normalization is idempotent**
    - Generate arbitrary strings with `fc.string()`; assert `normalize(normalize(s)) === normalize(s)`
    - Run minimum 100 iterations
    - Include comment: `// Feature: slo-grocery-scraper, Property 1: Normalization is idempotent`
    - **Validates: Requirements 4.5**

  - [x] 3.3 Write property test: normalization produces lowercase output (Property 2)
    - **Property 2: Normalization produces lowercase output**
    - Generate arbitrary strings; assert `normalize(s) === normalize(s).toLowerCase()`
    - Run minimum 100 iterations
    - Include comment: `// Feature: slo-grocery-scraper, Property 2: Normalization produces lowercase output`
    - **Validates: Requirements 4.3**

  - [x] 3.4 Write property test: normalization trims whitespace (Property 3)
    - **Property 3: Normalization trims whitespace**
    - Generate strings with arbitrary leading/trailing whitespace using `fc.string()` padded with spaces; assert result has no leading or trailing whitespace
    - Run minimum 100 iterations
    - Include comment: `// Feature: slo-grocery-scraper, Property 3: Normalization trims whitespace`
    - **Validates: Requirements 4.2**

  - [x] 3.5 Write property test: normalization removes special characters (Property 4)
    - **Property 4: Normalization removes special characters**
    - Generate strings with arbitrary punctuation/symbols; assert result matches `/^[a-z0-9 \-]*$/`
    - Run minimum 100 iterations
    - Include comment: `// Feature: slo-grocery-scraper, Property 4: Normalization removes special characters`
    - **Validates: Requirements 4.4**

  - [x] 3.6 Write unit tests for `normalize`
    - `normalize('')` → `''`
    - `normalize('  Organic Baby Spinach  ')` → `'organic baby spinach'`
    - `normalize('Cheddar-Cheese!')` → `'cheddar-cheese'`
    - _Requirements: 4.1, 4.2, 4.3, 4.4_

- [x] 4. Implement `parsePrice` utility and add it to the normalize/utils layer
  - [x] 4.1 Implement the `parsePrice(raw)` function
    - Strip all non-numeric characters except `.` using `raw.replace(/[^0-9.]/g, '')`
    - Parse with `parseFloat`; return `null` if result is `NaN`
    - Round to 2 decimal places: `Math.round(n * 100) / 100`
    - Export from `utils/normalize.js` or a dedicated `utils/parse.js`
    - _Requirements: 6.3, 10.1_

  - [x] 4.2 Write property test: parsePrice returns valid decimal for valid price strings (Property 5)
    - **Property 5: parsePrice returns a valid decimal for valid price strings**
    - Generate valid price strings (e.g. using `fc.float()` mapped to `"$X.XX"` format); assert result is a finite number satisfying `Math.round(result * 100) / 100 === result`
    - Run minimum 100 iterations
    - Include comment: `// Feature: slo-grocery-scraper, Property 5: parsePrice returns a valid decimal for valid price strings`
    - **Validates: Requirements 10.1**

  - [x] 4.3 Write property test: parsePrice returns null for invalid price strings (Property 6)
    - **Property 6: parsePrice returns null for invalid price strings**
    - Generate purely alphabetic strings using `fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz'.split('')))` with minimum length 1; assert `parsePrice` returns `null`
    - Run minimum 100 iterations
    - Include comment: `// Feature: slo-grocery-scraper, Property 6: parsePrice returns null for invalid price strings`
    - **Validates: Requirements 6.3**

  - [x] 4.4 Write unit tests for `parsePrice`
    - `parsePrice('$3.99')` → `3.99`
    - `parsePrice('abc')` → `null`
    - `parsePrice('')` → `null`
    - `parsePrice('$0.00')` → `0`
    - `parsePrice('12.5')` → `12.5`
    - _Requirements: 6.3, 10.1_

- [x] 5. Checkpoint — Ensure all pure-logic tests pass
  - Run the test suite; confirm all normalize and parsePrice tests pass
  - Ask the user if any questions arise before proceeding to browser and DB work

- [x] 6. Implement `stores/sprouts.js` — Playwright scraper module
  - [x] 6.1 Define the `TARGET_LIST` constant
    - Export or define the array of exactly 15 items: `['eggs', 'whole milk', 'chicken breast', 'bread', 'bananas', 'greek yogurt', 'pasta', 'canned tomatoes', 'orange juice', 'cheddar cheese', 'butter', 'rice', 'baby spinach', 'ground beef', 'oat milk']`
    - _Requirements: 3.1, 3.2_

  - [x] 6.2 Implement the `scrape()` function
    - Launch Playwright Chromium with `playwright-extra` + `puppeteer-extra-plugin-stealth` and a realistic user agent string
    - For each item in `TARGET_LIST`, navigate to `https://www.sprouts.com/search?query=<item>`, wait for product card selector, extract `name`, `price`, `originalPrice`, and `sourceUrl` from each card
    - Apply a random delay of 2000–3000ms between items using `Math.random()`
    - Wrap each item's processing in `try/catch`; on timeout or navigation error log a warning and continue; if no product cards are found log a warning and continue
    - Close the browser after all items are processed
    - Return the accumulated array of `RawProduct` objects
    - _Requirements: 1.1, 1.2, 1.3, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 3.1, 3.2_

- [x] 7. Implement `index.js` — Orchestrator
  - [x] 7.1 Implement the `runScrape()` async function
    - Call `scrape()` from `stores/sprouts.js` to get `RawProduct[]`
    - For each raw product: call `normalize` on the name, call `parsePrice` on price and originalPrice
    - If `parsePrice` returns `null` for the main price, log a warning and skip that product
    - Upsert the product into the `products` table using `.ilike()` case-insensitive lookup; track `newProductsCount`
    - Insert a row into the `prices` table with `product_id`, `store_id` (Sprouts UUID), `price`, `original_price`, `scraped_at` (ISO 8601 with timezone), and `source_url`; track `insertedCount`
    - Log the summary: `"Sprouts: <N> items scraped, <M> new products added"`
    - Wrap the entire function body in `try/catch`; log errors without re-throwing
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 6.1, 6.2, 6.3, 7.1, 10.1, 10.2, 10.3_

  - [x] 7.2 Register the cron schedule and immediate run
    - Register `cron.schedule('0 6 * * *', () => runScrape().catch(console.error))` to trigger daily at 06:00
    - Call `runScrape().catch(console.error)` immediately on startup for the first run
    - Ensure the process remains alive between scheduled runs (node-cron keeps the event loop open)
    - _Requirements: 8.1, 8.2, 8.3, 8.4_

- [x] 8. Checkpoint — Wire everything together and verify integration
  - Ensure all modules are correctly imported/required in `index.js`
  - Confirm `utils/supabase.js` is imported before any DB calls
  - Ensure all tests still pass, ask the user if questions arise

- [x] 9. Write integration tests for database upsert and price insertion
  - [x] 9.1 Write integration test: product upsert idempotency (Property 7)
    - **Property 7: Product upsert idempotency**
    - Insert a product name, insert again with same name in different casing; assert exactly one row exists in `products` and both calls return the same UUID
    - Include comment: `// Feature: slo-grocery-scraper, Property 7: Product upsert idempotency`
    - **Validates: Requirements 5.2, 5.3, 5.4**

  - [x] 9.2 Write integration test: price record insertion (Property 8)
    - **Property 8: Price records contain all required fields with correct types**
    - Insert a product and a price record; query the `prices` table back; assert `product_id` is a valid UUID, `store_id` matches the Sprouts store UUID, `price` equals `parsePrice(rawPrice)`, `original_price` is a valid decimal or null, `scraped_at` is a timezone-aware timestamp, and `source_url` is non-empty
    - Include comment: `// Feature: slo-grocery-scraper, Property 8: Price records contain all required fields with correct types`
    - **Validates: Requirements 6.1, 6.2, 10.2, 10.3**

- [x] 10. Final checkpoint — Ensure all tests pass
  - Run the full test suite (unit + property + integration)
  - Ensure all tests pass, ask the user if questions arise

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation at logical boundaries
- Property tests (Properties 1–6) use `fast-check` with a minimum of 100 iterations each
- Properties 7 and 8 require a live or test Supabase instance and are implemented as integration tests
- The Sprouts store UUID must be known at runtime — seed the `stores` table before running integration tests or the full scraper
- Never hardcode `SUPABASE_URL` or `SUPABASE_SERVICE_ROLE_KEY`; always load from environment variables
