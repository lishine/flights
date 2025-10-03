export const initializeSchema = (ctx: DurableObjectState) => {
	// Only keep subscriptions and status tables, flights are now in KV
	ctx.storage.sql.exec(`
		CREATE TABLE IF NOT EXISTS subscriptions (
			telegram_id TEXT,
			flight_id TEXT,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			PRIMARY KEY (telegram_id, flight_id)
		)
	`)

	ctx.storage.sql.exec(`
		CREATE INDEX IF NOT EXISTS idx_user_subs ON subscriptions(telegram_id);
		CREATE INDEX IF NOT EXISTS idx_flight_subs ON subscriptions(flight_id);
	`)

	ctx.storage.sql.exec(`
		CREATE TABLE IF NOT EXISTS status (
			key TEXT PRIMARY KEY NOT NULL,
			value TEXT
		)
	`)
}

export const resetSchema = (ctx: DurableObjectState) => {
	ctx.storage.sql.exec(`DROP TABLE IF EXISTS subscriptions`)
	ctx.storage.sql.exec(`DROP TABLE IF EXISTS flights`)
	ctx.storage.sql.exec(`DROP TABLE IF EXISTS status`)

	// Then reinitialize with the new schema
	initializeSchema(ctx)
}
