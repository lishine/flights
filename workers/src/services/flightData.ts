import { fetchVercel } from '../utils/validation'
import { getCurrentIdtTime } from '../utils/dateTime'
import type { Env } from '../env'
import type { Flight, VercelFlightResponse } from '../types'

// Convert timestamp to Date object
function getIdtDateTime(timestamp: number | null): Date | null {
	if (!timestamp) return null
	return new Date(timestamp)
}

export const getCurrentFlights = (ctx: DurableObjectState) => {
	const result = ctx.storage.sql.exec('SELECT * FROM flights ORDER BY eta DESC')
	const results = result.toArray() as Flight[]

	if (!results || results.length === 0) {
		console.error('No flight data available in SQLite')
		throw new Error('Flight data unavailable')
	}
	console.log('Using Durable Object SQLite flight data')
	return results
}

export const getSubscribedFlights = (ctx: DurableObjectState) => {
	const result = ctx.storage.sql.exec(`
		SELECT f.* FROM flights f
		INNER JOIN subscriptions s ON f.id = s.flight_id
		WHERE s.auto_cleanup_at IS NULL
		ORDER BY f.eta DESC
	`)
	const results = result.toArray() as Flight[]
	console.log(`Found ${results.length} subscribed flights`)
	return results
}

export const getUserTrackedFlightsWithData = (userId: number, env: Env, ctx: DurableObjectState) => {
	const result = ctx.storage.sql.exec(
		`SELECT f.id, f.flight_number, f.status, f.sta, f.eta, f.city, f.airline, f.created_at, f.updated_at
		 FROM flights f
		 INNER JOIN subscriptions s ON f.id = s.flight_id
		 WHERE s.telegram_id = ? AND s.auto_cleanup_at IS NULL
		 ORDER BY f.eta ASC`,
		userId
	)
	return result.toArray() as Flight[]
}

export const getCurrentFlightData = (flightNumber: string, ctx: DurableObjectState) => {
	const result = ctx.storage.sql.exec('SELECT * FROM flights WHERE flight_number = ? ORDER BY eta ASC', flightNumber)
	const results = result.toArray() as Flight[]
	return results?.[0]
}

export const getNextFutureFlight = (flightNumber: string, ctx: DurableObjectState) => {
	const nowIdt = getCurrentIdtTime()
	const result = ctx.storage.sql.exec(
		'SELECT * FROM flights WHERE flight_number = ? AND eta > ? ORDER BY eta ASC',
		flightNumber,
		nowIdt.getTime()
	)
	const results = result.toArray() as Flight[]
	return results?.[0]
}

export const getFlightIdByNumber = (flightNumber: string, ctx: DurableObjectState) => {
	// First try to get the next future flight
	const futureFlight = getNextFutureFlight(flightNumber, ctx)
	if (futureFlight) {
		return futureFlight.id
	}

	// If no future flight found, fall back to the soonest arrival (including past ones)
	const flight = getCurrentFlightData(flightNumber, ctx)
	return flight?.id
}

export const getNotTrackedFlights = (chatId: number, ctx: DurableObjectState) => {
	const result = ctx.storage.sql.exec(
		`
		SELECT f.* FROM flights f
		LEFT JOIN subscriptions s ON f.id = s.flight_id AND s.telegram_id = ? AND s.auto_cleanup_at IS NULL
		WHERE s.flight_id IS NULL
		ORDER BY f.eta ASC
		`,
		chatId
	)

	return result.toArray() as Flight[]
}

