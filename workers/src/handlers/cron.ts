import { fetchLatestFlights, cleanupCompletedFlights, getCurrentFlights, detectChanges } from '../services/flightData'
import { getCurrentIdtTime } from '../utils/dateTime'
import { sendFlightAlerts } from './alerts'
import type { Env } from '../env'
import type { D1Flight } from '../types'

// Schema initialization function for Durable Object SQLite
async function initializeSchema(ctx: DurableObjectState) {
	// Create flights table
	ctx.storage.sql.exec(`
		CREATE TABLE IF NOT EXISTS flights (
			id TEXT PRIMARY KEY NOT NULL,
			flight_number TEXT NOT NULL,
			status TEXT NOT NULL,
			scheduled_arrival_time INTEGER,
			estimated_arrival_time INTEGER,
			city TEXT,
			airline TEXT,
			created_at INTEGER DEFAULT (strftime('%s', 'now')),
			updated_at INTEGER DEFAULT (strftime('%s', 'now')),
			UNIQUE(flight_number, scheduled_arrival_time)
		)
	`)

	// Create indexes for flights
	ctx.storage.sql.exec(`
		CREATE INDEX IF NOT EXISTS idx_flight_number ON flights (flight_number);
		CREATE INDEX IF NOT EXISTS idx_status ON flights (status);
		CREATE INDEX IF NOT EXISTS idx_scheduled_arrival ON flights (scheduled_arrival_time);
	`)

	// Create subscriptions table
	ctx.storage.sql.exec(`
		CREATE TABLE IF NOT EXISTS subscriptions (
			telegram_id TEXT,
			flight_id TEXT,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			auto_cleanup_at DATETIME NULL,
			PRIMARY KEY (telegram_id, flight_id),
			FOREIGN KEY (flight_id) REFERENCES flights(id)
		)
	`)

	// Create indexes for subscriptions
	ctx.storage.sql.exec(`
		CREATE INDEX IF NOT EXISTS idx_active_subs ON subscriptions(auto_cleanup_at) WHERE auto_cleanup_at IS NULL;
		CREATE INDEX IF NOT EXISTS idx_cleanup_ready ON subscriptions(auto_cleanup_at) WHERE auto_cleanup_at IS NOT NULL;
		CREATE INDEX IF NOT EXISTS idx_user_subs ON subscriptions(telegram_id);
		CREATE INDEX IF NOT EXISTS idx_flight_subs ON subscriptions(flight_id);
		CREATE INDEX IF NOT EXISTS idx_tracked_flights ON subscriptions(telegram_id, auto_cleanup_at) WHERE auto_cleanup_at IS NULL;
	`)

	// Create status table
	ctx.storage.sql.exec(`
		CREATE TABLE IF NOT EXISTS status (
			key TEXT PRIMARY KEY NOT NULL,
			value TEXT
		)
	`)
}

