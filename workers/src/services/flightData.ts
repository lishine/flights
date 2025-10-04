import { getCurrentIdtTime, getIdtTimeString } from '../utils/dateTime'
import { VERCEL_FLIGHTS_API_URL } from '../utils/constants'
import { ofetch } from 'ofetch'
import type { Env } from '../env'
import type { Flight, VercelApiResponse, VercelFlightResponse, DOProps } from '../types'
import { sendTelegramMessage, sendAdmin } from '../services/telegram'

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

export const generateFakeFlights = (ctx: DurableObjectState<DOProps>): Flight[] => {
	const now = getCurrentIdtTime(ctx)
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
export const cleanupCompletedFlightsFromStatus = (env: Env, ctx: DurableObjectState<DOProps>): number => {
	const nowIdt = getCurrentIdtTime(ctx)
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

export const detectChanges = (prevFlight: Flight, currentFlight: Flight, env: Env, ctx: DurableObjectState<DOProps>) => {
	const changes: string[] = []
	const changeId = Math.random().toString(36).substring(7)
	
	if (env) {
		sendAdmin(
			`🔍 [CHANGE-${changeId}] Detecting changes for flight ${currentFlight.flight_number} (${currentFlight.id})`,
			env,
			ctx
		)
	}
	
	if (prevFlight.status !== currentFlight.status) {
		changes.push(`📍 Status: ${currentFlight.status}`)
		if (env) {
			sendAdmin(
				`🔍 [CHANGE-${changeId}] Status change: ${prevFlight.status} -> ${currentFlight.status}`,
				env,
				ctx
			)
		}
	}
	if (prevFlight.eta !== currentFlight.eta) {
		const prevDt = getIdtTimeString(prevFlight.eta)
		const currentDt = getIdtTimeString(currentFlight.eta)
		const prevTime = prevDt ?? 'TBA'
		const currentTime = currentDt ?? 'TBA'
		changes.push(`🕒 Arrival Time: ${currentTime} (was ${prevTime})`)
		if (env) {
			sendAdmin(
				`🔍 [CHANGE-${changeId}] ETA change: ${prevTime} -> ${currentTime}`,
				env,
				ctx
			)
		}
	}
	if (prevFlight.city !== currentFlight.city) {
		changes.push(`🏙️ City: ${currentFlight.city || 'Unknown'}`)
		if (env) {
			sendAdmin(
				`🔍 [CHANGE-${changeId}] City change: ${prevFlight.city} -> ${currentFlight.city}`,
				env,
				ctx
			)
		}
	}
	if (prevFlight.airline !== currentFlight.airline) {
		changes.push(`✈️ Airline: ${currentFlight.airline || 'Unknown'}`)
		if (env) {
			sendAdmin(
				`🔍 [CHANGE-${changeId}] Airline change: ${prevFlight.airline} -> ${currentFlight.airline}`,
				env,
				ctx
			)
		}
	}
	
	if (changes.length === 0) {
		sendAdmin(
			`🔍 [CHANGE-${changeId}] No changes detected for flight ${currentFlight.flight_number}`,
			env,
			ctx
		)
	} else {
		sendAdmin(
			`🔍 [CHANGE-${changeId}] Total changes: ${changes.length}`,
			env,
			ctx
		)
	}
	
	return changes
}

export const fetchLatestFlights = async (env: Env, ctx: DurableObjectState<DOProps>) => {
	const rawApiData = await ofetch<VercelApiResponse>(VERCEL_FLIGHTS_API_URL)
	console.log('fetched from vercel', rawApiData.Flights.length)

   // await sendAdmin(getIdtTimeString(rawApiData.updated), env)
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
				created_at: getCurrentIdtTime(ctx).getTime(),
				updated_at: getCurrentIdtTime(ctx).getTime(),
			}
		})
	}

	const transformedFlights = filterAndTransformFlights(rawApiData.Flights || [])

	console.log(`Filtered to ${transformedFlights.length} flights from ${rawApiData.Flights?.length || 0} raw flights`)

	return transformedFlights
}

export const writeStatusData = (ctx: DurableObjectState<DOProps>, flightCount: number) => {
	const timestamp = getCurrentIdtTime(ctx).getTime().toString() // Store as milliseconds timestamp

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

export const writeErrorStatus = (ctx: DurableObjectState<DOProps>, error: Error | string) => {
	const errorTimestamp = getCurrentIdtTime(ctx).toISOString()
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

export const writeFlightsData = (flights: Flight[], ctx: DurableObjectState<DOProps>) => {
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

/**
 * Store flights as JSON in status table (single SQLite write!)
 */
export const storeFlightsInStatus = (flights: Flight[], ctx: DurableObjectState<DOProps>): void => {
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
export const getUserTrackedFlightsFromStatus = (userId: number, ctx: DurableObjectState<DOProps>): Flight[] => {
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
export const getFlightByIdFromStatus = (flightId: string, ctx: DurableObjectState<DOProps>): Flight | undefined => {
	const allFlights = getCurrentFlightsFromStatus(ctx)
	return allFlights.find((flight) => flight.id === flightId)
}

/**
 * Get flight by flight number from JSON data
 */
export const getFlightByNumberFromStatus = (flightNumber: string, ctx: DurableObjectState<DOProps>): Flight | undefined => {
	const allFlights = getCurrentFlightsFromStatus(ctx)
	return allFlights.find((flight) => flight.flight_number === flightNumber)
}

/**
 * Get flights not tracked by user (for suggestions)
 */
export const getNotTrackedFlightsFromStatus = (chatId: number, ctx: DurableObjectState<DOProps>): Flight[] => {
	const allFlights = getCurrentFlightsFromStatus(ctx)

	// Get user's subscribed flight IDs
	const result = ctx.storage.sql.exec('SELECT flight_id FROM subscriptions WHERE telegram_id = ?', chatId)
	const subscribedIds = result.toArray().map((row) => (row as { flight_id: string }).flight_id)

	// Filter out tracked flights and sort
	return allFlights
		.filter((flight) => !subscribedIds.includes(flight.id))
		.sort((a, b) => a.eta - b.eta)
		.filter((flight) => flight.status !== 'LANDED' && flight.status !== 'CANCELED')
}

/**
 * Get flight ID by flight number (prioritizing future flights) from JSON data
 */
export const getFlightIdByNumberFromStatus = (flightNumber: string, ctx: DurableObjectState<DOProps>): string | undefined => {
	const nowIdt = getCurrentIdtTime(ctx)
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
