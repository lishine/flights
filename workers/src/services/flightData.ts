import { fetchVercel } from '../utils/validation'
import { getCurrentIdtTime } from '../utils/dateTime'
import type { Env } from '../env'
import type { D1Flight } from '../types'

// Convert timestamp to Date object
function getIdtDateTime(timestamp: number | null): Date | null {
	if (!timestamp) return null
	return new Date(timestamp)
}

export async function getCurrentFlights(ctx: DurableObjectState): Promise<D1Flight[]> {
	const result = ctx.storage.sql.exec('SELECT * FROM flights ORDER BY estimated_arrival_time DESC')
	const results = result.toArray() as unknown as D1Flight[]

	if (!results || results.length === 0) {
		console.error('No flight data available in SQLite')
		throw new Error('Flight data unavailable')
	}
	console.log('Using Durable Object SQLite flight data')
	return results
}

export async function getCurrentFlightData(
	flightNumber: string,
	ctx: DurableObjectState
): Promise<D1Flight | undefined> {
	const result = ctx.storage.sql.exec(
		'SELECT * FROM flights WHERE flight_number = ? ORDER BY estimated_arrival_time ASC',
		flightNumber
	)
	const results = result.toArray() as unknown as D1Flight[]
	return results?.[0]
}

export async function getNextFutureFlight(
	flightNumber: string,
	ctx: DurableObjectState
): Promise<D1Flight | undefined> {
	const nowIdt = getCurrentIdtTime()
	const result = ctx.storage.sql.exec(
		'SELECT * FROM flights WHERE flight_number = ? AND estimated_arrival_time > ? ORDER BY estimated_arrival_time ASC',
		flightNumber,
		nowIdt.getTime()
	)
	const results = result.toArray() as unknown as D1Flight[]
	return results?.[0]
}

export async function getFlightIdByNumber(flightNumber: string, ctx: DurableObjectState): Promise<string | undefined> {
	// First try to get the next future flight
	const futureFlight = await getNextFutureFlight(flightNumber, ctx)
	if (futureFlight) {
		return futureFlight.id
	}

	// If no future flight found, fall back to the soonest arrival (including past ones)
	const flight = await getCurrentFlightData(flightNumber, ctx)
	return flight?.id
}

export async function suggestFlightsToTrack(chatId: number, env: Env, ctx: DurableObjectState): Promise<D1Flight[]> {
	console.log('suggestFlightsToTrack')

	const [currentFlights, trackedFlightsResult] = await Promise.all([
		getCurrentFlights(ctx),
		ctx.storage.sql.exec(
			'SELECT flight_id FROM subscriptions WHERE telegram_id = ? AND auto_cleanup_at IS NULL',
			String(chatId)
		),
	])

	const trackedFlights = trackedFlightsResult.toArray() as unknown as { flight_id: string }[]

	const nowIdt = getCurrentIdtTime()
	const trackedFlightIds = new Set(trackedFlights.map((f) => f.flight_id))
	console.log({ trackedFlights, trackedFlightIds: trackedFlightIds.size })

	const eligibleFlights = currentFlights.filter((flight) => {
		// Skip if already tracked
		if (trackedFlightIds.has(flight.id)) {
			return false
		}
		const arrivalIdt = getIdtDateTime(flight.estimated_arrival_time)
		if (!arrivalIdt) {
			console.log(`Skipping flight ${flight.flight_number} due to invalid estimated_arrival_time`)
			return false
		}
		const hoursUntilArrival = (arrivalIdt.getTime() - nowIdt.getTime()) / (1000 * 60 * 60)
		const isFutureFlight = hoursUntilArrival >= 0.5
		const isSameOrFutureDay = arrivalIdt.toDateString() >= nowIdt.toDateString()
		return isFutureFlight && isSameOrFutureDay && flight.status !== 'LANDED' && flight.status !== 'CANCELED'
	})
	console.log({ 'eligibleFlights.length': eligibleFlights.length })

	return eligibleFlights
		.sort((a, b) => {
			const arrivalA = getIdtDateTime(a.estimated_arrival_time)
			const arrivalB = getIdtDateTime(b.estimated_arrival_time)
			return (arrivalA?.getTime() ?? 0) - (arrivalB?.getTime() ?? 0)
		})
		.slice(0, 5)
}

