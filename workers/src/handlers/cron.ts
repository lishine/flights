import {
	fetchLatestFlights,
	cleanupCompletedFlights,
	getCurrentFlights,
	getSubscribedFlights,
	detectChanges,
	filterAndTransformFlights,
	writeStatusData,
	writeErrorStatus,
	writeFlightsData,
} from '../services/flightData'
import { initializeSchema } from '../schema'
import type { VercelApiResponse } from '../types'
import { getCurrentIdtTime } from '../utils/dateTime'
import { sendFlightAlerts } from './alerts'
import type { Env } from '../env'
import type { Flight } from '../types'

export async function runScheduledJob(env: Env, ctx: DurableObjectState): Promise<Response> {
	try {
		// Initialize schema
		await initializeSchema(ctx)

		// Get update counter from status table using Durable Object SQLite
		const counterResult = ctx.storage.sql.exec('SELECT value FROM status WHERE key = ?', 'update-counter')
		const counterRow = counterResult.toArray()[0]
		const currentCount = Number(counterRow?.value || '0') + 1

		// Get subscribed flights with their data using reusable function
		const previousFlights = await getSubscribedFlights(ctx)
		const previousFlightsMap = Object.fromEntries(previousFlights.map((f) => [f.id, f])) as Record<string, Flight>

		// Filter and transform flights based on subscribed flights and time window
		const { flights: currentFlights, metadata } = await fetchLatestFlights(env, ctx)

		// Write status metadata and flights data using extracted functions (only called once from cron)
		const timestamp = getCurrentIdtTime().toISOString()
		await writeStatusData(ctx, {
			...metadata,
			'update-counter': currentCount.toString(),
			'last-write-timestamp': timestamp,
		})
		await writeFlightsData(currentFlights, ctx)

		// Read previous flights from SQLite flights table (current state before update) - only for subscribed flights

		// Create map of current flights for comparison
		const currentFlightsMap = Object.fromEntries(currentFlights.map((f) => [f.id, f])) as Record<string, Flight>

		// Detect changes and prepare alerts
		const changesByFlight: Record<string, { flight: Flight; changes: string[] }> = {}

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

		// // Check for new flights (not in previous but in current)
		// for (const flightId in currentFlightsMap) {
		// 	if (!previousFlightsMap[flightId]) {
		// 		// New flight - consider all fields as changes
		// 		const newFlight = currentFlightsMap[flightId]
		// 		const changes = [
		// 			`📍 Status: ${newFlight.status}`,
		// 			newFlight.eta
		// 				? `🕒 Arrival Time: ${new Date(newFlight.eta).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}`
		// 				: '🕒 Arrival Time: TBA',
		// 			`🏙️ City: ${newFlight.city || 'Unknown'}`,
		// 			`✈️ Airline: ${newFlight.airline || 'Unknown'}`,
		// 		]
		// 		changesByFlight[flightId] = { flight: newFlight, changes }
		// 	}
		// }

		// Send alerts for changes
		if (Object.keys(changesByFlight).length > 0) {
			await sendFlightAlerts(changesByFlight, env, ctx)
		}

		// Cleanup completed flights
		await cleanupCompletedFlights(currentFlights, env, ctx)

		return new Response('Cron job completed')
	} catch (error) {
		console.error('Cron job failed:', error)
		const errorTimestamp = getCurrentIdtTime().toISOString()

		// Store error using extracted function
		await writeErrorStatus(ctx, error instanceof Error ? error : 'Unknown error')

		return new Response('Cron job failed', { status: 500 })
	}
}
