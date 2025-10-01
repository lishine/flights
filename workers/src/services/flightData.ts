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
	const futureFlight = getNextFutureFlight(flightNumber, ctx)
	if (futureFlight) {
		return futureFlight.id
	}

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
		const arrivalIdt = new Date(flight.eta)
		if (flight.status === 'LANDED' && arrivalIdt < cutoffIdt) {
			console.log(`Cleaning up landed flight: ${flight.flight_number}, arrived at ${arrivalIdt.toLocaleString()}`)
			ctx.storage.sql.exec('DELETE FROM flights WHERE id = ?', flight.id)
			ctx.storage.sql.exec(
				"UPDATE subscriptions SET auto_cleanup_at = DATETIME(CURRENT_TIMESTAMP, '+2 hours') WHERE flight_id = ? AND auto_cleanup_at IS NULL",
				flight.id
			)
		}
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

