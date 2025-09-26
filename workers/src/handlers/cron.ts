import { fetchLatestFlights, cleanupCompletedFlights } from '../services/flightData'
import { sendFlightAlerts } from './alerts'
import type { Env } from '../index'

export async function runScheduledJob(env: Env, ctx: ExecutionContext): Promise<Response> {
	try {
		const currentFlights = await fetchLatestFlights(env)
		const currentCount = Number((await env.FLIGHT_DATA.get('update-counter')) || '0') + 1
		const dataWithMeta = {
			data: currentFlights,
			updateCount: currentCount,
			timestamp: Date.now(),
			lastUpdated: new Date().toISOString(),
			source: 'vercel-api',
		}

		// Store current flights as latest-arrivals (24h TTL)
		await env.FLIGHT_DATA.put('latest-arrivals', JSON.stringify(dataWithMeta), { expirationTtl: 86400 })
		await env.FLIGHT_DATA.put('update-counter', currentCount.toString())

		// Send alerts by comparing with prev-arrivals
		await sendFlightAlerts(currentFlights, env)

		// Cleanup completed flights
		await cleanupCompletedFlights(currentFlights, env)

		return new Response('Cron job completed')
	} catch (error) {
		console.error('Cron job failed:', error)
		await env.FLIGHT_DATA.put(
			'last-error',
			JSON.stringify({
				error: error instanceof Error ? error.message : 'Unknown error',
				timestamp: new Date().toISOString(),
			})
		)
		return new Response('Cron job failed', { status: 500 })
	}
}
