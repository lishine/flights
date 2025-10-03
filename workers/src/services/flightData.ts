import { getCurrentIdtTime } from '../utils/dateTime'
import { VERCEL_FLIGHTS_API_URL } from '../utils/constants'
import { ofetch } from 'ofetch'
import type { Env } from '../env'
import type { Flight, VercelApiResponse, VercelFlightResponse } from '../types'

// Legacy functions - replaced by JSON-based versions
// export const getCurrentFlights = (ctx: DurableObjectState) => {
// 	const result = ctx.storage.sql.exec('SELECT * FROM flights ORDER BY eta DESC')
// 	const results = result.toArray() as Flight[]
//
// 	if (!results || results.length === 0) {
// 		console.error('No flight data available in SQLite')
// 		throw new Error('Flight data unavailable')
// 	}
// 	console.log('Using Durable Object SQLite flight data')
// 	return results
// }

// export const getSubscribedFlights = (ctx: DurableObjectState) => {
// 	const result = ctx.storage.sql.exec(`
// 		SELECT f.* FROM flights f
// 		INNER JOIN subscriptions s ON f.id = s.flight_id
// 		ORDER BY f.eta DESC
// 	`)
// 	const results = result.toArray() as Flight[]
// 	console.log(`Found ${results.length} subscribed flights`)
// 	return results
// }

// export const getUserTrackedFlightsWithData = (userId: number, env: Env, ctx: DurableObjectState) => {
// 	const result = ctx.storage.sql.exec(
// 		`SELECT f.id, f.flight_number, f.status, f.sta, f.eta, f.city, f.airline, f.created_at, f.updated_at
// 		 FROM flights f
// 		 INNER JOIN subscriptions s ON f.id = s.flight_id
// 		 WHERE s.telegram_id = ?
// 		 ORDER BY f.eta ASC`,
// 		userId
// 	)
// 	return result.toArray() as Flight[]
// }

// export const getCurrentFlightData = (flightNumber: string, ctx: DurableObjectState) => {
// 	const result = ctx.storage.sql.exec('SELECT * FROM flights WHERE flight_number = ? ORDER BY eta ASC', flightNumber)
// 	const results = result.toArray() as Flight[]
// 	return results?.[0]
// }

// export const getNextFutureFlight = (flightNumber: string, ctx: DurableObjectState) => {
// 	const nowIdt = getCurrentIdtTime()
// 	const result = ctx.storage.sql.exec(
// 		'SELECT * FROM flights WHERE flight_number = ? AND eta > ? ORDER BY eta ASC',
// 		flightNumber,
// 		nowIdt.getTime()
// 	)
// 	const results = result.toArray() as Flight[]
// 	return results?.[0]
// }

// export const getFlightIdByNumber = (flightNumber: string, ctx: DurableObjectState) => {
// 	const futureFlight = getNextFutureFlight(flightNumber, ctx)
// 	if (futureFlight) {
// 		return futureFlight.id
// 	}
//
// 	const flight = getCurrentFlightData(flightNumber, ctx)
// 	return flight?.id
// }

export const generateFakeFlights = (): Flight[] => {
	const now = getCurrentIdtTime()
	const futureTime1 = new Date(now.getTime() + 2 * 60 * 60 * 1000) // 2 hours from now
	const futureTime2 = new Date(now.getTime() + 3 * 60 * 60 * 1000) // 3 hours from now
	const futureTime3 = new Date(now.getTime() + 4 * 60 * 60 * 1000) // 4 hours from now

	return [
		{
			id: `FAKE_LY001_${futureTime1.getTime()}`,
			flight_number: 'LY001',
			status: 'SCHEDULED',
			sta: futureTime1.getTime(),
			eta: futureTime1.getTime(),
			city: 'New York',
			airline: 'EL AL Israel Airlines',
			created_at: now.getTime(),
			updated_at: now.getTime(),
		},
		{
			id: `FAKE_BA456_${futureTime2.getTime()}`,
			flight_number: 'BA456',
			status: 'SCHEDULED',
			sta: futureTime2.getTime(),
			eta: futureTime2.getTime(),
			city: 'London',
			airline: 'British Airways',
			created_at: now.getTime(),
			updated_at: now.getTime(),
		},
		{
			id: `FAKE_LH789_${futureTime3.getTime()}`,
			flight_number: 'LH789',
			status: 'SCHEDULED',
			sta: futureTime3.getTime(),
			eta: futureTime3.getTime(),
			city: 'Frankfurt',
			airline: 'Lufthansa',
			created_at: now.getTime(),
			updated_at: now.getTime(),
		},
	]
}