export const cleanupCompletedFlights = (currentFlights: Flight[], env: Env, ctx: DurableObjectState) => {
	const nowIdt = getCurrentIdtTime()
	const cutoffIdt = new Date(nowIdt.getTime() - 2 * 60 * 60 * 1000) // 2 hours ago
	console.log(`Cleanup: cutoff=${cutoffIdt.toLocaleString()}`)

	for (const flight of currentFlights) {
		const arrivalIdt = getIdtDateTime(flight.eta)
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
export const detectChanges = (prevFlight: Flight, currentFlight: Flight) => {
	const changes: string[] = []
	if (prevFlight.status !== currentFlight.status) {
		changes.push(`📍 Status: ${currentFlight.status}`)
	}
	if (prevFlight.eta !== currentFlight.eta) {
		const prevDt = getIdtDateTime(prevFlight.eta)
		const currentDt = getIdtDateTime(currentFlight.eta)
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

export const fetchLatestFlights = async (env: Env, ctx: DurableObjectState) => {
	const response = await fetchVercel('https://flights-taupe.vercel.app/api/tlv-arrivals')
	const rawApiData = (await response.json()) as { Flights: VercelFlightResponse[] }
	console.log('API data sample:', JSON.stringify(rawApiData.Flights.slice(0, 2), null, 2))

	// Filter and transform the raw flight data
	const transformedFlights = filterAndTransformFlights(rawApiData.Flights || [])

	console.log(`Filtered to ${transformedFlights.length} flights from ${rawApiData.Flights?.length || 0} raw flights`)

	// Return flights data and metadata for cron to handle status writes
	return {
		flights: transformedFlights,
		metadata: {
			lastUpdated: Date.now().toString(),
			updateCount: '1', // This will be incremented by the write function
			dataLength: rawApiData.Flights.length.toString(),
		},
	}
}

// Write status data to the status table
export const writeStatusData = (ctx: DurableObjectState, updates: Record<string, string>) => {
	for (const [key, value] of Object.entries(updates)) {
		if (key === 'updateCount') {
			// Special handling for updateCount - increment existing value
			ctx.storage.sql.exec(
				"INSERT INTO status (key, value) VALUES (?, '1') ON CONFLICT(key) DO UPDATE SET value = CAST((CAST(value AS INTEGER) + 1) AS TEXT)",
				key
			)
		} else {
			// Standard upsert for other fields
			ctx.storage.sql.exec(
				'INSERT INTO status (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = EXCLUDED.value',
				key,
				value
			)
		}
	}
}

// Write error status to the status table
export const writeErrorStatus = (ctx: DurableObjectState, error: Error | string) => {
	const errorTimestamp = getCurrentIdtTime().toISOString()
	const errorMessage = error instanceof Error ? error.message : error

	ctx.storage.sql.exec(
		'INSERT OR REPLACE INTO status (key, value) VALUES (?, ?)',
		'last-error',
		JSON.stringify({
			error: errorMessage,
			timestamp: errorTimestamp,
		})
	)
}

// Write flights data to the flights table
export const writeFlightsData = (flights: Flight[], ctx: DurableObjectState) => {
	// Use individual INSERT OR REPLACE statements instead of batch for Durable Object SQLite
	for (const flight of flights) {
		ctx.storage.sql.exec(
			`INSERT INTO flights (id, flight_number, status, sta, eta, city, airline, created_at, updated_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
			 ON CONFLICT(flight_number, sta) DO UPDATE SET
			 status = EXCLUDED.status,
			 eta = EXCLUDED.eta,
			 city = EXCLUDED.city,
			 airline = EXCLUDED.airline,
			 updated_at = EXCLUDED.updated_at`,
			flight.id,
			flight.flight_number,
			flight.status,
			flight.sta,
			flight.eta,
			flight.city,
			flight.airline,
			flight.created_at,
			flight.updated_at
		)
	}
}

// Filter and transform raw flight data from Vercel API
export const filterAndTransformFlights = (rawFlights: VercelFlightResponse[]) => {
	// Use provided current time or get current Israel time
	const nowIdt = getCurrentIdtTime()

	return rawFlights.map((flight) => {
		// Generate composite ID from flight number and scheduled arrival time
		const flightId = `${flight.fln}_${flight.sta}`

		return {
			id: flightId,
			flight_number: flight.fln,
			status: flight.status,
			sta: flight.sta,
			eta: flight.eta,
			city: flight.city,
			airline: flight.airline,
			created_at: nowIdt.getTime(),
			updated_at: nowIdt.getTime(),
		}
	})
}
