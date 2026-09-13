CREATE TABLE IF NOT EXISTS active_wall (
    id TEXT PRIMARY KEY CHECK (id = 'active'),
    width REAL NOT NULL CHECK (width >= 0),
    height REAL NOT NULL CHECK (height >= 0),
    scene_json TEXT NOT NULL,
    revision INTEGER NOT NULL CHECK (revision >= 0),
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS notes (
    id TEXT PRIMARY KEY,
    size TEXT NOT NULL CHECK (size IN ('S', 'M', 'L')),
    x REAL NOT NULL,
    y REAL NOT NULL,
    z INTEGER NOT NULL,
    scene_json TEXT NOT NULL,
    passive_date TEXT,
    revision INTEGER NOT NULL CHECK (revision >= 1),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS notes_wall_order ON notes (z, created_at, id);

CREATE TABLE IF NOT EXISTS completed_notes (
    id TEXT PRIMARY KEY,
    size TEXT NOT NULL CHECK (size IN ('S', 'M', 'L')),
    scene_json TEXT NOT NULL,
    completed_on TEXT NOT NULL,
    completed_order INTEGER NOT NULL UNIQUE CHECK (completed_order >= 1)
);

CREATE TABLE IF NOT EXISTS recovery_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_type TEXT NOT NULL CHECK (event_type IN ('note_created', 'note_deleted')),
    entity_id TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    occurred_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS recovery_log_entity ON recovery_log (entity_id, id);

CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value_json TEXT NOT NULL
);
