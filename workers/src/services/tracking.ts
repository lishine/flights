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
 	await env.DB.prepare('DELETE FROM subscriptions WHERE telegram_id = ?')
 		.bind(String(userId))
 		.run()

 	return countResult?.count || 0
 }
