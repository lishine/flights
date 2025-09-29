import { fetchLatestFlights, cleanupCompletedFlights, getCurrentFlights, detectChanges } from '../services/flightData'
import { getCurrentIdtTime } from '../utils/dateTime'
import { sendFlightAlerts } from './alerts'
import type { Env } from '../index'
import type { D1Flight } from '../types'

export async function runScheduledJob(env: Env, ctx: ExecutionContext): Promise<Response> {
	try {
		
		// Get update counter from status table
		// const counterResult = await env.DB.prepare('SELECT value FROM status WHERE key = ?')
		// 	.bind('update-counter')
		// 	.first<{ value: string }>()
		// const currentCount = Number(counterResult?.value || '0') + 1
		// Read previous flights from D1 flights table (current state before update)
		const { results: previousFlights } = await env.DB.prepare(
			'SELECT * FROM flights ORDER BY updated_at DESC'
		).all<D1Flight>()
		const previousFlightsMap = previousFlights.reduce(
			(acc, f) => ({ ...acc, [f.id]: f }),
			{} as Record<string, D1Flight>
		)
		return new Response('Cron job completed')

		// Fetch new flights from API and update D1 flights table
		const currentFlights = await fetchLatestFlights(env)
		const currentFlightsMap = currentFlights.reduce(
			(acc, f) => ({ ...acc, [f.id]: f }),
			{} as Record<string, D1Flight>
		)


		// Detect changes and prepare alerts
		const changesByFlight: Record<string, { flight: D1Flight; changes: string[] }> = {}

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

		// Check for new flights (not in previous but in current)
		for (const flightId in currentFlightsMap) {
			if (!previousFlightsMap[flightId]) {
				// New flight - consider all fields as changes
				const newFlight = currentFlightsMap[flightId]
				const changes = [
					`📍 Status: ${newFlight.status}`,
					newFlight.estimated_arrival_time
						? `🕒 Arrival Time: ${new Date(newFlight.estimated_arrival_time).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}`
						: '🕒 Arrival Time: TBA',
					`🏙️ City: ${newFlight.city || 'Unknown'}`,
					`✈️ Airline: ${newFlight.airline || 'Unknown'}`,
				]
				changesByFlight[flightId] = { flight: newFlight, changes }
			}
		}

		// Send alerts for changes
		if (Object.keys(changesByFlight).length > 0) {
			await sendFlightAlerts(changesByFlight, env)
		}

		// Update status table with counters/timestamps
		const timestamp = getCurrentIdtTime().toISOString()
		await env.DB.prepare('INSERT OR REPLACE INTO status (key, value) VALUES (?, ?)')
			.bind('update-counter', currentCount.toString())
			.run()
		await env.DB.prepare('INSERT OR REPLACE INTO status (key, value) VALUES (?, ?)')
			.bind('last-write-timestamp', timestamp)
			.run()

		// Cleanup completed flights
		await cleanupCompletedFlights(currentFlights, env)

		return new Response('Cron job completed')
	} catch (error) {
		console.error('Cron job failed:', error)
		const errorTimestamp = getCurrentIdtTime().toISOString()
		await env.DB.prepare('INSERT OR REPLACE INTO status (key, value) VALUES (?, ?)')
			.bind(
				'last-error',
				JSON.stringify({
					error: error instanceof Error ? error.message : 'Unknown error',
					timestamp: errorTimestamp,
				})
			)
			.run()
		return new Response('Cron job failed', { status: 500 })
	}
}
