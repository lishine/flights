import type { Env } from '../index'

interface Subscription {
	telegram_id: string
	flight_number: string
	created_at: string
	auto_cleanup_at: string | null
}

export async function addFlightTracking(userId: number, flightCode: string, env: Env): Promise<void> {
	await env.DB.prepare('INSERT OR IGNORE INTO subscriptions (telegram_id, flight_number) VALUES (?, ?)')
		.bind(String(userId), flightCode)
		.run()
}

export async function getUserTrackedFlights(userId: number, env: Env): Promise<string[]> {
	const { results } = await env.DB.prepare(
		'SELECT flight_number FROM subscriptions WHERE telegram_id = ? AND auto_cleanup_at IS NULL'
	)
		.bind(String(userId))
		.all<Pick<Subscription, 'flight_number'>>()
	return results.map((row) => row.flight_number)
}

export async function removeFlightTracking(userId: number, flightCode: string, env: Env): Promise<void> {
	await env.DB.prepare('DELETE FROM subscriptions WHERE telegram_id = ? AND flight_number = ?')
		.bind(String(userId), flightCode)
		.run()
}

export async function cleanupStaleTrackingData(flightNumber: string, env: Env): Promise<void> {
 	// Schedule cleanup in D1
 	await env.DB.prepare(
 		"UPDATE subscriptions SET auto_cleanup_at = DATETIME(CURRENT_TIMESTAMP, '+1 hours') WHERE flight_number = ? AND auto_cleanup_at IS NULL"
 	)
 		.bind(flightNumber)
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
