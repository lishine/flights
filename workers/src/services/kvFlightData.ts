import { getCurrentIdtTime } from '../utils/dateTime'
import { VERCEL_FLIGHTS_API_URL } from '../utils/constants'
import { ofetch } from 'ofetch'
import type { Env } from '../env'
import type { Flight, VercelApiResponse, VercelFlightResponse } from '../types'

// KV Keys for storing flight data
const KV_KEY_CURRENT_FLIGHTS = 'current_flights'
const KV_KEY_PREVIOUS_FLIGHTS = 'previous_flights'

/**
 * Get current flights from KV store
 */
export const getCurrentFlights = async (ctx: DurableObjectState): Promise<Flight[]> => {
	const flightsJson = await ctx.storage.get<string>(KV_KEY_CURRENT_FLIGHTS)
	if (!flightsJson) {
		console.error('No flight data available in KV store')
		throw new Error('Flight data unavailable')
	}
	
	const flights = JSON.parse(flightsJson) as Flight[]
	console.log(`Using KV store flight data: ${flights.length} flights`)
	return flights
}

/**
 * Get previous flights from KV store (for change detection)
 */
export const getPreviousFlights = async (ctx: DurableObjectState): Promise<Flight[]> => {
	const flightsJson = await ctx.storage.get<string>(KV_KEY_PREVIOUS_FLIGHTS)
	if (!flightsJson) {
		return []
	}
	return JSON.parse(flightsJson) as Flight[]
}

/**
 * Store current flights in KV and move current to previous
 */
export const storeFlights = async (flights: Flight[], ctx: DurableObjectState) => {
	// First, get current flights to save as previous
	const currentFlightsJson = await ctx.storage.get<string>(KV_KEY_CURRENT_FLIGHTS)
	
	// Store new flights as current
	await ctx.storage.put(KV_KEY_CURRENT_FLIGHTS, JSON.stringify(flights))
	
	// Store previous flights for change detection (if any existed)
	if (currentFlightsJson) {
		await ctx.storage.put(KV_KEY_PREVIOUS_FLIGHTS, currentFlightsJson)
	}
}

/**
 * Get subscribed flights by checking current flights against subscriptions
 */
export const getSubscribedFlights = async (ctx: DurableObjectState): Promise<Flight[]> => {
	const currentFlights = await getCurrentFlights(ctx)
	
	// Get all subscribed flight IDs from SQLite
	const result = ctx.storage.sql.exec('SELECT DISTINCT flight_id FROM subscriptions')
	const subscribedIds = result.toArray().map(row => (row as { flight_id: string }).flight_id)
	
	// Filter current flights to only subscribed ones
	const subscribedFlights = currentFlights.filter(flight => subscribedIds.includes(flight.id))
	console.log(`Found ${subscribedFlights.length} subscribed flights`)
	return subscribedFlights
}

/**
 * Get user's tracked flights
 */
export const getUserTrackedFlightsWithData = async (userId: number, env: Env, ctx: DurableObjectState): Promise<Flight[]> => {
	const currentFlights = await getCurrentFlights(ctx)
	
	// Get user's subscribed flight IDs
	const result = ctx.storage.sql.exec(
		'SELECT flight_id FROM subscriptions WHERE telegram_id = ?',
		userId
	)
	const subscribedIds = result.toArray().map(row => (row as { flight_id: string }).flight_id)
	
	// Filter and sort flights
	const userFlights = currentFlights
		.filter(flight => subscribedIds.includes(flight.id))
		.sort((a, b) => a.eta - b.eta)
	
	return userFlights
}

/**
 * Get current flight data by flight number
 */
export const getCurrentFlightData = async (flightNumber: string, ctx: DurableObjectState): Promise<Flight | undefined> => {
	const currentFlights = await getCurrentFlights(ctx)
	return currentFlights.find(flight => flight.flight_number === flightNumber)
}

/**
 * Get next future flight by flight number
 */
export const getNextFutureFlight = async (flightNumber: string, ctx: DurableObjectState): Promise<Flight | undefined> => {
	const nowIdt = getCurrentIdtTime()
	const currentFlights = await getCurrentFlights(ctx)
	
	const futureFlights = currentFlights
		.filter(flight => flight.flight_number === flightNumber && flight.eta > nowIdt.getTime())
		.sort((a, b) => a.eta - b.eta)
	
	return futureFlights[0]
}

/**
 * Get flight ID by flight number (prioritizing future flights)
 */
export const getFlightIdByNumber = async (flightNumber: string, ctx: DurableObjectState): Promise<string | undefined> => {
	const futureFlight = await getNextFutureFlight(flightNumber, ctx)
	if (futureFlight) {
		return futureFlight.id
	}
	
	const flight = await getCurrentFlightData(flightNumber, ctx)
	return flight?.id
}

/**
 * Get flights not tracked by user
 */
export const getNotTrackedFlights = async (chatId: number, ctx: DurableObjectState): Promise<Flight[]> => {
	const currentFlights = await getCurrentFlights(ctx)
	
	// Get user's subscribed flight IDs
	const result = ctx.storage.sql.exec(
		'SELECT flight_id FROM subscriptions WHERE telegram_id = ?',
		chatId
	)
	const subscribedIds = result.toArray().map(row => (row as { flight_id: string }).flight_id)
	
	// Filter out tracked flights and sort
	return currentFlights
		.filter(flight => !subscribedIds.includes(flight.id))
		.sort((a, b) => a.eta - b.eta)
}

/**
 * Clean up subscriptions for completed flights
 * Since we can't rely on flights table, we'll clean based on current KV data
 */
export const cleanupCompletedFlights = async (env: Env, ctx: DurableObjectState): Promise<number> => {
	const nowIdt = getCurrentIdtTime()
	const cutoffTimestamp = nowIdt.getTime() - 1 * 60 * 60 * 1000 // 1 hour ago
	
	console.log(`Cleanup: cutoff=${new Date(cutoffTimestamp).toLocaleString()}`)
	
	try {
		const currentFlights = await getCurrentFlights(ctx)
		
		// Get completed flight IDs (LANDED, CANCELED, or ETA passed by 1+ hours)
		const completedFlightIds = currentFlights
			.filter(flight => 
				flight.status === 'LANDED' || 
				flight.status === 'CANCELED' || 
				flight.eta < cutoffTimestamp
			)
			.map(flight => flight.id)
		
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
		
		console.log(`Cleanup: deleted ${totalDeleted} subscription(s) for ${completedFlightIds.length} completed flights`)
		return totalDeleted
		
	} catch (error) {
		console.error('Cleanup failed, no current flights available:', error)
		return 0
	}
}

/**
 * Detect changes between previous and current flights
 */
export const detectChanges = (prevFlight: Flight, currentFlight: Flight): string[] => {
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

/**
 * Fetch latest flights from API (same as before)
 */
export const fetchLatestFlights = async (env: Env, ctx: DurableObjectState): Promise<Flight[]> => {
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

/**
 * Generate fake flights (same as before)
 */
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

/**
 * Write status data to SQLite (same as before, no changes needed)
 */
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

/**
 * Write error status to SQLite (same as before, no changes needed)
 */
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