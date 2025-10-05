import { getCurrentIdtTime } from '../utils/dateTime'
import { VERCEL_FLIGHTS_API_URL } from '../utils/constants'
import { ofetch } from 'ofetch'
import type { Flight, VercelApiResponse, VercelFlightResponse, DOProps } from '../types'
import { sendTelegramMessage, sendAdmin } from '../services/telegram'
import { formatTimeFromTimestamp } from '../utils/formatting'
export const cleanupCompletedFlights = (env: Env, ctx: DurableObjectState<DOProps>): number => {
	const nowIdt = getCurrentIdtTime(ctx)
	const cutoffTimestamp = nowIdt.getTime() - 1 * 60 * 60 * 1000 // 1 hour ago

	console.log(`Cleanup: cutoff=${new Date(cutoffTimestamp).toLocaleString()}`)

	try {
		const currentFlights = getCurrentFlights(ctx)

		const completedFlightIds = currentFlights
			.filter(
				(flight) => (flight.status === 'LANDED' && flight.eta < cutoffTimestamp) || flight.status === 'CANCELED'
			)
			.map((flight) => flight.id)

		if (completedFlightIds.length === 0) {
			console.log('Cleanup: no completed flights found')
			return 0
		}

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

export const detectChanges = (
	prevFlight: Flight,
	currentFlight: Flight,
	env: Env,
	ctx: DurableObjectState<DOProps>
) => {
	const changes: string[] = []

	if (prevFlight.status !== currentFlight.status) {
		changes.push(`📍 Status: ${currentFlight.status}`)
	}
	if (prevFlight.eta !== currentFlight.eta) {
		const prevDt = formatTimeFromTimestamp(prevFlight.eta)
		const currentDt = formatTimeFromTimestamp(currentFlight.eta)
		const prevTime = prevDt ?? 'TBA'
		const currentTime = currentDt ?? 'TBA'
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

export const fetchLatestFlights = async (env: Env, ctx: DurableObjectState<DOProps>) => {
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

	ctx.storage.sql.exec(
		'INSERT INTO status (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = EXCLUDED.value',
		'lastUpdated',
		timestamp
	)

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

export const getCurrentFlights = (ctx: DurableObjectState<DOProps>): Flight[] => {
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

export const storeFlights = (flights: Flight[], ctx: DurableObjectState<DOProps>): void => {
	ctx.storage.sql.exec(
		'INSERT OR REPLACE INTO status (key, value) VALUES (?, ?)',
		'flights_data',
		JSON.stringify(flights)
	)
	console.log(`Stored ${flights.length} flights as JSON in status table`)
}

export const getUserTrackedFlights = (userId: number, ctx: DurableObjectState<DOProps>): Flight[] => {
	const allFlights = getCurrentFlights(ctx)

	const result = ctx.storage.sql.exec('SELECT flight_id FROM subscriptions WHERE telegram_id = ?', userId)
	const subscribedIds = result.toArray().map((row) => (row as { flight_id: string }).flight_id)

	return allFlights.filter((flight) => subscribedIds.includes(flight.id)).sort((a, b) => a.eta - b.eta)
}

export const getFlightById = (flightId: string, ctx: DurableObjectState<DOProps>): Flight | undefined => {
	const allFlights = getCurrentFlights(ctx)
	return allFlights.find((flight) => flight.id === flightId)
}

export const getFlightByNumber = (flightNumber: string, ctx: DurableObjectState<DOProps>): Flight | undefined => {
	const allFlights = getCurrentFlights(ctx)
	return allFlights.find((flight) => flight.flight_number === flightNumber)
}

export const getNotTrackedFlights = (chatId: number, ctx: DurableObjectState<DOProps>): Flight[] => {
	const allFlights = getCurrentFlights(ctx)

	const result = ctx.storage.sql.exec('SELECT flight_id FROM subscriptions WHERE telegram_id = ?', chatId)
	const subscribedIds = result.toArray().map((row) => (row as { flight_id: string }).flight_id)

	return allFlights
		.filter((flight) => !subscribedIds.includes(flight.id))
		.sort((a, b) => a.eta - b.eta)
		.filter((flight) => flight.status !== 'LANDED' && flight.status !== 'CANCELED')
}

export const getFlightIdByNumber = (flightNumber: string, ctx: DurableObjectState<DOProps>): string | undefined => {
	const nowIdt = getCurrentIdtTime(ctx)
	const allFlights = getCurrentFlights(ctx)

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
