import { getCurrentIdtTime } from '../utils/dateTime'
import { VERCEL_FLIGHTS_API_URL } from '../utils/constants'
import { ofetch } from 'ofetch'
import type { Env } from '../env'
import type { Flight, VercelApiResponse, VercelFlightResponse } from '../types'

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
		 WHERE s.telegram_id = ?
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
	const futureFlight = getNextFutureFlight(flightNumber, ctx)
	if (futureFlight) {
		return futureFlight.id
	}

	const flight = getCurrentFlightData(flightNumber, ctx)
	return flight?.id
}

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

/**
 * Clean up subscriptions for completed flights
 * Criteria: LANDED, CANCELED, or ETA passed by 1+ hours
 * 
 * This runs independently of the API feed, so it works even if 
 * flights are no longer returned by the API
 */
export const cleanupCompletedFlights = (env: Env, ctx: DurableObjectState) => {
	const nowIdt = getCurrentIdtTime()
	const cutoffTimestamp = nowIdt.getTime() - 1 * 60 * 60 * 1000 // 1 hour ago
	
	console.log(`Cleanup: cutoff=${new Date(cutoffTimestamp).toLocaleString()}`)

	// Delete subscriptions where:
	// 1. Flight is LANDED or CANCELED, OR
	// 2. Flight ETA is more than 1 hour ago (regardless of status)
	// Uses JOIN for better performance and RETURNING to get count in single query
	const result = ctx.storage.sql.exec(`
		DELETE FROM subscriptions 
		WHERE rowid IN (
			SELECT s.rowid 
			FROM subscriptions s
			INNER JOIN flights f ON s.flight_id = f.id
			WHERE f.status IN ('LANDED', 'CANCELED')
			   OR f.eta < ?
		)
		RETURNING flight_id
	`, cutoffTimestamp)
	
	const count = result.toArray().length
	console.log(`Cleanup: deleted ${count} subscription(s)`)
	return count
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
	const timestamp = getCurrentIdtTime().toISOString()

	ctx.storage.sql.exec(
		"INSERT INTO status (key, value) VALUES ('update-counter', '1') ON CONFLICT(key) DO UPDATE SET value = CAST((CAST(value AS INTEGER) + 1) AS TEXT)"
	)

	ctx.storage.sql.exec(
		'INSERT INTO status (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = EXCLUDED.value',
		'lastUpdated',
		timestamp
	)

	if (flightCount !== undefined) {
		ctx.storage.sql.exec(
			'INSERT INTO status (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = EXCLUDED.value',
			'dataLength',
			flightCount
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
