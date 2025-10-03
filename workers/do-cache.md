# Durable Object Request-Scoped Caching Plan

## Overview

Use the DurableObject `Props` generic to add a `cache` property that stores computed values per request/alarm invocation. Reset the cache at the start of each invocation to ensure fresh data.

## 1. Define Cache Props Interface

```typescript
// src/types.ts or src/durable.ts
interface DOProps {
	cache: {
		idt?: Date
		idtDateString?: string
		idtTimeString?: string
		flights?: Flight[]
	}
}
```

## 2. Update FlightDO Class

```typescript
// src/durable.ts
export class FlightDO extends DurableObject<Env, DOProps> {
	constructor(ctx: DurableObjectState<DOProps>, env: Env) {
		super(ctx, env)
		this.resetCache()
	}

	private resetCache() {
		this.ctx.props = {
			cache: {},
		}
	}

	async fetch(request: Request): Promise<Response> {
		this.resetCache() // Reset at start of each request
		// ... existing fetch logic
	}

	async alarm(): Promise<void> {
		this.resetCache() // Reset at start of each alarm
		// ... existing alarm logic
	}
}
```

## 3. Update Date/Time Utilities

```typescript
// src/utils/dateTime.ts

export const getCurrentIdtTime = (ctx: DurableObjectState<DOProps>) => {
	const cache = ctx.props.cache

	if (cache.idt) {
		return cache.idt
	}

	const idt = new Date(Date.now().toLocaleString('en-US', { timeZone: 'Asia/Jerusalem' }))
	cache.idt = israelTime

	return israelTime
}

export const getCurrentIdtDateString = (ctx: DurableObjectState<DOProps>) => {
	const cache = ctx.props.cache

	if (cache.idtDateString) {
		return cache.idtDateString
	}

	cache.idtDateString = Date.now().toLocaleString('en-US', {
		timeZone: 'Asia/Jerusalem',
		hour12: false,
	})

	return cache.idtDateString
}

export const getCurrentIdtTimeString = (ctx: DurableObjectState<DOProps>) => {
	const cache = ctx.props.cache

	if (cache.idtTimeString) {
		return cache.idtTimeString
	}

	cache.idtTimeString = Date.now().toLocaleTimeString('en-US', {
		timeZone: 'Asia/Jerusalem',
		hour12: false,
		hour: '2-digit',
		minute: '2-digit',
	})

	return cache.idtTimeString
}

// These functions remain unchanged (they take timestamp parameter)
export const getIdtDateString = (n: number) => {
	return new Date(n).toLocaleString('en-US', {
		timeZone: 'Asia/Jerusalem',
		hour12: false,
	})
}

export const getIdtTimeString = (n: number) => {
	return new Date(n).toLocaleTimeString('en-US', {
		timeZone: 'Asia/Jerusalem',
		hour12: false,
	})
}
```

## 4. Update Flight Data Service

```typescript
// src/services/flightData.ts

export const getCurrentFlightsFromStatus = (ctx: DurableObjectState<DOProps>): Flight[] => {
	const cache = ctx.props.cache

	if (cache.flights) {
		return cache.flights
	}

	const result = ctx.storage.sql.exec('SELECT value FROM status WHERE key = ?', 'flights_data')
	const row = result.toArray()[0] as { value: string } | undefined

	if (!row?.value) {
		console.log('No previous flight data found in status table')
		cache.flights = []
	} else {
		try {
			cache.flights = JSON.parse(row.value) as Flight[]
		} catch (error) {
			console.error('Failed to parse flights JSON:', error)
			cache.flights = []
		}
	}

	return cache.flights
}
```

## 5. Update All Call Sites

Replace all calls to these functions to pass `this.ctx`:

```typescript
// Before:
const now = getCurrentIdtTime()
const dateStr = getCurrentIdtDateString()
const flights = getCurrentFlightsFromStatus(ctx)

// After:
const now = getCurrentIdtTime(this.ctx)
const dateStr = getCurrentIdtDateString(this.ctx)
const flights = getCurrentFlightsFromStatus(this.ctx)
```

## Benefits

1. **Consistent timestamps**: All time operations within a single fetch/alarm use the same `Date.now()` value
2. **Reduced computations**: Expensive timezone conversions are cached
3. **SQL query deduplication**: Flights data fetched once per invocation
4. **Type-safe**: TypeScript ensures cache structure is correct
5. **Explicit lifecycle**: `resetCache()` clearly marks boundaries between invocations

## Files to Modify

- `workers/src/durable.ts` - Add Props interface, resetCache method, call in fetch/alarm
- `workers/src/utils/dateTime.ts` - Update all `getCurrent*` functions
- `workers/src/services/flightData.ts` - Update `getCurrentFlightsFromStatus`
- `workers/src/handlers/commands.ts` - Update function calls to pass `this.ctx`
- `workers/src/handlers/cron.ts` - Update function calls to pass `ctx`
- `workers/src/handlers/alerts.ts` - Update function calls to pass `ctx`
