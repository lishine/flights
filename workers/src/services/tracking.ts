import type { Env } from '../env'
import type { DOProps } from '../types'

export const addFlightTracking = (userId: number, flightId: string, env: Env, ctx: DurableObjectState<DOProps>) => {
	ctx.storage.sql.exec('INSERT OR IGNORE INTO subscriptions (telegram_id, flight_id) VALUES (?, ?)', userId, flightId)
}

export const removeFlightTracking = (userId: number, flightId: string, env: Env, ctx: DurableObjectState<DOProps>) => {
	ctx.storage.sql.exec('DELETE FROM subscriptions WHERE telegram_id = ? AND flight_id = ?', userId, flightId)
}

export const untrackFlight = (userId: number, flightId: string, env: Env, ctx: DurableObjectState<DOProps>) => {
	ctx.storage.sql.exec('DELETE FROM subscriptions WHERE telegram_id = ? AND flight_id = ?', userId, flightId)
}

export const cleanupFlightSubscriptions = (flightId: string, env: Env, ctx: DurableObjectState<DOProps>) => {
	ctx.storage.sql.exec('DELETE FROM subscriptions WHERE flight_id = ?', flightId)
}

export const clearUserTracking = (userId: number, env: Env, ctx: DurableObjectState<DOProps>) => {
	const countResult = ctx.storage.sql.exec(
		'SELECT COUNT(*) as count FROM subscriptions WHERE telegram_id = ?',
		userId
	)
	const countRow = countResult.toArray()[0] as { count: number }

	ctx.storage.sql.exec('DELETE FROM subscriptions WHERE telegram_id = ?', userId)

	return countRow?.count || 0
}
