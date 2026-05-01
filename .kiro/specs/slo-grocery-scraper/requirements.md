# Requirements Document

## Introduction

A standalone Node.js scraper that runs on a daily schedule, visits the Sprouts Farmers Market website, extracts current grocery prices for a predefined list of items, and writes the results to a Supabase (Postgres) database. This is a go/no-go pilot — if Sprouts scraping works reliably, the system will be extended to cover Vons and Ralphs in San Luis Obispo.

## Glossary

- **Scraper**: The Node.js application responsible for launching a browser, navigating to store pages, and extracting product data.
- **Sprouts_Module**: The store-specific scraping logic in `stores/sprouts.js`.
- **Orchestrator**: The entry-point logic in `index.js` that coordinates scraping, database writes, and scheduling.
- **Normalizer**: The utility in `utils/normalize.js` that cleans and standardizes raw product name strings.
- **Supabase_Client**: The utility in `utils/supabase.js` that initializes and exports the Supabase connection.
- **Product**: A grocery item tracked in the `products` table, identified by a UUID and a canonical name.
- **Price_Record**: A row in the `prices` table capturing the price of a Product at a Store at a point in time.
- **Store**: A retail location tracked in the `stores` table (e.g., Sprouts at 1014 Madonna Rd, San Luis Obispo).
- **Target_List**: The fixed set of 15 grocery items the Scraper is configured to search for.
- **Cron_Schedule**: The daily 6 AM recurring trigger managed by `node-cron`.
- **Sale_Price**: The discounted current price shown when a product is on promotion.
- **Original_Price**: The regular (non-sale) price shown alongside a Sale_Price.

---

## Requirements

### Requirement 1: Browser-Based Scraping with Anti-Detection

**User Story:** As a developer, I want the Scraper to launch a headless browser with a realistic user agent, so that Sprouts' website does not block automated requests.

#### Acceptance Criteria

1. WHEN the Scraper starts a scraping run, THE Sprouts_Module SHALL launch a headless Chromium browser with a realistic user agent string.
2. WHEN the Sprouts_Module navigates between search queries, THE Sprouts_Module SHALL wait a random delay between 2 and 3 seconds before issuing the next request.
3. IF the browser fails to launch, THEN THE Scraper SHALL log the error and terminate the current run with a non-zero exit signal.

---

### Requirement 2: Product Search and Data Extraction

**User Story:** As a developer, I want the Scraper to search Sprouts' website for each item in the Target_List and extract structured product data, so that current prices are captured accurately.

#### Acceptance Criteria

1. WHEN a scraping run begins, THE Sprouts_Module SHALL issue a search request to `https://www.sprouts.com/search?query=<item>` for each item in the Target_List.
2. WHEN a search results page loads, THE Sprouts_Module SHALL wait for product cards to be present in the DOM before extracting data.
3. WHEN product cards are present, THE Sprouts_Module SHALL extract the product name, current price, and source URL from each card.
4. WHEN a product card displays a Sale_Price alongside an Original_Price, THE Sprouts_Module SHALL extract both values.
5. WHEN a product card does not display an Original_Price, THE Sprouts_Module SHALL record the Original_Price field as null.
6. THE Sprouts_Module SHALL return an array of extracted product objects for all items in the Target_List.
7. IF a search page returns no product cards for an item, THEN THE Sprouts_Module SHALL log a warning for that item and continue processing the remaining items.
8. IF a search request times out or returns an HTTP error, THEN THE Sprouts_Module SHALL log the error for that item and continue processing the remaining items.

---

### Requirement 3: Target Item List

**User Story:** As a developer, I want the Scraper to search for a defined set of 15 grocery items, so that the pilot covers a representative cross-section of common grocery categories.

#### Acceptance Criteria

1. THE Sprouts_Module SHALL search for exactly the following 15 items: eggs, whole milk, chicken breast, bread, bananas, greek yogurt, pasta, canned tomatoes, orange juice, cheddar cheese, butter, rice, baby spinach, ground beef, oat milk.
2. THE Sprouts_Module SHALL process all 15 items in a single scraping run.

---

### Requirement 4: Product Name Normalization

**User Story:** As a developer, I want product names cleaned and standardized before database writes, so that duplicate products are not created due to minor formatting differences.

#### Acceptance Criteria