// Legacy function - replaced by getNotTrackedFlightsFromStatus
// export const getNotTrackedFlights = (chatId: number, ctx: DurableObjectState) => {
// 	const result = ctx.storage.sql.exec(
// 		`
// 		SELECT f.* FROM flights f
// 		LEFT JOIN subscriptions s ON f.id = s.flight_id AND s.telegram_id = ?
// 		WHERE s.flight_id IS NULL
// 		ORDER BY f.eta ASC
// 		`,
// 		chatId
// 	)
//
// 	return result.toArray() as Flight[]
// }

/**
 * Clean up subscriptions for completed flights (JSON version)
 * Uses JSON flight data instead of flights table
 */
export const cleanupCompletedFlightsFromStatus = (env: Env, ctx: DurableObjectState): number => {
	const nowIdt = getCurrentIdtTime()
	const cutoffTimestamp = nowIdt.getTime() - 1 * 60 * 60 * 1000 // 1 hour ago

	console.log(`Cleanup: cutoff=${new Date(cutoffTimestamp).toLocaleString()}`)

	try {
		const currentFlights = getCurrentFlightsFromStatus(ctx)

		// Get completed flight IDs (LANDED, CANCELED, or ETA passed by 1+ hours)
		const completedFlightIds = currentFlights
			.filter(
				(flight) => flight.status === 'LANDED' || flight.status === 'CANCELED' || flight.eta < cutoffTimestamp
			)
			.map((flight) => flight.id)

		if (completedFlightIds.length === 0) {
			console.log('Cleanup: no completed flights found')
			return 0
		}

		// Delete subscriptions for completed flights
		let totalDeleted = 0
		for (const flightId of completedFlightIds) {
			const result = ctx.storage.sql.exec(
				'DELETE FROM subscriptions WHERE flight_id = ? RETURNING flight_id',
				flightId
			)
			totalDeleted += result.toArray().length
		}

		console.log(
			`Cleanup: deleted ${totalDeleted} subscription(s) for ${completedFlightIds.length} completed flights`
		)
		return totalDeleted
	} catch (error) {
		console.error('Cleanup failed, no current flights available:', error)
		return 0
	}
}