export async function runScheduledJob(env: Env, ctx: DurableObjectState): Promise<Response> {
	try {
		// Initialize schema
		await initializeSchema(ctx)

		// Get update counter from status table using Durable Object SQLite
		const counterResult = ctx.storage.sql.exec('SELECT value FROM status WHERE key = ?', 'update-counter')
		const counterRow = counterResult.toArray()[0]
		const currentCount = Number(counterRow?.value || '0') + 1

		// OPTIMIZATION: Get all active subscriptions to determine which flights to fetch
		const subsResult = ctx.storage.sql.exec(
			'SELECT DISTINCT flight_id FROM subscriptions WHERE auto_cleanup_at IS NULL'
		)
		const activeSubscriptions = subsResult.toArray() as unknown as { flight_id: string }[]

		// If no active subscriptions, skip the expensive flight fetching
		if (activeSubscriptions.length === 0) {
			console.log('No active subscriptions, skipping flight fetch')
			return new Response('No active subscriptions to check')
		}

		// Extract unique flight numbers from subscriptions
		const subscribedFlightIds = activeSubscriptions.map((sub) => sub.flight_id)
		console.log(`Checking ${subscribedFlightIds.length} subscribed flights`)

		// Call Vercel API with specific flight IDs instead of fetching all flights
		const flightIdsParam = subscribedFlightIds.join(',')
		const vercelUrl = `https://flights-taupe.vercel.app/api/tlv-arrivals?flights=${flightIdsParam}`
		const response = await fetch(vercelUrl)
		const rawData = (await response.json()) as { Flights: D1Flight[] }

		if (!response.ok) {
			console.error('Failed to fetch flights from Vercel API')
			return new Response('Failed to fetch flights', { status: 500 })
		}

		// Read previous flights from SQLite flights table (current state before update) - only for subscribed flights
		const placeholders = subscribedFlightIds.map(() => '?').join(',')
		const previousResult = ctx.storage.sql.exec(
			`SELECT * FROM flights WHERE id IN (${placeholders})`,
			...subscribedFlightIds
		)
		const previousFlights = previousResult.toArray() as unknown as D1Flight[]
		const previousFlightsMap = Object.fromEntries(previousFlights.map((f) => [f.id, f])) as Record<string, D1Flight>

		// Use the already fetched flights data (optimization: we already called the API)
		const currentFlights = rawData.Flights
		const currentFlightsMap = Object.fromEntries(currentFlights.map((f) => [f.id, f])) as Record<string, D1Flight>

		// Detect changes and prepare alerts
		const changesByFlight: Record<string, { flight: D1Flight; changes: string[] }> = {}

		// Check for changes in existing flights
		for (const flightId in previousFlightsMap) {
			const prevFlight = previousFlightsMap[flightId]
			const currentFlight = currentFlightsMap[flightId]

			if (currentFlight) {
				const changes = detectChanges(prevFlight, currentFlight)
				if (changes.length > 0) {
					changesByFlight[flightId] = { flight: currentFlight, changes }
				}
			}
		}

		// Check for new flights (not in previous but in current)
		for (const flightId in currentFlightsMap) {
			if (!previousFlightsMap[flightId]) {
				// New flight - consider all fields as changes
				const newFlight = currentFlightsMap[flightId]
				const changes = [
					`📍 Status: ${newFlight.status}`,
					newFlight.estimated_arrival_time
						? `🕒 Arrival Time: ${new Date(newFlight.estimated_arrival_time).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}`
						: '🕒 Arrival Time: TBA',
					`🏙️ City: ${newFlight.city || 'Unknown'}`,
					`✈️ Airline: ${newFlight.airline || 'Unknown'}`,
				]
				changesByFlight[flightId] = { flight: newFlight, changes }
			}
		}

		// Send alerts for changes
		if (Object.keys(changesByFlight).length > 0) {
			await sendFlightAlerts(changesByFlight, env, ctx)
		}

		// Update status table with counters/timestamps using Durable Object SQLite
		const timestamp = getCurrentIdtTime().toISOString()
		ctx.storage.sql.exec(
			'INSERT OR REPLACE INTO status (key, value) VALUES (?, ?)',
			'update-counter',
			currentCount.toString()
		)
		ctx.storage.sql.exec(
			'INSERT OR REPLACE INTO status (key, value) VALUES (?, ?)',
			'last-write-timestamp',
			timestamp
		)

		// Cleanup completed flights
		await cleanupCompletedFlights(currentFlights, env, ctx)

		return new Response('Cron job completed')
	} catch (error) {
		console.error('Cron job failed:', error)
		const errorTimestamp = getCurrentIdtTime().toISOString()

		// Store error in Durable Object SQLite
		ctx.storage.sql.exec(
			'INSERT OR REPLACE INTO status (key, value) VALUES (?, ?)',
			'last-error',
			JSON.stringify({
				error: error instanceof Error ? error.message : 'Unknown error',
				timestamp: errorTimestamp,
			})
		)

		return new Response('Cron job failed', { status: 500 })
	}
}
