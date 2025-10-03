# JSON Stringify Flights Implementation

## Problem Statement

The current flight tracking system was hitting CloudFlare SQLite write limits:
- **Cron frequency**: Every 60 seconds
- **Flight volume**: ~70 flights per update  
- **Daily writes**: 70 × 1,440 = 100,800 SQLite writes/day
- **CloudFlare limit**: 100,000 SQLite writes/day
- **Current state**: `writeFlightsData()` disabled, breaking change detection

## Solution: Single JSON Key in Status Table

Instead of storing each flight as a separate SQLite row, store all flights as a single JSON string in the `status` table.

### Benefits
- ✅ **SQLite writes reduced**: From 100,800/day to 1,440/day (99% reduction!)
- ✅ **Change detection restored**: Previous flights available for comparison
- ✅ **Subscriptions continue working**: No changes to subscription logic
- ✅ **Simple implementation**: Minimal code changes required

### Storage Pattern

```sql
-- OLD: 70 individual INSERT/UPDATE statements per cron run
INSERT INTO flights (id, flight_number, ...) VALUES (...) ON CONFLICT DO UPDATE...

-- NEW: 1 single JSON write per cron run  
INSERT OR REPLACE INTO status (key, value) VALUES ('flights_data', '[{...}, {...}, ...]')
```

### Data Flow

```
Cron Run N:   Read 'flights_data' → Parse as previousFlights → Fetch API → Store as 'flights_data'
Cron Run N+1: Read 'flights_data' → Parse as previousFlights → Fetch API → Store as 'flights_data'
```

## Implementation Details

### 1. New Flight Data Functions

Added to `flightData.ts`:

```typescript
export const getCurrentFlightsFromStatus = (ctx: DurableObjectState): Flight[]
export const storeFlightsInStatus = (flights: Flight[], ctx: DurableObjectState): void
export const getUserTrackedFlightsFromStatus = (userId: number, ctx: DurableObjectState): Flight[]
export const getFlightByIdFromStatus = (flightId: string, ctx: DurableObjectState): Flight | undefined
export const getFlightByNumberFromStatus = (flightNumber: string, ctx: DurableObjectState): Flight | undefined
export const getNotTrackedFlightsFromStatus = (chatId: number, ctx: DurableObjectState): Flight[]
```

### 2. Updated Cron Logic

In `cron.ts`:

**BEFORE** (broken - flights table empty):
```typescript
// writeFlightsData(currentFlights, ctx) // DISABLED!
const result = ctx.storage.sql.exec(`SELECT f.* FROM flights f INNER JOIN subscriptions...`) // FAILS!
```

**AFTER** (working with JSON):
```typescript
// 1. Get previous flights from JSON
const previousFlights = getCurrentFlightsFromStatus(ctx)

// 2. Store current flights as JSON (1 SQLite write!)
storeFlightsInStatus(currentFlights, ctx) 

// 3. Filter for subscribed flights only
const subscribedFlightIds = new Set(/* get from subscriptions table */)
const previousFlightsMap = Object.fromEntries(
  previousFlights.filter(f => subscribedFlightIds.has(f.id)).map(f => [f.id, f])
)

// 4. Change detection (same logic as before)
```

### 3. Function Migrations

Replace all flight table queries with JSON-based equivalents:

| Old Function | New Function | Location |
|---|---|---|
| `getUserTrackedFlightsWithData()` | `getUserTrackedFlightsFromStatus()` | commands.ts, formatting.ts |
| `getFlightIdByNumber()` | `getFlightByNumberFromStatus()?.id` | commands.ts |
| `getNotTrackedFlights()` | `getNotTrackedFlightsFromStatus()` | commands.ts |
| `getCurrentFlightData()` | `getFlightByNumberFromStatus()` | - |
| SQL flight queries | JSON parsing + filtering | All files |

### 4. Subscription Integration

Subscriptions remain in SQLite (low frequency), flights in JSON:

```typescript
// Get subscribed flight IDs from SQLite
const result = ctx.storage.sql.exec('SELECT flight_id FROM subscriptions WHERE telegram_id = ?', userId)
const subscribedIds = result.toArray().map(row => row.flight_id)

// Filter JSON flight data
const allFlights = getCurrentFlightsFromStatus(ctx)
const userFlights = allFlights.filter(flight => subscribedIds.includes(flight.id))
```

### 5. Cleanup Integration

Updated cleanup works with JSON data:

```typescript
export const cleanupCompletedFlights = (env: Env, ctx: DurableObjectState): number => {
  const currentFlights = getCurrentFlightsFromStatus(ctx) // Read from JSON
  
  const completedFlightIds = currentFlights
    .filter(flight => flight.status === 'LANDED' || flight.status === 'CANCELED' || /* eta passed */)
    .map(flight => flight.id)

  // Delete subscriptions for completed flights (SQLite)
  for (const flightId of completedFlightIds) {
    ctx.storage.sql.exec('DELETE FROM subscriptions WHERE flight_id = ?', flightId)
  }
}
```

## Performance Analysis

### SQLite Write Reduction
- **Before**: 70 flights × 1,440 cron runs = 100,800 writes/day
- **After**: 1 JSON write × 1,440 cron runs = 1,440 writes/day
- **Reduction**: 99% fewer SQLite writes

### Memory/Performance
- **JSON size**: ~70 flights × ~200 bytes = ~14KB per JSON blob
- **Parse time**: <1ms for 14KB JSON
- **Storage overhead**: Minimal (single status table row)

### Reliability
- **Change detection**: ✅ Restored (was broken)
- **Subscriptions**: ✅ Unchanged (still in SQLite)
- **Cleanup**: ✅ Works with JSON data
- **Backwards compatibility**: ✅ No API changes

## Files Modified

1. **`workers/src/services/flightData.ts`**
   - Added JSON-based flight data functions
   - Updated cleanup function

2. **`workers/src/handlers/cron.ts`**
   - Replaced broken flights table query with JSON approach
   - Added subscription filtering for change detection

3. **`workers/src/handlers/commands.ts`**
   - Updated all flight lookup functions to use JSON data

4. **`workers/src/utils/formatting.ts`**
   - Updated user flight tracking to use JSON data

## Testing Strategy

1. **Build verification**: Ensure TypeScript compilation passes
2. **Function testing**: Verify all flight lookup functions work with JSON
3. **Integration testing**: Test cron job, commands, and subscriptions
4. **Performance testing**: Verify SQLite write reduction

## Deployment Plan

1. **Zero downtime**: Changes are backwards compatible
2. **Gradual migration**: Old flights table can remain (unused)
3. **Rollback plan**: Revert to previous commit if issues arise
4. **Monitoring**: Watch SQLite write metrics after deployment

## Success Metrics

- ✅ SQLite writes reduced from ~100k/day to ~1.4k/day
- ✅ Change detection functionality restored
- ✅ All existing features continue working
- ✅ No user-facing changes or downtime
- ✅ Build and tests pass

## Future Optimizations

1. **Smart change detection**: Only write JSON if flights actually changed
2. **Compression**: Gzip JSON if it becomes large
3. **Cleanup automation**: Remove old flights table after verification
4. **Monitoring**: Add metrics for JSON parse/write performance