export const detectChanges = (prevFlight: Flight, currentFlight: Flight) => {
	const changes: string[] = []
	if (prevFlight.status !== currentFlight.status) {
		changes.push(`📍 Status: ${currentFlight.status}`)
	}
	if (prevFlight.eta !== currentFlight.eta) {
		const prevDt = new Date(prevFlight.eta)
		const currentDt = new Date(currentFlight.eta)
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
	const rawApiData = await ofetch<VercelApiResponse>(VERCEL_FLIGHTS_API_URL)
	console.log('fetched from vercel', rawApiData.Flights.length)

	const filterAndTransformFlights = (rawFlights: VercelFlightResponse[]) => {
		return rawFlights.map((flight) => {
			const flightId = `${flight.fln}_${flight.sta}`

			return {
				id: flightId,
				flight_number: flight.fln,
				status: flight.status,
				sta: flight.sta,
				eta: flight.eta,
				city: flight.city,
				airline: flight.airline,
				created_at: getCurrentIdtTime().getTime(),
				updated_at: getCurrentIdtTime().getTime(),
			}
		})
	}

	const transformedFlights = filterAndTransformFlights(rawApiData.Flights || [])

	console.log(`Filtered to ${transformedFlights.length} flights from ${rawApiData.Flights?.length || 0} raw flights`)

	return transformedFlights
}

export const writeStatusData = (ctx: DurableObjectState, flightCount: number) => {
	const timestamp = getCurrentIdtTime().getTime().toString() // Store as milliseconds timestamp

	// Increment update counter
	ctx.storage.sql.exec(
		"INSERT INTO status (key, value) VALUES ('updateCount', '1') ON CONFLICT(key) DO UPDATE SET value = CAST((CAST(value AS INTEGER) + 1) AS TEXT)"
	)

	// Store last updated timestamp
	ctx.storage.sql.exec(
		'INSERT INTO status (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = EXCLUDED.value',
		'lastUpdated',
		timestamp
	)

	// Store flight count
	if (flightCount !== undefined) {
		ctx.storage.sql.exec(
			'INSERT INTO status (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = EXCLUDED.value',
			'dataLength',
			flightCount.toString()
		)
	}
}

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

// ==========================================
// NEW JSON-BASED FLIGHT DATA FUNCTIONS
// ==========================================

let flights: Flight[]
export const getCurrentFlightsFromStatus = (ctx: DurableObjectState): Flight[] => {
	if (flights) {
		return flights
	}
	const result = ctx.storage.sql.exec('SELECT value FROM status WHERE key = ?', 'flights_data')
	const row = result.toArray()[0] as { value: string } | undefined

	if (!row?.value) {
		console.log('No previous flight data found in status table')
		flights = []
	} else {
		try {
			flights = JSON.parse(row.value) as Flight[]
		} catch (error) {
			console.error('Failed to parse flights JSON:', error)
			flights = []
		}
	}
	return flights
}

/**
 * Store flights as JSON in status table (single SQLite write!)
 */
export const storeFlightsInStatus = (flights: Flight[], ctx: DurableObjectState): void => {
	ctx.storage.sql.exec(
		'INSERT OR REPLACE INTO status (key, value) VALUES (?, ?)',
		'flights_data',
		JSON.stringify(flights)
	)
	console.log(`Stored ${flights.length} flights as JSON in status table`)
}

/**
 * Get user's tracked flights from JSON data combined with subscriptions
 */
export const getUserTrackedFlightsFromStatus = (userId: number, ctx: DurableObjectState): Flight[] => {
	const allFlights = getCurrentFlightsFromStatus(ctx)

	// Get user's subscribed flight IDs from SQLite
	const result = ctx.storage.sql.exec('SELECT flight_id FROM subscriptions WHERE telegram_id = ?', userId)
	const subscribedIds = result.toArray().map((row) => (row as { flight_id: string }).flight_id)

	// Filter and sort flights
	return allFlights.filter((flight) => subscribedIds.includes(flight.id)).sort((a, b) => a.eta - b.eta)
}

/**
 * Get flight by ID from JSON data
 */
export const getFlightByIdFromStatus = (flightId: string, ctx: DurableObjectState): Flight | undefined => {
	const allFlights = getCurrentFlightsFromStatus(ctx)
	return allFlights.find((flight) => flight.id === flightId)
}

/**
 * Get flight by flight number from JSON data
 */
export const getFlightByNumberFromStatus = (flightNumber: string, ctx: DurableObjectState): Flight | undefined => {
	const allFlights = getCurrentFlightsFromStatus(ctx)
	return allFlights.find((flight) => flight.flight_number === flightNumber)
}

/**
 * Get flights not tracked by user (for suggestions)
 */
export const getNotTrackedFlightsFromStatus = (chatId: number, ctx: DurableObjectState): Flight[] => {
	const allFlights = getCurrentFlightsFromStatus(ctx)

	// Get user's subscribed flight IDs
	const result = ctx.storage.sql.exec('SELECT flight_id FROM subscriptions WHERE telegram_id = ?', chatId)
	const subscribedIds = result.toArray().map((row) => (row as { flight_id: string }).flight_id)

	// Filter out tracked flights and sort
	return allFlights.filter((flight) => !subscribedIds.includes(flight.id)).sort((a, b) => a.eta - b.eta)
}

/**
 * Get flight ID by flight number (prioritizing future flights) from JSON data
 */
export const getFlightIdByNumberFromStatus = (flightNumber: string, ctx: DurableObjectState): string | undefined => {
	const nowIdt = getCurrentIdtTime()
	const allFlights = getCurrentFlightsFromStatus(ctx)

	// First try to find future flights
	const futureFlights = allFlights
		.filter((flight) => flight.flight_number === flightNumber && flight.eta > nowIdt.getTime())
		.sort((a, b) => a.eta - b.eta)

	if (futureFlights.length > 0) {
		return futureFlights[0].id
	}

	// Fallback to any flight with that number
	const flight = allFlights.find((flight) => flight.flight_number === flightNumber)
	return flight?.id
}
