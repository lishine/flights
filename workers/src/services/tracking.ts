import type { Env } from '../env'

export const addFlightTracking = (userId: number, flightId: string, env: Env, ctx: DurableObjectState) => {
	ctx.storage.sql.exec('INSERT OR IGNORE INTO subscriptions (telegram_id, flight_id) VALUES (?, ?)', userId, flightId)
}

export const removeFlightTracking = (userId: number, flightId: string, env: Env, ctx: DurableObjectState) => {
	ctx.storage.sql.exec('DELETE FROM subscriptions WHERE telegram_id = ? AND flight_id = ?', userId, flightId)
}

export const cleanupStaleTrackingData = (flightId: string, env: Env, ctx: DurableObjectState) => {
	ctx.storage.sql.exec(
		"UPDATE subscriptions SET auto_cleanup_at = DATETIME(CURRENT_TIMESTAMP, '+1 hours') WHERE flight_id = ? AND auto_cleanup_at IS NULL",
		flightId
	)
}

export const clearUserTracking = (userId: number, env: Env, ctx: DurableObjectState) => {
	const countResult = ctx.storage.sql.exec(
		'SELECT COUNT(*) as count FROM subscriptions WHERE telegram_id = ?',
		userId
	)
	const countRow = countResult.toArray()[0] as { count: number }

	ctx.storage.sql.exec('DELETE FROM subscriptions WHERE telegram_id = ?', userId)

	return countRow?.count || 0
}
