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
			PRIMARY KEY (telegram_id, flight_id),
			FOREIGN KEY (flight_id) REFERENCES flights(id)
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
