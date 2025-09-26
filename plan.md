# Migration Plan: Move Subscriptions from KV to D1

## Objective

Migrate flight subscription data from Cloudflare KV to Cloudflare D1, ensuring all related operations (fetching, adding, retrieving user flights, scheduling cleanup) are updated to use D1.

## D1 Schema

```sql
CREATE TABLE subscriptions (
  telegram_id TEXT,
  flight_number TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  auto_cleanup_at DATETIME NULL,
  PRIMARY KEY (telegram_id, flight_number)
);

-- Indexes for performance
CREATE INDEX idx_active_subs ON subscriptions(auto_cleanup_at) WHERE auto_cleanup_at IS NULL;
CREATE INDEX idx_cleanup_ready ON subscriptions(auto_cleanup_at) WHERE auto_cleanup_at IS NOT NULL;
CREATE INDEX idx_user_subs ON subscriptions(telegram_id);
```

```sql
CREATE TABLE IF NOT EXISTS flights (
    id TEXT PRIMARY KEY NOT NULL,
    flight_number TEXT NOT NULL,
    status TEXT NOT NULL,
    scheduled_departure_time INTEGER,
    actual_departure_time INTEGER,
    scheduled_arrival_time INTEGER,
    actual_arrival_time INTEGER,
    city TEXT,
    airline TEXT,
    created_at INTEGER DEFAULT (strftime('%s', 'now')),
    updated_at INTEGER DEFAULT (strftime('%s', 'now'))
);

-- Create indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_flight_number ON flights (flight_number);
CREATE INDEX IF NOT EXISTS idx_status ON flights (status);
```

## Steps

1.  **Identify current KV usage:** Locate all instances where `env.DB` (KV) is used for subscription management.
2.  **Create D1 database and apply schema:** Manually create the D1 database and apply the schema using `wrangler d1 execute <DB_NAME> --file=./schema.sql`. (This step is outside the scope of automated changes but needs to be documented).
3.  **Update `workers/src/services/tracking.ts`:**
    - Modify the `getAllSubscriptions` function to query D1.
    - Update the `addSubscription` function to insert into D1.
    - Adjust `getUserFlights` to fetch from D1.
    - Change `scheduleCleanup` to update D1.
4.  **Update `workers/src/index.ts`:**
    - Ensure the D1 binding (`env.DB`) is correctly configured in `wrangler.toml` and accessible in the worker.
5.  **Testing:** Verify all subscription-related functionalities work correctly with D1.

## Flights Table Migration

### Objective

Migrate historical and current flight data from KV to D1, ensuring all flight tracking and data retrieval operations are updated to use D1.

### Steps

1.  **Create D1 database and apply schema:** The `flights` table schema has been added to `workers/src/schema.sql`, including new `city` and `airline` fields. Apply this schema to your D1 database.
2.  **Identify current KV usage for flight data:** Locate all instances where KV is used to store and retrieve flight data.
3.  **Migrate existing flight data from KV to D1:**
    - This step will be handled by a separate migration script.
4.  **Update `workers/src/services/flightData.ts`:**
    - Modify functions that fetch or store flight data to use D1 queries instead of KV operations.
5.  **Update `workers/src/services/tracking.ts`:**
    - Adjust any functions that rely on flight data to fetch from D1.
6.  **Update `workers/src/handlers/cron.ts` and `workers/src/handlers/alerts.ts`:**
    - Ensure these handlers use D1 for flight data interactions.
7.  **Update `workers/src/types/index.ts`:**
    - Introduce `D1Flight` interface for the D1 `flights` table schema.
    - Ensure the existing `Flight` interface accurately reflects the external API response structure.
8.  **Testing:** Verify all flight data-related functionalities work correctly with D1.

## Gate and Flightradar24 Link Removal

### Objective

Remove all gate-related code and Flightradar24 Telegram links from the project.

### Changes Made

1.  Removed 'gate' column from `flights` table in `workers/src/schema.sql` (confirmed it was not present).
2.  Removed `gate` property from `Flight` interface in `workers/src/types/index.ts` (confirmed `D1Flight` did not have it).
3.  Confirmed no gate-related code in `workers/src/services/flightData.ts`.
4.  Removed Flightradar24 Telegram links from `workers/src/utils/formatting.ts`.
5.  Confirmed no affected code in `workers/src/handlers/alerts.ts`, `workers/src/handlers/commands.ts`, and `workers/src/handlers/cron.ts`.
6.  Formatted modified files (`workers/src/types/index.ts`, `workers/src/utils/formatting.ts`).

## Final KV Removal

### Objective

Complete removal of all Cloudflare KV references (`env.FLIGHT_DATA`) and migrate all remaining operations to D1.

### Changes Made

1.  **Added `status` table to D1 schema** (`workers/src/schema.sql`):
    - Created table to store system-wide key-value pairs
    - Stores `latest-arrivals`, `prev-arrivals`, `update-counter`, and `last-error`

2.  **Updated `workers/src/index.ts`**:
    - Removed `FLIGHT_DATA: KVNamespace` from `Env` interface
    - Replaced KV `get('latest-arrivals')` with D1 query to `status` table

3.  **Updated `workers/src/handlers/cron.ts`**:
    - Replaced KV operations for `update-counter`, `latest-arrivals`, and `last-error`
    - All operations now use D1 `status` table with `INSERT OR REPLACE` queries

4.  **Updated `workers/src/handlers/commands.ts`**:
    - Replaced all KV `get('latest-arrivals')` and `get('last-error')` calls
    - All status queries now use D1 `status` table

5.  **Updated `workers/src/handlers/alerts.ts`**:
    - Replaced KV operations for `prev-arrivals` and tracking data
    - Migrated from KV tracking keys to D1 `subscriptions` table queries
    - Simplified alert logic using existing D1 subscription relationships

6.  **Updated `workers/src/services/flightData.ts`**:
    - Replaced legacy KV tracking cleanup with D1 subscription cleanup
    - Uses `UPDATE subscriptions SET auto_cleanup_at` for completed flights

7.  **Verified configuration**:
    - `workers/wrangler.toml`: FLIGHT_DATA KV binding already commented out
    - `workers/worker-configuration.d.ts`: Already contains only D1 binding

8.  **Formatted modified files**: All TypeScript files formatted with Prettier

### Migration Summary

- **Before**: Mixed KV and D1 usage with complex tracking relationships
- **After**: Pure D1 implementation using `flights`, `subscriptions`, and `status` tables
- **Benefits**: Simplified data model, better consistency, single database system
- **Status**: All KV references removed, system fully migrated to D1
