import type { Env } from '../index'

interface Subscription {
	telegram_id: string
	flight_id: string
	created_at: string
	auto_cleanup_at: string | null
}

export async function addFlightTracking(userId: number, flightId: string, env: Env): Promise<void> {
	await env.DB.prepare('INSERT OR IGNORE INTO subscriptions (telegram_id, flight_id) VALUES (?, ?)')
		.bind(String(userId), flightId)
		.run()
}

export async function getUserTrackedFlights(userId: number, env: Env): Promise<string[]> {
	const { results } = await env.DB.prepare(
		'SELECT flight_id FROM subscriptions WHERE telegram_id = ? AND auto_cleanup_at IS NULL'
	)
		.bind(String(userId))
		.all<Pick<Subscription, 'flight_id'>>()
	return results.map((row) => row.flight_id)
}

// Optimized function to get tracked flights with full flight data in a single query
export async function getUserTrackedFlightsWithData(userId: number, env: Env): Promise<any[]> {
	const { results } = await env.DB.prepare(
		`SELECT f.id, f.flight_number, f.status, f.scheduled_arrival_time, f.estimated_arrival_time, f.city, f.airline
 		 FROM flights f
 		 INNER JOIN subscriptions s ON f.id = s.flight_id
 		 WHERE s.telegram_id = ? AND s.auto_cleanup_at IS NULL
 		 ORDER BY f.estimated_arrival_time ASC`
	)
		.bind(String(userId))
		.all()
	return results || []
}

export async function removeFlightTracking(userId: number, flightId: string, env: Env): Promise<void> {
	await env.DB.prepare('DELETE FROM subscriptions WHERE telegram_id = ? AND flight_id = ?')
		.bind(String(userId), flightId)
		.run()
}

export async function cleanupStaleTrackingData(flightId: string, env: Env): Promise<void> {
	// Schedule cleanup in D1
	await env.DB.prepare(
		"UPDATE subscriptions SET auto_cleanup_at = DATETIME(CURRENT_TIMESTAMP, '+1 hours') WHERE flight_id = ? AND auto_cleanup_at IS NULL"
	)
		.bind(flightId)
		.run()
}

export async function clearUserTracking(userId: number, env: Env): Promise<number> {
	// First get count of subscriptions to be deleted
	const countResult = await env.DB.prepare('SELECT COUNT(*) as count FROM subscriptions WHERE telegram_id = ?')
		.bind(String(userId))
		.first<{ count: number }>()

	// Then delete them
	await env.DB.prepare('DELETE FROM subscriptions WHERE telegram_id = ?').bind(String(userId)).run()

	return countResult?.count || 0
}
