# Phase 2: Security Infrastructure

**Estimated Time**: 1 hour  
**Goal**: Implement all security measures before touching bot logic

---

## Changes in This Phase

### 1. Create Security Utilities

**File**: `workers/src/utils/security.ts` (NEW)

```typescript
import type { Env } from '../env'

/**
 * Validates webhook secret using constant-time comparison
 * Prevents timing attacks
 */
export const validateWebhookSecret = (receivedSecret: string | null, expectedSecret: string): boolean => {
	if (!receivedSecret) return false
	
	// Convert to buffers for constant-time comparison
	const received = new TextEncoder().encode(receivedSecret)
	const expected = new TextEncoder().encode(expectedSecret)
	
	if (received.length !== expected.length) return false
	
	// Constant-time comparison
	let result = 0
	for (let i = 0; i < received.length; i++) {
		result |= received[i] ^ expected[i]
	}
	
	return result === 0
}

/**
 * Check if user is admin
 */
export const isAdmin = (chatId: number | undefined, env: Env): boolean => {
	if (!chatId) return false
	const adminIds = env.ADMIN_CHAT_IDS.split(',').map(id => parseInt(id.trim()))
	return adminIds.includes(chatId)
}

/**
 * Sanitize string for Markdown to prevent injection
 */
export const sanitizeMarkdown = (text: string): string => {
	return text.replace(/[_*[\]()~`>#+=|{}.!-]/g, '\\$&')
}

/**
 * Validate flight code format
 */
export const isValidFlightCodeStrict = (code: string): boolean => {
	if (!code || code.length > 10) return false
	return /^[A-Z0-9]+$/.test(code.toUpperCase())
}
```

---

### 2. Create Rate Limiting Middleware

**File**: `workers/src/middleware/rateLimit.ts` (NEW)

```typescript
import type { DurableObjectState } from 'cloudflare:workers'

interface RateLimitConfig {
	maxRequests: number
	windowSeconds: number
}

const USER_LIMIT: RateLimitConfig = {
	maxRequests: 10,
	windowSeconds: 60
}

const IP_LIMIT: RateLimitConfig = {
	maxRequests: 50,
	windowSeconds: 60
}

/**
 * Check rate limit for a key
 */
const checkLimit = (key: string, config: RateLimitConfig, ctx: DurableObjectState): boolean => {
	const now = Math.floor(Date.now() / 1000)
	const windowStart = now - config.windowSeconds
	
	// Get current count
	const result = ctx.storage.sql.exec(
		'SELECT count, reset_at FROM rate_limits WHERE key = ?',
		key
	).one() as { count: number; reset_at: number } | undefined
	
	if (!result) {
		// First request - create entry
		ctx.storage.sql.exec(
			'INSERT INTO rate_limits (key, count, reset_at) VALUES (?, 1, ?)',
			key,
			now + config.windowSeconds
		)
		return true
	}
	
	// Check if window expired
	if (result.reset_at <= now) {
		// Reset window
		ctx.storage.sql.exec(
			'UPDATE rate_limits SET count = 1, reset_at = ? WHERE key = ?',
			now + config.windowSeconds,
			key
		)
		return true
	}
	
	// Check if under limit
	if (result.count >= config.maxRequests) {
		return false
	}
	
	// Increment count
	ctx.storage.sql.exec(
		'UPDATE rate_limits SET count = count + 1 WHERE key = ?',
		key
	)
	
	return true
}

/**
 * Check rate limits for user and IP
 */
export const checkRateLimits = (chatId: number, ip: string, ctx: DurableObjectState): { allowed: boolean; reason?: string } => {
	// Check user limit
	const userKey = `user:${chatId}`
	if (!checkLimit(userKey, USER_LIMIT, ctx)) {
		return { allowed: false, reason: 'user_limit_exceeded' }
	}
	
	// Check IP limit
	const ipKey = `ip:${ip}`
	if (!checkLimit(ipKey, IP_LIMIT, ctx)) {
		return { allowed: false, reason: 'ip_limit_exceeded' }
	}
	
	return { allowed: true }
}

/**
 * Get IP address from request
 */
export const getRequestIP = (request: Request): string => {
	return request.headers.get('CF-Connecting-IP') || 
	       request.headers.get('X-Forwarded-For')?.split(',')[0] || 
	       'unknown'
}
```

---

### 3. Create Admin Middleware

**File**: `workers/src/middleware/admin.ts` (NEW)

```typescript
import type { Env } from '../env'

export const isAdminUser = (chatId: number | undefined, env: Env): boolean => {
	if (!chatId) return false
	const adminIds = env.ADMIN_CHAT_IDS.split(',').map(id => parseInt(id.trim()))
	return adminIds.includes(chatId)
}

