import type { Env } from '../env'

interface Subscription {
	telegram_id: string
	flight_id: string
	created_at: string
	auto_cleanup_at: string | null
}

export async function addFlightTracking(
	userId: number,
	flightId: string,
	env: Env,
	ctx: DurableObjectState
): Promise<void> {
	ctx.storage.sql.exec(
		'INSERT OR IGNORE INTO subscriptions (telegram_id, flight_id) VALUES (?, ?)',
		String(userId),
		flightId
	)
}

export async function getUserTrackedFlights(userId: number, env: Env, ctx: DurableObjectState): Promise<string[]> {
	const result = ctx.storage.sql.exec(
		'SELECT flight_id FROM subscriptions WHERE telegram_id = ? AND auto_cleanup_at IS NULL',
		String(userId)
	)
	const results = result.toArray() as unknown as Pick<Subscription, 'flight_id'>[]
	return results.map((row) => row.flight_id)
}

// Optimized function to get tracked flights with full flight data in a single query
export async function getUserTrackedFlightsWithData(userId: number, env: Env, ctx: DurableObjectState): Promise<any[]> {
	const result = ctx.storage.sql.exec(
		`SELECT f.id, f.flight_number, f.status, f.scheduled_arrival_time, f.estimated_arrival_time, f.city, f.airline
  		 FROM flights f
  		 INNER JOIN subscriptions s ON f.id = s.flight_id
  		 WHERE s.telegram_id = ? AND s.auto_cleanup_at IS NULL
  		 ORDER BY f.estimated_arrival_time ASC`,
		String(userId)
	)
	return result.toArray() || []
}

export async function removeFlightTracking(
	userId: number,
	flightId: string,
	env: Env,
	ctx: DurableObjectState
): Promise<void> {
	ctx.storage.sql.exec('DELETE FROM subscriptions WHERE telegram_id = ? AND flight_id = ?', String(userId), flightId)
}

export async function cleanupStaleTrackingData(flightId: string, env: Env, ctx: DurableObjectState): Promise<void> {
	// Schedule cleanup in Durable Object SQLite
	ctx.storage.sql.exec(
		"UPDATE subscriptions SET auto_cleanup_at = DATETIME(CURRENT_TIMESTAMP, '+1 hours') WHERE flight_id = ? AND auto_cleanup_at IS NULL",
		flightId
	)
}

export async function clearUserTracking(userId: number, env: Env, ctx: DurableObjectState): Promise<number> {
	// First get count of subscriptions to be deleted
	const countResult = ctx.storage.sql.exec(
		'SELECT COUNT(*) as count FROM subscriptions WHERE telegram_id = ?',
		String(userId)
	)
	const countRow = countResult.toArray()[0] as { count: number }

	// Then delete them
	ctx.storage.sql.exec('DELETE FROM subscriptions WHERE telegram_id = ?', String(userId))

	return countRow?.count || 0
}
