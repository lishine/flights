import {
	fetchLatestFlights,
	cleanupCompletedFlights,
	getSubscribedFlights,
	detectChanges,
	writeStatusData,
	writeErrorStatus,
	writeFlightsData,
} from '../services/flightData'
import { initializeSchema } from '../schema'
import { sendFlightAlerts } from './alerts'
import type { Env } from '../env'
import type { Flight } from '../types'

export const runScheduledJob = async (env: Env, ctx: DurableObjectState) => {
	try {
		initializeSchema(ctx)

		const previousFlights = getSubscribedFlights(ctx)
		const previousFlightsMap = Object.fromEntries(previousFlights.map((f) => [f.id, f])) as Record<string, Flight>

		const currentFlights = await fetchLatestFlights(env, ctx)

		writeStatusData(ctx, currentFlights.length)
		writeFlightsData(currentFlights, ctx)

		const currentFlightsMap = Object.fromEntries(currentFlights.map((f) => [f.id, f])) as Record<string, Flight>

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
		await writeErrorStatus(ctx, error instanceof Error ? error : 'Unknown error')
		return new Response('Cron job failed', { status: 500 })
	}
}