export class AdminRequiredError extends Error {
	constructor() {
		super('Admin privileges required')
		this.name = 'AdminRequiredError'
	}
}
```

---

### 4. Update Database Schema

**File**: `workers/src/schema.ts`

Add rate limiting table:

```typescript
export const initializeSchema = (ctx: DurableObjectState) => {
	// Existing flights table
	ctx.storage.sql.exec(`
		CREATE TABLE IF NOT EXISTS flights (
			id TEXT PRIMARY KEY NOT NULL,
			flight_number TEXT NOT NULL,
			status TEXT NOT NULL,
			sta INTEGER,
			eta INTEGER,
			city TEXT,
			airline TEXT,
			created_at INTEGER DEFAULT (strftime('%s', 'now')),
			updated_at INTEGER DEFAULT (strftime('%s', 'now')),
			UNIQUE(flight_number, sta)
		)
	`)

	ctx.storage.sql.exec(`
		CREATE INDEX IF NOT EXISTS idx_flight_number ON flights (flight_number);
		CREATE INDEX IF NOT EXISTS idx_status ON flights (status);
		CREATE INDEX IF NOT EXISTS idx_scheduled_arrival ON flights (sta);
	`)

	// Existing subscriptions table
	ctx.storage.sql.exec(`
		CREATE TABLE IF NOT EXISTS subscriptions (
			telegram_id TEXT,
			flight_id TEXT,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			PRIMARY KEY (telegram_id, flight_id),
			FOREIGN KEY (flight_id) REFERENCES flights(id)
		)
	`)

	ctx.storage.sql.exec(`
		CREATE INDEX IF NOT EXISTS idx_user_subs ON subscriptions(telegram_id);
		CREATE INDEX IF NOT EXISTS idx_flight_subs ON subscriptions(flight_id);
	`)

	// Existing status table
	ctx.storage.sql.exec(`
		CREATE TABLE IF NOT EXISTS status (
			key TEXT PRIMARY KEY NOT NULL,
			value TEXT
		)
	`)
	
	// NEW: Rate limiting table
	ctx.storage.sql.exec(`
		CREATE TABLE IF NOT EXISTS rate_limits (
			key TEXT PRIMARY KEY NOT NULL,
			count INTEGER NOT NULL DEFAULT 0,
			reset_at INTEGER NOT NULL
		)
	`)
	
	ctx.storage.sql.exec(`
		CREATE INDEX IF NOT EXISTS idx_rate_limit_reset ON rate_limits(reset_at);
	`)
}

export const resetSchema = (ctx: DurableObjectState) => {
	ctx.storage.sql.exec(`DROP TABLE IF EXISTS subscriptions`)
	ctx.storage.sql.exec(`DROP TABLE IF EXISTS flights`)
	ctx.storage.sql.exec(`DROP TABLE IF EXISTS status`)
	ctx.storage.sql.exec(`DROP TABLE IF EXISTS rate_limits`)

	// Then reinitialize with the new schema
	initializeSchema(ctx)
}
```

---

### 5. Update Main Webhook Handler

**File**: `workers/src/index.ts`

Add webhook secret validation:

```typescript
import { FlightDO } from './durable'
import { Env } from './env'
import { validateWebhookSecret } from './utils/security'

// Export the Durable Object class so the runtime can find it
export { FlightDO }

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const stub = env.FLIGHTS_DO.getByName('alarm')
		const url = new URL(request.url)

		if (request.method === 'POST' && url.pathname === '/webhook') {
			// SECURITY: Validate webhook secret
			const secretToken = request.headers.get('X-Telegram-Bot-Api-Secret-Token')
			
			if (!validateWebhookSecret(secretToken, env.WEBHOOK_SECRET)) {
				console.error('Invalid webhook secret received')
				return new Response('Forbidden', { status: 403 })
			}
			
			// Forward to Durable Object
			const dbStub = env.FLIGHTS_DO.getByName('alarm')
			return dbStub.fetch(request)
		}

		if (request.method === 'GET' && url.pathname === '/reset-schema') {
			return stub.fetch(request)
		}
		
		return new Response(`OK`, { status: 200 })
	},
}
```

---

### 6. Update Durable Object Handler

**File**: `workers/src/durable.ts`

Add rate limiting to webhook handling:

```typescript
import { DurableObject } from 'cloudflare:workers'
import { Env } from './env'
import { runScheduledJob } from './handlers/cron'
import { handleCommand } from './handlers/commands'
import { resetSchema } from './schema'
import { CRON_PERIOD_SECONDS } from './utils/constants'
import { checkRateLimits, getRequestIP } from './middleware/rateLimit'

export class FlightDO extends DurableObject<Env> {
	private alarmCount: number = 0

