
import { fetchVercel } from '../utils/validation'
import type { Env } from '../index'
import type { D1Flight, RawFlight } from '../types'
import { DateTime } from 'luxon'

// Cache for current Israel time (per request)
let cachedIsraelTime: Date | null = null

// Get current time in Israel timezone using Luxon for proper DST handling
export function getCurrentIdtTime(): Date {
	// Return cached time if available (same request)
	if (cachedIsraelTime) {
		return cachedIsraelTime
	}

	// Use Luxon to get current time in Israel timezone (handles DST automatically)
	const israelTime = DateTime.now().setZone('Asia/Jerusalem')
	// Convert to native Date object for consistency with rest of codebase
	cachedIsraelTime = new Date(israelTime.toISO()!)

	return cachedIsraelTime
}

// Convert timestamp to Date object
function getIdtDateTime(timestamp: number | null): Date | null {
	if (!timestamp) return null
	return new Date(timestamp)
}

export async function getCurrentFlights(env: Env): Promise<D1Flight[]> {
	const { results } = await env.DB.prepare(
		'SELECT * FROM flights ORDER BY estimated_arrival_time DESC'
	).all<D1Flight>()
	if (!results || results.length === 0) {
		console.error('No flight data available in D1')
		throw new Error('Flight data unavailable')
	}
	console.log('Using D1 flight data')
	return results
}

export async function getCurrentFlightData(flightNumber: string, env: Env): Promise<D1Flight | undefined> {
	const { results } = await env.DB.prepare(
		'SELECT * FROM flights WHERE flight_number = ? ORDER BY estimated_arrival_time ASC'
	)
		.bind(flightNumber)
		.all<D1Flight>()
	return results?.[0]
}

export async function getNextFutureFlight(flightNumber: string, env: Env): Promise<D1Flight | undefined> {
	const nowIdt = getCurrentIdtTime()
	const { results } = await env.DB.prepare(
		'SELECT * FROM flights WHERE flight_number = ? AND estimated_arrival_time > ? ORDER BY estimated_arrival_time ASC'
	)
		.bind(flightNumber, nowIdt.getTime())
		.all<D1Flight>()
	return results?.[0]
}

export async function getFlightIdByNumber(flightNumber: string, env: Env): Promise<string | undefined> {
	// First try to get the next future flight
	const futureFlight = await getNextFutureFlight(flightNumber, env)
	if (futureFlight) {
		return futureFlight.id
	}

	// If no future flight found, fall back to the soonest arrival (including past ones)
	const flight = await getCurrentFlightData(flightNumber, env)
	return flight?.id
}

export async function suggestFlightsToTrack(chatId: number, env: Env): Promise<D1Flight[]> {
	console.log('suggestFlightsToTrack')
	const [currentFlights, trackedFlights] = await Promise.all([
		getCurrentFlights(env),
		env.DB.prepare('SELECT flight_id FROM subscriptions WHERE telegram_id = ? AND auto_cleanup_at IS NULL')
			.bind(String(chatId))
			.all<{ flight_id: string }>(),
	])

	const nowIdt = getCurrentIdtTime()
	const trackedFlightIds = new Set((trackedFlights.results || []).map((f) => f.flight_id))
	console.log({ trackedFlights: trackedFlights.results, trackedFlightIds: trackedFlightIds.size })

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

export async function cleanupCompletedFlights(currentFlights: D1Flight[], env: Env) {
	const nowIdt = getCurrentIdtTime()
	const cutoffIdt = new Date(nowIdt.getTime() - (2 * 60 * 60 * 1000)) // 2 hours ago
	console.log(`Cleanup: cutoff=${cutoffIdt.toLocaleString()}`)

	for (const flight of currentFlights) {
		const arrivalIdt = getIdtDateTime(flight.estimated_arrival_time)
		if (!arrivalIdt) continue
		if (flight.status === 'LANDED' && arrivalIdt < cutoffIdt) {
			console.log(
				`Cleaning up landed flight: ${flight.flight_number}, arrived at ${arrivalIdt.toLocaleString()}`
			)
			// Delete from D1
			await env.DB.prepare('DELETE FROM flights WHERE id = ?').bind(flight.id).run()
			// Also clean up tracking data (assuming tracking data is still in KV for now, or will be migrated later)
			// Clean up completed flights from subscriptions table
			await env.DB.prepare(
				"UPDATE subscriptions SET auto_cleanup_at = DATETIME(CURRENT_TIMESTAMP, '+2 hours') WHERE flight_id = ? AND auto_cleanup_at IS NULL"
			)
				.bind(flight.id)
				.run()
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

export async function fetchLatestFlights(env: Env): Promise<D1Flight[]> {
	const response = await fetchVercel('https://flights-taupe.vercel.app/api/tlv-arrivals')
	const rawData = (await response.json()) as { Flights: RawFlight[] }
	console.log('Raw API data sample:', JSON.stringify(rawData.Flights.slice(0, 2), null, 2))

	// Initialize or update status table with metadata
	await env.DB.prepare(
		`
		INSERT INTO status (key, value)
		VALUES (?, ?)
		ON CONFLICT(key) DO UPDATE SET value = EXCLUDED.value
	`
	)
		.bind('lastUpdated', Date.now().toString())
		.run()

	await env.DB.prepare(
		`
		INSERT INTO status (key, value)
		VALUES (?, '1')
		ON CONFLICT(key) DO UPDATE SET value = CAST((CAST(value AS INTEGER) + 1) AS TEXT)
	`
	)
		.bind('updateCount')
		.run()

	await env.DB.prepare(
		`
		INSERT INTO status (key, value)
		VALUES (?, ?)
		ON CONFLICT(key) DO UPDATE SET value = EXCLUDED.value
	`
	)
		.bind('dataLength', rawData.Flights.length.toString())
		.run()

	const newFlights: D1Flight[] = rawData.Flights.map((flight) => {
		// Timestamps are already parsed by the API as numbers
		const scheduledArrival = flight.ScheduledDateTime
		const estimatedArrival = flight.UpdatedDateTime

		// Generate composite ID from flight number and scheduled arrival time
		const flightId = `${flight.Flight.replace(' ', '')}_${scheduledArrival ?? 'unknown'}`

		const nw = Date.now()
		return {
			id: flightId,
			flight_number: flight.Flight.replace(' ', ''),
			status: flight.Status,
			scheduled_arrival_time: scheduledArrival ?? null,
			estimated_arrival_time: estimatedArrival ?? null,
			city: flight.City,
			airline: flight.Airline,
			created_at: nw,
			updated_at: nw,
		}
	})

	const statements = newFlights.map((flight) =>
		env.DB.prepare(
			`INSERT INTO flights (id, flight_number, status, scheduled_arrival_time, estimated_arrival_time, city, airline, created_at, updated_at)
			          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
			          ON CONFLICT(flight_number, scheduled_arrival_time) DO UPDATE SET
			          status = EXCLUDED.status,
			          estimated_arrival_time = EXCLUDED.estimated_arrival_time,
			          city = EXCLUDED.city,
			          airline = EXCLUDED.airline,
			          updated_at = EXCLUDED.updated_at;`
		).bind(
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
	)
	await env.DB.batch(statements)

	return newFlights
}
