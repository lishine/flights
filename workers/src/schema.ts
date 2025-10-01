export const initializeSchema = (ctx: DurableObjectState) => {
	ctx.storage.sql.exec(`
		CREATE TABLE IF NOT EXISTS flights (
			id TEXT PRIMARY KEY NOT NULL,
			flight_number TEXT NOT NULL,
			status TEXT NOT NULL,
			sta INTEGER,
			eta INTEGER,
			city TEXT,
			airline TEXT,
			created_at INTEGER DEFAULT (strftime('%s', 'now')),
			updated_at INTEGER DEFAULT (strftime('%s', 'now')),
			UNIQUE(flight_number, sta)
		)
	`)

	ctx.storage.sql.exec(`
		CREATE INDEX IF NOT EXISTS idx_flight_number ON flights (flight_number);
		CREATE INDEX IF NOT EXISTS idx_status ON flights (status);
		CREATE INDEX IF NOT EXISTS idx_scheduled_arrival ON flights (sta);
	`)

	ctx.storage.sql.exec(`
		CREATE TABLE IF NOT EXISTS subscriptions (
			telegram_id TEXT,
			flight_id TEXT,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			auto_cleanup_at DATETIME NULL,
			PRIMARY KEY (telegram_id, flight_id),
			FOREIGN KEY (flight_id) REFERENCES flights(id)
		)
	`)

	ctx.storage.sql.exec(`
		CREATE INDEX IF NOT EXISTS idx_active_subs ON subscriptions(auto_cleanup_at) WHERE auto_cleanup_at IS NULL;
		CREATE INDEX IF NOT EXISTS idx_cleanup_ready ON subscriptions(auto_cleanup_at) WHERE auto_cleanup_at IS NOT NULL;
		CREATE INDEX IF NOT EXISTS idx_user_subs ON subscriptions(telegram_id);
		CREATE INDEX IF NOT EXISTS idx_flight_subs ON subscriptions(flight_id);
		CREATE INDEX IF NOT EXISTS idx_tracked_flights ON subscriptions(telegram_id, auto_cleanup_at) WHERE auto_cleanup_at IS NULL;
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