	constructor(ctx: DurableObjectState, env: Env) {
		console.log('constructor')
		super(ctx, env)

		ctx.blockConcurrencyWhile(async () => {
			this.alarmCount = ctx.storage.kv.get<number>('alarmCount') || 0

			let currentAlarm = await ctx.storage.getAlarm()
			if (currentAlarm == null) {
				console.log('constructor currentAlarm == null')
				const oneMinute = CRON_PERIOD_SECONDS * 1000
				console.log(`Setting initial alarm for ${oneMinute}ms from now`)
				await ctx.storage.setAlarm(Date.now() + oneMinute)
			}
		})
	}

	async fetch(request: Request): Promise<Response> {
		const url = new URL(request.url)

		if (request.method === 'POST' && url.pathname === '/webhook') {
			// SECURITY: Rate limiting
			try {
				const update = await request.json()
				
				// Extract chat ID for rate limiting
				let chatId: number | undefined
				if ('message' in update && update.message) {
					chatId = update.message.chat.id
				} else if ('callback_query' in update && update.callback_query?.message) {
					chatId = update.callback_query.message.chat.id
				}
				
				if (chatId) {
					const ip = getRequestIP(request)
					const rateLimitResult = checkRateLimits(chatId, ip, this.ctx)
					
					if (!rateLimitResult.allowed) {
						console.warn(`Rate limit exceeded for chatId ${chatId}, reason: ${rateLimitResult.reason}`)
						return new Response('Too Many Requests', { status: 429 })
					}
				}
				
				// Reconstruct request with parsed JSON
				const newRequest = new Request(request.url, {
					method: request.method,
					headers: request.headers,
					body: JSON.stringify(update)
				})
				
				return handleCommand(newRequest, this.env, this.ctx)
			} catch (error) {
				console.error('Error processing webhook:', error)
				return new Response('Internal Server Error', { status: 500 })
			}
		}

		// ... rest of existing fetch handler unchanged
		switch (url.pathname) {
			case '/reset-schema':
				resetSchema(this.ctx)
				return new Response('Schema reset successfully', {
					headers: { 'Content-Type': 'text/plain' },
				})
			case '/status':
				const count = this.getAlarmCount()
				return new Response(`FlightDO Status - Alarms fired: ${count}`, {
					headers: { 'Content-Type': 'text/plain' },
				})

			case '/reset':
				this.setAlarmCount(0)
				return new Response('Alarm count reset and new alarm set', {
					headers: { 'Content-Type': 'text/plain' },
				})

			default:
				const currentAlarm = await this.ctx.storage.getAlarm()
				const alarmTime = currentAlarm ? new Date(currentAlarm).toISOString() : 'Not set'
				const currentCount = this.getAlarmCount()

				return new Response(`FlightDO Active\nAlarms fired: ${currentCount}\nNext alarm: ${alarmTime}`, {
					headers: { 'Content-Type': 'text/plain' },
				})
		}
	}

	// ... rest of existing methods unchanged
	async alarm(): Promise<void> {
		console.log('alarm')
		runScheduledJob(this.env, this.ctx)
		const currentCount = this.getAlarmCount()
		const newCount = currentCount + 1
		console.log(`Alarm fired! Count: ${newCount}`)
		this.setAlarmCount(newCount)
		const period = CRON_PERIOD_SECONDS * 1000
		console.log(`Setting next alarm for ${period}ms from now`)
		await this.ctx.storage.setAlarm(Date.now() + period)
	}

	async sayHello(): Promise<string> {
		const result = this.ctx.storage.sql.exec("SELECT 'Hello, World!' as greeting").one()
		return result.greeting as string
	}

	private getAlarmCount(): number {
		return this.ctx.storage.kv.get<number>('alarmCount') || 0
	}

	private setAlarmCount(count: number): void {
		this.ctx.storage.kv.put('alarmCount', count)
	}
}
```

---

## Acceptance Criteria

### ✅ Code Compiles
```bash
cd workers
npx tsc --noEmit
```
No TypeScript errors.

### ✅ Build Succeeds
```bash
cd workers
npm run build
```
Creates dist/worker.js without errors.

### ✅ New Files Exist
```bash
ls workers/src/utils/security.ts
ls workers/src/middleware/rateLimit.ts
ls workers/src/middleware/admin.ts
```

### ✅ Schema Updated
Check `workers/src/schema.ts` includes `rate_limits` table.

---

## Testing

**Note**: Full testing happens in Phase 5. For now, just verify compilation.

---

## Rollback

If needed:
```bash
git checkout workers/src/index.ts
git checkout workers/src/durable.ts
git checkout workers/src/schema.ts
rm workers/src/utils/security.ts
rm workers/src/middleware/rateLimit.ts
rm workers/src/middleware/admin.ts
```

---

## Next Phase

Once all acceptance criteria pass, proceed to **Phase 3: Grammy Integration**.
