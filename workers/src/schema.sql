CREATE TABLE IF NOT EXISTS subscriptions (
  telegram_id TEXT,
  flight_number TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  auto_cleanup_at DATETIME NULL,
  PRIMARY KEY (telegram_id, flight_number)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_active_subs ON subscriptions(auto_cleanup_at) WHERE auto_cleanup_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_cleanup_ready ON subscriptions(auto_cleanup_at) WHERE auto_cleanup_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_user_subs ON subscriptions(telegram_id);

-- Create the 'flights' table to store flight data
CREATE TABLE IF NOT EXISTS flights (
    id TEXT PRIMARY KEY NOT NULL,
    flight_number TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL,
    scheduled_departure_time INTEGER,
    actual_departure_time INTEGER,
    scheduled_arrival_time INTEGER,
    actual_arrival_time INTEGER,
    city TEXT,
    airline TEXT,
    created_at INTEGER DEFAULT (strftime('%s', 'now')),
    updated_at INTEGER DEFAULT (strftime('%s', 'now'))
);

-- Create indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_flight_number ON flights (flight_number);
CREATE INDEX IF NOT EXISTS idx_status ON flights (status);

-- Create the 'status' table for system-wide metadata
CREATE TABLE IF NOT EXISTS status (
    key TEXT PRIMARY KEY NOT NULL,
    value TEXT
);