export async function cleanupCompletedFlights(currentFlights: D1Flight[], env: Env, ctx: DurableObjectState) {
	const nowIdt = getCurrentIdtTime()
	const cutoffIdt = new Date(nowIdt.getTime() - 2 * 60 * 60 * 1000) // 2 hours ago
	console.log(`Cleanup: cutoff=${cutoffIdt.toLocaleString()}`)

	for (const flight of currentFlights) {
		const arrivalIdt = getIdtDateTime(flight.estimated_arrival_time)
		if (!arrivalIdt) continue
		if (flight.status === 'LANDED' && arrivalIdt < cutoffIdt) {
			console.log(`Cleaning up landed flight: ${flight.flight_number}, arrived at ${arrivalIdt.toLocaleString()}`)
			// Delete from Durable Object SQLite
			ctx.storage.sql.exec('DELETE FROM flights WHERE id = ?', flight.id)
			// Clean up completed flights from subscriptions table
			ctx.storage.sql.exec(
				"UPDATE subscriptions SET auto_cleanup_at = DATETIME(CURRENT_TIMESTAMP, '+2 hours') WHERE flight_id = ? AND auto_cleanup_at IS NULL",
				flight.id
			)
		}
	}
}

// Export detectChanges function for use in cron.ts
export function detectChanges(prevFlight: D1Flight, currentFlight: D1Flight): string[] {
	const changes: string[] = []
	if (prevFlight.status !== currentFlight.status) {
		changes.push(`📍 Status: ${currentFlight.status}`)
	}
	if (prevFlight.estimated_arrival_time !== currentFlight.estimated_arrival_time) {
		const prevDt = getIdtDateTime(prevFlight.estimated_arrival_time)
		const currentDt = getIdtDateTime(currentFlight.estimated_arrival_time)
		const prevTime = prevDt?.toLocaleTimeString() ?? 'TBA'
		const currentTime = currentDt?.toLocaleTimeString() ?? 'TBA'
		changes.push(`🕒 Arrival Time: ${currentTime} (was ${prevTime})`)
	}
	if (prevFlight.city !== currentFlight.city) {
		changes.push(`🏙️ City: ${currentFlight.city || 'Unknown'}`)
	}
	if (prevFlight.airline !== currentFlight.airline) {
		changes.push(`✈️ Airline: ${currentFlight.airline || 'Unknown'}`)
	}
	return changes
}

export async function fetchLatestFlights(env: Env, ctx: DurableObjectState): Promise<D1Flight[]> {
	const response = await fetchVercel('https://flights-taupe.vercel.app/api/tlv-arrivals')
	const rawData = (await response.json()) as { Flights: D1Flight[] }
	console.log('API data sample:', JSON.stringify(rawData.Flights.slice(0, 2), null, 2))

	// Initialize or update status table with metadata using Durable Object SQLite
	ctx.storage.sql.exec(
		'INSERT INTO status (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = EXCLUDED.value',
		'lastUpdated',
		Date.now().toString()
	)

	ctx.storage.sql.exec(
		"INSERT INTO status (key, value) VALUES (?, '1') ON CONFLICT(key) DO UPDATE SET value = CAST((CAST(value AS INTEGER) + 1) AS TEXT)",
		'updateCount'
	)

	ctx.storage.sql.exec(
		'INSERT INTO status (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = EXCLUDED.value',
		'dataLength',
		rawData.Flights.length.toString()
	)

	const newFlights: D1Flight[] = rawData.Flights

	// Use individual INSERT OR REPLACE statements instead of batch for Durable Object SQLite
	for (const flight of newFlights) {
		ctx.storage.sql.exec(
			`INSERT INTO flights (id, flight_number, status, scheduled_arrival_time, estimated_arrival_time, city, airline, created_at, updated_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
			 ON CONFLICT(flight_number, scheduled_arrival_time) DO UPDATE SET
			 status = EXCLUDED.status,
			 estimated_arrival_time = EXCLUDED.estimated_arrival_time,
			 city = EXCLUDED.city,
			 airline = EXCLUDED.airline,
			 updated_at = EXCLUDED.updated_at`,
			flight.id,
			flight.flight_number,
			flight.status,
			flight.scheduled_arrival_time,
			flight.estimated_arrival_time,
			flight.city,
			flight.airline,
			flight.created_at,
			flight.updated_at
		)
	}

	return newFlights
}