1. WHEN a raw product name is received from the Sprouts_Module, THE Normalizer SHALL produce a cleaned product name string.
2. THE Normalizer SHALL trim leading and trailing whitespace from product names.
3. THE Normalizer SHALL convert product names to a consistent case format (lowercase).
4. THE Normalizer SHALL remove extraneous punctuation and special characters that are not part of the product name.
5. FOR ALL valid raw product name strings, normalizing then normalizing again SHALL produce the same result (idempotent normalization).

---

### Requirement 5: Idempotent Product Upsert

**User Story:** As a developer, I want the Orchestrator to avoid creating duplicate product records, so that the products table remains clean across repeated scraping runs.

#### Acceptance Criteria

1. WHEN a scraped product name is ready to be stored, THE Orchestrator SHALL query the `products` table for an existing row with a case-insensitive name match.
2. WHEN a matching Product already exists, THE Orchestrator SHALL use the existing Product's UUID for the new Price_Record without inserting a new product row.
3. WHEN no matching Product exists, THE Orchestrator SHALL insert a new row into `products` and use the resulting UUID for the new Price_Record.
4. WHEN the Orchestrator runs twice in a row for the same set of items, THE Orchestrator SHALL create new Price_Records on the second run without creating duplicate rows in `products`.

---

### Requirement 6: Price Record Insertion

**User Story:** As a developer, I want every scraped price to be written to the database with full context, so that historical price trends can be queried over time.

#### Acceptance Criteria

1. WHEN a Product UUID is resolved, THE Orchestrator SHALL insert a new row into the `prices` table containing: `product_id`, `store_id` (Sprouts store UUID), `price` (current price), `original_price` (null if not on sale), `scraped_at` (current timestamp), and `source_url`.
2. THE Orchestrator SHALL associate every Price_Record with the pre-seeded Sprouts Store row using its UUID.
3. WHEN a price value extracted from the page cannot be parsed as a valid decimal number, THE Orchestrator SHALL log a warning for that item and skip inserting a Price_Record for it.

---

### Requirement 7: Run Summary Logging

**User Story:** As a developer, I want the Orchestrator to log a human-readable summary after each run, so that I can quickly verify the scraper is working correctly.

#### Acceptance Criteria

1. WHEN a scraping run completes, THE Orchestrator SHALL log a summary in the format: `"Sprouts: <N> items scraped, <M> new products added"` where N is the count of Price_Records inserted and M is the count of new product rows created.

---

### Requirement 8: Daily Scheduled Execution

**User Story:** As a developer, I want the Scraper to run automatically every day at 6 AM, so that price data is refreshed daily without manual intervention.

#### Acceptance Criteria

1. WHEN `index.js` is started, THE Orchestrator SHALL register a Cron_Schedule that triggers a full scraping run daily at 06:00 local time.
2. WHEN `index.js` is started, THE Orchestrator SHALL also execute one immediate scraping run before the first scheduled trigger.
3. WHILE the Cron_Schedule is active, THE Orchestrator SHALL remain running between scheduled triggers without exiting.
4. IF a scheduled run encounters an unhandled error, THEN THE Orchestrator SHALL log the error and allow the process to continue so that subsequent scheduled runs are not prevented.

---

### Requirement 9: Environment-Based Configuration

**User Story:** As a developer, I want all secrets and environment-specific values loaded from environment variables, so that credentials are never hardcoded in source files.

#### Acceptance Criteria

1. THE Supabase_Client SHALL read the Supabase project URL from the `SUPABASE_URL` environment variable.
2. THE Supabase_Client SHALL read the service role key from the `SUPABASE_SERVICE_ROLE_KEY` environment variable.
3. IF either `SUPABASE_URL` or `SUPABASE_SERVICE_ROLE_KEY` is not set at startup, THEN THE Supabase_Client SHALL throw an error with a descriptive message identifying the missing variable.

---

### Requirement 10: Database Schema Compatibility

**User Story:** As a developer, I want the Scraper to write data that conforms to the defined Supabase schema, so that queries and future expansions work without migration issues.

#### Acceptance Criteria

1. THE Orchestrator SHALL write `price` values as numeric values with at most 2 decimal places, compatible with the `numeric(8,2)` column type.
2. THE Orchestrator SHALL write `scraped_at` values as timezone-aware timestamps compatible with the `timestamptz` column type.
3. THE Orchestrator SHALL write `product_id` and `store_id` as valid UUID strings referencing existing rows in `products` and `stores` respectively.
