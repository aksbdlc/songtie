use std::{
    fs,
    path::Path,
    sync::{Mutex, MutexGuard},
    time::Duration,
};

use crate::models::{
    AppStatePayload, CompleteNoteInput, CompletedNote, CreateNoteInput, DrawingScene,
    InitializeWallInput, Note, NoteSize, Position, QuickNotePlacement, QuickStatePayload,
    SaveNoteInput, SaveWallInput, Wall, WallBounds,
};
use chrono::{DateTime, NaiveDate, SecondsFormat, Utc};
use rusqlite::{params, Connection, OptionalExtension, Row, TransactionBehavior};
use thiserror::Error;

const DATABASE_VERSION: i64 = 1;
const INITIAL_MIGRATION: &str = include_str!("../migrations/0001_initial.sql");

#[derive(Debug, Error)]
pub enum StorageError {
    #[error("database error: {0}")]
    Sql(#[from] rusqlite::Error),
    #[error("data serialization error: {0}")]
    Json(#[from] serde_json::Error),
    #[error("invalid data: {0}")]
    Validation(String),
    #[error("{0} was not found")]
    NotFound(String),
    #[error("stale revision for {entity}: expected {expected}, current {current}")]
    Conflict {
        entity: String,
        expected: i64,
        current: i64,
    },
    #[error("database lock was poisoned")]
    LockPoisoned,
    #[error("unsupported database version {found}; this build supports up to {supported}")]
    UnsupportedVersion { found: i64, supported: i64 },
    #[error("could not prepare local data directory: {0}")]
    DataDirectory(String),
}

impl StorageError {
    pub fn code(&self) -> &'static str {
        match self {
            Self::Validation(_) => "VALIDATION",
            Self::NotFound(_) => "NOT_FOUND",
            Self::Conflict { .. } => "REVISION_CONFLICT",
            Self::UnsupportedVersion { .. } => "UNSUPPORTED_DATABASE",
            Self::Sql(_) | Self::Json(_) | Self::LockPoisoned | Self::DataDirectory(_) => "STORAGE",
        }
    }
}

pub struct Database {
    connection: Mutex<Connection>,
}

impl Database {
    pub fn open(path: &Path) -> Result<Self, StorageError> {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)
                .map_err(|error| StorageError::DataDirectory(error.to_string()))?;
        }

        let connection = Connection::open(path)?;
        Self::from_connection(connection)
    }

    #[cfg(test)]
    fn in_memory() -> Result<Self, StorageError> {
        Self::from_connection(Connection::open_in_memory()?)
    }

    fn from_connection(mut connection: Connection) -> Result<Self, StorageError> {
        connection.busy_timeout(Duration::from_secs(5))?;
        connection.pragma_update(None, "foreign_keys", "ON")?;
        connection.pragma_update(None, "journal_mode", "WAL")?;
        connection.pragma_update(None, "synchronous", "FULL")?;
        if !connection.is_autocommit() {
            return Err(StorageError::Validation(
                "database opened inside an unexpected transaction".to_owned(),
            ));
        }
        run_migrations(&mut connection)?;

        Ok(Self {
            connection: Mutex::new(connection),
        })
    }

    fn lock(&self) -> Result<MutexGuard<'_, Connection>, StorageError> {
        self.connection
            .lock()
            .map_err(|_| StorageError::LockPoisoned)
    }

    pub fn load_state(&self) -> Result<AppStatePayload, StorageError> {
        let connection = self.lock()?;
        load_state_from_connection(&connection)
    }

    pub fn load_quick_state(&self) -> Result<QuickStatePayload, StorageError> {
        let connection = self.lock()?;
        load_quick_state_from_connection(&connection)
    }

    pub fn create_note(&self, input: CreateNoteInput) -> Result<AppStatePayload, StorageError> {
        self.persist_new_note_then(input.note, load_state_from_connection)
    }

    pub fn create_quick_note(&self, input: CreateNoteInput) -> Result<(), StorageError> {
        self.persist_new_note_then(input.note, |_| Ok(()))
    }

    fn persist_new_note_then<T>(
        &self,
        note: Note,
        after_commit: impl FnOnce(&Connection) -> Result<T, StorageError>,
    ) -> Result<T, StorageError> {
        validate_scene(&note.scene)?;
        validate_position(note.position)?;
        validate_id(&note.id)?;
        if note.revision != 1 {
            return Err(StorageError::Validation(
                "a new note must start at revision 1".to_owned(),
            ));
        }
        validate_timestamp(&note.created_at, "createdAt")?;
        validate_timestamp(&note.updated_at, "updatedAt")?;
        let scene_json = serde_json::to_string(&note.scene)?;
        let snapshot = serde_json::to_string(&note)?;
        let occurred_at = now_utc();

        let mut connection = self.lock()?;
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        transaction.execute(
            "INSERT INTO notes
             (id, size, x, y, z, scene_json, passive_date, revision, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![
                note.id,
                note.size.as_str(),
                note.position.x,
                note.position.y,
                note.position.z,
                scene_json,
                note.passive_date,
                note.revision,
                note.created_at,
                note.updated_at,
            ],
        )?;
        transaction.execute(
            "INSERT INTO recovery_log
             (event_type, entity_id, payload_json, occurred_at)
             VALUES ('note_created', ?1, ?2, ?3)",
            params![note.id, snapshot, occurred_at],
        )?;
        transaction.commit()?;

        after_commit(&connection)
    }

    pub fn save_note(&self, input: SaveNoteInput) -> Result<AppStatePayload, StorageError> {
        validate_id(&input.note.id)?;
        validate_scene(&input.note.scene)?;
        validate_position(input.note.position)?;
        validate_timestamp(&input.note.created_at, "createdAt")?;
        validate_timestamp(&input.note.updated_at, "updatedAt")?;
        if input.expected_revision < 1 {
            return Err(StorageError::Validation(
                "expectedRevision must be at least 1".to_owned(),
            ));
        }

        if input.note.revision != input.expected_revision + 1 {
            return Err(StorageError::Validation(
                "note revision must equal expectedRevision + 1".to_owned(),
            ));
        }

        let scene_json = serde_json::to_string(&input.note.scene)?;
        let mut connection = self.lock()?;
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let changed = transaction.execute(
            "UPDATE notes
             SET size = ?1, x = ?2, y = ?3, z = ?4, scene_json = ?5,
                 passive_date = ?6, revision = ?7, updated_at = ?8
             WHERE id = ?9 AND revision = ?10 AND created_at = ?11",
            params![
                input.note.size.as_str(),
                input.note.position.x,
                input.note.position.y,
                input.note.position.z,
                scene_json,
                input.note.passive_date,
                input.note.revision,
                input.note.updated_at,
                input.note.id,
                input.expected_revision,
                input.note.created_at,
            ],
        )?;

        if changed == 0 {
            let current = transaction
                .query_row(
                    "SELECT revision FROM notes WHERE id = ?1",
                    [&input.note.id],
                    |row| row.get::<_, i64>(0),
                )
                .optional()?;
            return match current {
                Some(current) => Err(StorageError::Conflict {
                    entity: input.note.id,
                    expected: input.expected_revision,
                    current,
                }),
                None => Err(StorageError::NotFound(input.note.id)),
            };
        }

        transaction.commit()?;
        load_state_from_connection(&connection)
    }

    pub fn initialize_wall(
        &self,
        input: InitializeWallInput,
    ) -> Result<AppStatePayload, StorageError> {
        validate_wall(&input.wall)?;
        if input.wall.revision != 1 {
            return Err(StorageError::Validation(
                "a new wall must start at revision 1".to_owned(),
            ));
        }

        let scene_json = serde_json::to_string(&input.wall.scene)?;
        let mut connection = self.lock()?;
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        transaction.execute(
            "INSERT INTO active_wall
             (id, width, height, scene_json, revision, updated_at)
             VALUES ('active', ?1, ?2, ?3, ?4, ?5)",
            params![
                input.wall.bounds.width,
                input.wall.bounds.height,
                scene_json,
                input.wall.revision,
                input.wall.updated_at,
            ],
        )?;
        transaction.commit()?;
        load_state_from_connection(&connection)
    }

    pub fn save_wall(&self, input: SaveWallInput) -> Result<AppStatePayload, StorageError> {
        validate_wall(&input.wall)?;
        if input.expected_revision < 1 {
            return Err(StorageError::Validation(
                "expectedRevision must be at least 1".to_owned(),
            ));
        }
        if input.wall.revision != input.expected_revision + 1 {
            return Err(StorageError::Validation(
                "wall revision must equal expectedRevision + 1".to_owned(),
            ));
        }

        let scene_json = serde_json::to_string(&input.wall.scene)?;
        let mut connection = self.lock()?;
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let changed = transaction.execute(
            "UPDATE active_wall
             SET width = ?1, height = ?2, scene_json = ?3,
                 revision = revision + 1, updated_at = ?4
             WHERE id = 'active' AND revision = ?5",
            params![
                input.wall.bounds.width,
                input.wall.bounds.height,
                scene_json,
                input.wall.updated_at,
                input.expected_revision,
            ],
        )?;

        if changed == 0 {
            let current = transaction.query_row(
                "SELECT revision FROM active_wall WHERE id = 'active'",
                [],
                |row| row.get::<_, i64>(0),
            )?;
            return Err(StorageError::Conflict {
                entity: "active wall".to_owned(),
                expected: input.expected_revision,
                current,
            });
        }

        transaction.commit()?;
        load_state_from_connection(&connection)
    }

    pub fn complete_note(&self, input: CompleteNoteInput) -> Result<AppStatePayload, StorageError> {
        validate_id(&input.id)?;
        if input.completed.id != input.id {
            return Err(StorageError::Validation(
                "completed note id must match the active note id".to_owned(),
            ));
        }
        if input.expected_revision < 1 || input.completed.completed_order < 1 {
            return Err(StorageError::Validation(
                "completion revisions and order must be positive".to_owned(),
            ));
        }
        validate_scene(&input.completed.scene)?;
        NaiveDate::parse_from_str(&input.completed.completed_on, "%Y-%m-%d")
            .map_err(|_| StorageError::Validation("completedOn must use YYYY-MM-DD".to_owned()))?;

        let mut connection = self.lock()?;
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let note = select_note(&transaction, &input.id)?
            .ok_or_else(|| StorageError::NotFound(input.id.clone()))?;
        if note.revision != input.expected_revision {
            return Err(StorageError::Conflict {
                entity: input.id,
                expected: input.expected_revision,
                current: note.revision,
            });
        }
        if note.size != input.completed.size || note.scene != input.completed.scene {
            return Err(StorageError::Validation(
                "completed note must preserve the active note appearance".to_owned(),
            ));
        }
        transaction.execute(
            "INSERT INTO completed_notes
             (id, size, scene_json, completed_on, completed_order)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![
                input.completed.id,
                input.completed.size.as_str(),
                serde_json::to_string(&input.completed.scene)?,
                input.completed.completed_on,
                input.completed.completed_order,
            ],
        )?;
        let removed = transaction.execute("DELETE FROM notes WHERE id = ?1", [&input.id])?;
        if removed != 1 {
            return Err(StorageError::NotFound(input.id));
        }
        transaction.commit()?;

        load_state_from_connection(&connection)
    }

    pub fn delete_note(
        &self,
        id: &str,
        expected_revision: i64,
    ) -> Result<AppStatePayload, StorageError> {
        validate_id(id)?;
        if expected_revision < 1 {
            return Err(StorageError::Validation(
                "expectedRevision must be at least 1".to_owned(),
            ));
        }
        let timestamp = now_utc();
        let mut connection = self.lock()?;
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let note =
            select_note(&transaction, id)?.ok_or_else(|| StorageError::NotFound(id.to_owned()))?;
        if note.revision != expected_revision {
            return Err(StorageError::Conflict {
                entity: id.to_owned(),
                expected: expected_revision,
                current: note.revision,
            });
        }
        let snapshot = serde_json::to_string(&note)?;
        transaction.execute(
            "INSERT INTO recovery_log
             (event_type, entity_id, payload_json, occurred_at)
             VALUES ('note_deleted', ?1, ?2, ?3)",
            params![id, snapshot, timestamp],
        )?;
        let removed = transaction.execute("DELETE FROM notes WHERE id = ?1", [id])?;
        if removed != 1 {
            return Err(StorageError::NotFound(id.to_owned()));
        }
        transaction.commit()?;

        load_state_from_connection(&connection)
    }

    #[cfg(test)]
    fn with_connection<T>(&self, operation: impl FnOnce(&Connection) -> T) -> T {
        let connection = self.connection.lock().expect("test database lock");
        operation(&connection)
    }
}

fn run_migrations(connection: &mut Connection) -> Result<(), StorageError> {
    let current = connection.query_row("PRAGMA user_version", [], |row| row.get::<_, i64>(0))?;
    if current > DATABASE_VERSION {
        return Err(StorageError::UnsupportedVersion {
            found: current,
            supported: DATABASE_VERSION,
        });
    }

    if current < 1 {
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        transaction.execute_batch(INITIAL_MIGRATION)?;
        transaction.pragma_update(None, "user_version", 1)?;
        transaction.commit()?;
    }

    Ok(())
}

fn load_state_from_connection(connection: &Connection) -> Result<AppStatePayload, StorageError> {
    let wall = load_wall(connection)?;
    let notes = load_notes(connection)?;
    let completed_notes = load_completed_notes(connection)?;
    Ok(AppStatePayload {
        wall,
        notes,
        completed_notes,
    })
}

fn load_quick_state_from_connection(
    connection: &Connection,
) -> Result<QuickStatePayload, StorageError> {
    let wall_bounds = connection
        .query_row(
            "SELECT width, height FROM active_wall WHERE id = 'active'",
            [],
            |row| {
                Ok(WallBounds {
                    width: row.get(0)?,
                    height: row.get(1)?,
                })
            },
        )
        .optional()?;

    let mut statement = connection.prepare(
        "SELECT id, size, x, y, z
         FROM notes ORDER BY z ASC, created_at ASC, id ASC",
    )?;
    let rows = statement.query_map([], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            Position {
                x: row.get(2)?,
                y: row.get(3)?,
                z: row.get(4)?,
            },
        ))
    })?;
    let mut notes = Vec::new();
    for row in rows {
        let (id, size, position) = row?;
        let Some(size) = NoteSize::from_database(&size) else {
            eprintln!("isolating unreadable note {id}: invalid size");
            continue;
        };
        if validate_position(position).is_err() {
            eprintln!("isolating unreadable note {id}: invalid position");
            continue;
        }
        notes.push(QuickNotePlacement { id, size, position });
    }

    Ok(QuickStatePayload { wall_bounds, notes })
}

fn load_wall(connection: &Connection) -> Result<Option<Wall>, StorageError> {
    let stored = connection
        .query_row(
            "SELECT id, width, height, scene_json, revision, updated_at
         FROM active_wall WHERE id = 'active'",
            [],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, f64>(1)?,
                    row.get::<_, f64>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, i64>(4)?,
                    row.get::<_, String>(5)?,
                ))
            },
        )
        .optional()?;

    let Some(stored) = stored else {
        return Ok(None);
    };

    let scene = parse_scene_or_empty(&stored.3, "active wall");
    Ok(Some(Wall {
        id: stored.0,
        bounds: WallBounds {
            width: stored.1,
            height: stored.2,
        },
        scene,
        revision: stored.4,
        updated_at: stored.5,
    }))
}

fn load_notes(connection: &Connection) -> Result<Vec<Note>, StorageError> {
    let mut statement = connection.prepare(
        "SELECT id, size, x, y, z, scene_json, passive_date, revision, created_at, updated_at
         FROM notes ORDER BY z ASC, created_at ASC, id ASC",
    )?;
    let rows = statement.query_map([], stored_note_from_row)?;
    let mut notes = Vec::new();
    for row in rows {
        let stored = row?;
        match stored.into_note() {
            Ok(note) => notes.push(note),
            Err(error) => eprintln!("isolating unreadable note: {error}"),
        }
    }
    Ok(notes)
}

fn load_completed_notes(connection: &Connection) -> Result<Vec<CompletedNote>, StorageError> {
    let mut statement = connection.prepare(
        "SELECT id, size, scene_json, completed_on, completed_order
         FROM completed_notes ORDER BY completed_order ASC",
    )?;
    let rows = statement.query_map([], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, String>(3)?,
            row.get::<_, i64>(4)?,
        ))
    })?;
    let mut completed = Vec::new();
    for row in rows {
        let (id, size, scene_json, completed_on, completed_order) = row?;
        let Some(size) = NoteSize::from_database(&size) else {
            eprintln!("isolating unreadable completed note {id}: invalid size");
            continue;
        };
        let Ok(scene) = serde_json::from_str::<DrawingScene>(&scene_json) else {
            eprintln!("isolating unreadable completed note {id}: invalid scene");
            continue;
        };
        if validate_scene(&scene).is_err() {
            eprintln!("isolating unreadable completed note {id}: unsupported scene");
            continue;
        }
        completed.push(CompletedNote {
            id,
            size,
            scene,
            completed_on,
            completed_order,
        });
    }
    Ok(completed)
}

fn select_note(connection: &Connection, id: &str) -> Result<Option<Note>, StorageError> {
    let stored = connection
        .query_row(
            "SELECT id, size, x, y, z, scene_json, passive_date, revision, created_at, updated_at
             FROM notes WHERE id = ?1",
            [id],
            stored_note_from_row,
        )
        .optional()?;
    stored.map(StoredNote::into_note).transpose()
}

struct StoredNote {
    id: String,
    size: String,
    x: f64,
    y: f64,
    z: i64,
    scene_json: String,
    passive_date: Option<String>,
    revision: i64,
    created_at: String,
    updated_at: String,
}

impl StoredNote {
    fn into_note(self) -> Result<Note, StorageError> {
        let size = NoteSize::from_database(&self.size).ok_or_else(|| {
            StorageError::Validation(format!("note {} has invalid size", self.id))
        })?;
        let scene = serde_json::from_str::<DrawingScene>(&self.scene_json)?;
        validate_scene(&scene)?;
        Ok(Note {
            id: self.id,
            size,
            position: Position {
                x: self.x,
                y: self.y,
                z: self.z,
            },
            scene,
            passive_date: self.passive_date,
            revision: self.revision,
            created_at: self.created_at,
            updated_at: self.updated_at,
        })
    }
}

fn stored_note_from_row(row: &Row<'_>) -> rusqlite::Result<StoredNote> {
    Ok(StoredNote {
        id: row.get(0)?,
        size: row.get(1)?,
        x: row.get(2)?,
        y: row.get(3)?,
        z: row.get(4)?,
        scene_json: row.get(5)?,
        passive_date: row.get(6)?,
        revision: row.get(7)?,
        created_at: row.get(8)?,
        updated_at: row.get(9)?,
    })
}

fn validate_id(id: &str) -> Result<(), StorageError> {
    if id.trim().is_empty() {
        Err(StorageError::Validation(
            "note id cannot be empty".to_owned(),
        ))
    } else {
        Ok(())
    }
}

fn validate_scene(scene: &DrawingScene) -> Result<(), StorageError> {
    if scene.schema_version != 1 {
        return Err(StorageError::Validation(format!(
            "unsupported scene schema version {}",
            scene.schema_version
        )));
    }
    if scene.engine != "songtie-svg" {
        return Err(StorageError::Validation(format!(
            "unsupported drawing engine {}",
            scene.engine
        )));
    }
    if scene.background_color.trim().is_empty() {
        return Err(StorageError::Validation(
            "drawing background color cannot be empty".to_owned(),
        ));
    }
    for element in &scene.elements {
        let Some(object) = element.as_object() else {
            return Err(StorageError::Validation(
                "drawing elements must be objects".to_owned(),
            ));
        };
        let has_id = object
            .get("id")
            .and_then(|value| value.as_str())
            .is_some_and(|id| !id.trim().is_empty());
        let known_type = object
            .get("type")
            .and_then(|value| value.as_str())
            .is_some_and(|kind| {
                matches!(
                    kind,
                    "text" | "path" | "line" | "arrow" | "rectangle" | "ellipse"
                )
            });
        if !has_id || !known_type {
            return Err(StorageError::Validation(
                "drawing elements need a non-empty id and supported type".to_owned(),
            ));
        }
    }
    Ok(())
}

fn validate_position(position: Position) -> Result<(), StorageError> {
    if !position.x.is_finite() || !position.y.is_finite() || position.z < 0 {
        return Err(StorageError::Validation(
            "note position must be finite and z must be non-negative".to_owned(),
        ));
    }
    Ok(())
}

fn validate_wall(wall: &Wall) -> Result<(), StorageError> {
    if wall.id != "active" {
        return Err(StorageError::Validation(
            "the only supported wall id is active".to_owned(),
        ));
    }
    validate_bounds(wall.bounds)?;
    validate_scene(&wall.scene)?;
    validate_timestamp(&wall.updated_at, "updatedAt")?;
    Ok(())
}

fn validate_timestamp(value: &str, field: &str) -> Result<(), StorageError> {
    DateTime::parse_from_rfc3339(value)
        .map_err(|_| StorageError::Validation(format!("{field} must be an RFC 3339 timestamp")))?;
    Ok(())
}

fn validate_bounds(bounds: WallBounds) -> Result<(), StorageError> {
    if !bounds.width.is_finite()
        || !bounds.height.is_finite()
        || bounds.width <= 0.0
        || bounds.height <= 0.0
    {
        return Err(StorageError::Validation(
            "wall bounds must be positive finite values".to_owned(),
        ));
    }
    Ok(())
}

fn parse_scene_or_empty(value: &str, owner: &str) -> DrawingScene {
    match serde_json::from_str::<DrawingScene>(value) {
        Ok(scene) if validate_scene(&scene).is_ok() => scene,
        _ => {
            eprintln!("isolating unreadable scene for {owner}");
            DrawingScene::empty()
        }
    }
}

fn now_utc() -> String {
    let now: DateTime<Utc> = Utc::now();
    now.to_rfc3339_opts(SecondsFormat::Millis, true)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::{
        path::{Path, PathBuf},
        sync::atomic::{AtomicU64, Ordering},
    };

    static TEMP_DATABASE_SEQUENCE: AtomicU64 = AtomicU64::new(0);

    struct TemporaryDatabase {
        path: PathBuf,
    }

    impl TemporaryDatabase {
        fn new() -> Self {
            let sequence = TEMP_DATABASE_SEQUENCE.fetch_add(1, Ordering::Relaxed);
            let path = std::env::temp_dir().join(format!(
                "songtie-reopen-test-{}-{sequence}.sqlite3",
                std::process::id()
            ));
            let temporary = Self { path };
            temporary.cleanup().expect("remove stale test database");
            temporary
        }

        fn path(&self) -> &Path {
            &self.path
        }

        fn paths(&self) -> [PathBuf; 3] {
            let sidecar = |suffix: &str| {
                let mut name = self.path.as_os_str().to_os_string();
                name.push(suffix);
                PathBuf::from(name)
            };
            [self.path.clone(), sidecar("-wal"), sidecar("-shm")]
        }

        fn cleanup(&self) -> std::io::Result<()> {
            for path in self.paths() {
                match std::fs::remove_file(&path) {
                    Ok(()) => {}
                    Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                    Err(error) => return Err(error),
                }
            }
            Ok(())
        }
    }

    impl Drop for TemporaryDatabase {
        fn drop(&mut self) {
            let _ = self.cleanup();
        }
    }

    fn scene_with_text(text: &str) -> DrawingScene {
        DrawingScene {
            schema_version: 1,
            engine: "songtie-svg".to_owned(),
            background_color: "#f8e7a3".to_owned(),
            elements: vec![json!({"id": "text-1", "type": "text", "text": text})],
        }
    }

    fn create_input(text: &str) -> CreateNoteInput {
        CreateNoteInput {
            note: Note {
                id: format!("note-{text}"),
                size: NoteSize::M,
                position: Position {
                    x: 24.0,
                    y: 48.0,
                    z: 1,
                },
                scene: scene_with_text(text),
                passive_date: None,
                revision: 1,
                created_at: "2026-08-20T10:00:00.000Z".to_owned(),
                updated_at: "2026-08-20T10:00:00.000Z".to_owned(),
            },
        }
    }

    fn wall_input() -> InitializeWallInput {
        InitializeWallInput {
            wall: Wall {
                id: "active".to_owned(),
                bounds: WallBounds {
                    width: 1456.0,
                    height: 819.0,
                },
                scene: DrawingScene::empty(),
                revision: 1,
                updated_at: "2026-08-20T09:00:00.000Z".to_owned(),
            },
        }
    }

    #[test]
    fn migration_creates_v1_schema_without_inventing_a_wall() {
        let database = Database::in_memory().expect("database");
        database.with_connection(|connection| {
            let version: i64 = connection
                .query_row("PRAGMA user_version", [], |row| row.get(0))
                .expect("schema version");
            assert_eq!(version, 1);

            for table in [
                "active_wall",
                "notes",
                "completed_notes",
                "recovery_log",
                "settings",
            ] {
                let exists: bool = connection
                    .query_row(
                        "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?1)",
                        [table],
                        |row| row.get(0),
                    )
                    .expect("table lookup");
                assert!(exists, "missing table {table}");
            }
        });

        let state = database.load_state().expect("load state");
        assert!(state.wall.is_none());
        assert!(state.notes.is_empty());

        let initialized = database
            .initialize_wall(wall_input())
            .expect("initialize wall");
        assert_eq!(initialized.wall.expect("wall").revision, 1);
    }

    #[test]
    fn file_database_survives_close_and_reopen() {
        let temporary = TemporaryDatabase::new();
        let expected_note = {
            let database = Database::open(temporary.path()).expect("open temporary database");
            database
                .initialize_wall(wall_input())
                .expect("initialize wall");
            database
                .create_note(create_input("persisted"))
                .expect("create note")
                .notes
                .remove(0)
        };

        {
            let reopened = Database::open(temporary.path()).expect("reopen temporary database");
            let state = reopened.load_state().expect("load reopened state");
            assert_eq!(state.wall.expect("persisted wall").revision, 1);
            assert_eq!(state.notes, vec![expected_note.clone()]);
            reopened.with_connection(|connection| {
                let log_count: i64 = connection
                    .query_row("SELECT COUNT(*) FROM recovery_log", [], |row| row.get(0))
                    .expect("persisted recovery log");
                assert_eq!(log_count, 1);
            });
        }

        temporary.cleanup().expect("clean temporary database");
        assert!(temporary.paths().iter().all(|path| !path.exists()));
    }

    #[test]
    fn unsupported_migration_version_leaves_existing_database_untouched() {
        let temporary = TemporaryDatabase::new();
        {
            let connection = Connection::open(temporary.path()).expect("seed future database");
            connection
                .execute_batch(
                    "CREATE TABLE sentinel (value TEXT NOT NULL);
                     INSERT INTO sentinel (value) VALUES ('keep me');
                     PRAGMA user_version = 2;",
                )
                .expect("seed sentinel data");
        }

        assert!(matches!(
            Database::open(temporary.path()),
            Err(StorageError::UnsupportedVersion {
                found: 2,
                supported: 1
            })
        ));

        let connection = Connection::open(temporary.path()).expect("reopen untouched database");
        let value: String = connection
            .query_row("SELECT value FROM sentinel", [], |row| row.get(0))
            .expect("sentinel survives failed migration");
        let version: i64 = connection
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .expect("future version survives");
        assert_eq!(value, "keep me");
        assert_eq!(version, 2);
    }

    #[test]
    fn unreadable_scenes_are_isolated_without_blocking_healthy_records() {
        let database = Database::in_memory().expect("database");
        database
            .initialize_wall(wall_input())
            .expect("initialize wall");
        database
            .create_note(create_input("healthy"))
            .expect("healthy note");
        database
            .create_note(create_input("damaged"))
            .expect("damaged note");
        database.with_connection(|connection| {
            connection
                .execute(
                    "UPDATE notes SET scene_json = 'not-json' WHERE id = 'note-damaged'",
                    [],
                )
                .expect("corrupt one note");
            connection
                .execute("UPDATE active_wall SET scene_json = 'not-json'", [])
                .expect("corrupt wall scene");
        });

        let state = database.load_state().expect("load remaining healthy state");
        assert_eq!(state.notes.len(), 1);
        assert_eq!(state.notes[0].id, "note-healthy");
        assert!(state
            .wall
            .expect("wall metadata remains")
            .scene
            .elements
            .is_empty());
    }

    #[test]
    fn create_writes_initial_snapshot_in_same_operation() {
        let database = Database::in_memory().expect("database");
        let state = database
            .create_note(create_input("new idea"))
            .expect("create");
        let created = state.notes.first().expect("created note");

        database.with_connection(|connection| {
            let (event_type, entity_id, payload): (String, String, String) = connection
                .query_row(
                    "SELECT event_type, entity_id, payload_json FROM recovery_log",
                    [],
                    |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
                )
                .expect("creation log");
            assert_eq!(event_type, "note_created");
            assert_eq!(entity_id, created.id);
            let snapshot: Note = serde_json::from_str(&payload).expect("snapshot");
            assert_eq!(snapshot, *created);
        });
    }

    #[test]
    fn quick_state_reads_only_wall_bounds_and_note_placements() {
        let database = Database::in_memory().expect("database");
        database
            .initialize_wall(wall_input())
            .expect("initialize wall");
        database
            .create_quick_note(create_input("quick projection"))
            .expect("create quick note");
        database.with_connection(|connection| {
            connection
                .execute("UPDATE active_wall SET scene_json = 'not-json'", [])
                .expect("corrupt unused wall scene");
            connection
                .execute("UPDATE notes SET scene_json = 'not-json'", [])
                .expect("corrupt unused note scene");
            connection
                .execute("DROP TABLE completed_notes", [])
                .expect("remove unused completed projection");
        });

        let state = database.load_quick_state().expect("load quick projection");
        assert_eq!(
            serde_json::to_value(state).expect("serialize quick projection"),
            json!({
                "wallBounds": { "width": 1456.0, "height": 819.0 },
                "notes": [{
                    "id": "note-quick projection",
                    "size": "M",
                    "position": { "x": 24.0, "y": 48.0, "z": 1 }
                }]
            })
        );
    }

    #[test]
    fn quick_create_uses_atomic_creation_and_recovery_log_path() {
        let database = Database::in_memory().expect("database");
        database
            .create_quick_note(create_input("quick lifecycle"))
            .expect("create quick note");

        database.with_connection(|connection| {
            let (note_count, log_count): (i64, i64) = connection
                .query_row(
                    "SELECT
                       (SELECT COUNT(*) FROM notes),
                       (SELECT COUNT(*) FROM recovery_log)",
                    [],
                    |row| Ok((row.get(0)?, row.get(1)?)),
                )
                .expect("creation counts");
            assert_eq!((note_count, log_count), (1, 1));

            let (event_type, payload): (String, String) = connection
                .query_row(
                    "SELECT event_type, payload_json FROM recovery_log",
                    [],
                    |row| Ok((row.get(0)?, row.get(1)?)),
                )
                .expect("quick creation log");
            assert_eq!(event_type, "note_created");
            let snapshot: Note = serde_json::from_str(&payload).expect("quick snapshot");
            assert_eq!(snapshot.id, "note-quick lifecycle");
        });

        assert!(database
            .create_quick_note(create_input("quick lifecycle"))
            .is_err());
        database.with_connection(|connection| {
            let log_count: i64 = connection
                .query_row("SELECT COUNT(*) FROM recovery_log", [], |row| row.get(0))
                .expect("unchanged log count");
            assert_eq!(log_count, 1);
        });
    }

    #[test]
    fn save_increments_revision_without_lifecycle_log() {
        let database = Database::in_memory().expect("database");
        let created = database
            .create_note(create_input("draft"))
            .expect("create")
            .notes
            .remove(0);
        let state = database
            .save_note(SaveNoteInput {
                note: Note {
                    id: created.id.clone(),
                    size: NoteSize::L,
                    position: Position {
                        x: 100.0,
                        y: 120.0,
                        z: 4,
                    },
                    scene: scene_with_text("edited"),
                    passive_date: Some("2026-08-20".to_owned()),
                    revision: 2,
                    created_at: created.created_at.clone(),
                    updated_at: "2026-08-20T11:00:00.000Z".to_owned(),
                },
                expected_revision: created.revision,
            })
            .expect("save");
        assert_eq!(state.notes[0].revision, 2);

        database.with_connection(|connection| {
            let count: i64 = connection
                .query_row("SELECT COUNT(*) FROM recovery_log", [], |row| row.get(0))
                .expect("log count");
            assert_eq!(count, 1);
        });
    }

    #[test]
    fn complete_moves_note_atomically_and_never_logs_delete() {
        let database = Database::in_memory().expect("database");
        let created = database
            .create_note(create_input("ship it"))
            .expect("create")
            .notes
            .remove(0);
        let state = database
            .complete_note(CompleteNoteInput {
                id: created.id.clone(),
                expected_revision: created.revision,
                completed: CompletedNote {
                    id: created.id.clone(),
                    size: created.size,
                    scene: created.scene.clone(),
                    completed_on: "2026-08-20".to_owned(),
                    completed_order: 1,
                },
            })
            .expect("complete");

        assert!(state.notes.is_empty());
        assert_eq!(state.completed_notes.len(), 1);
        assert_eq!(state.completed_notes[0].id, created.id);
        database.with_connection(|connection| {
            let log_count: i64 = connection
                .query_row("SELECT COUNT(*) FROM recovery_log", [], |row| row.get(0))
                .expect("log count");
            assert_eq!(log_count, 1);
        });
    }

    #[test]
    fn failed_completion_rolls_back_active_note_removal() {
        let database = Database::in_memory().expect("database");
        let created = database
            .create_note(create_input("stay active"))
            .expect("create")
            .notes
            .remove(0);
        database.with_connection(|connection| {
            connection
                .execute(
                    "INSERT INTO completed_notes
                     (id, size, scene_json, completed_on, completed_order)
                     VALUES (?1, 'S', ?2, '2026-08-19', 1)",
                    params![
                        created.id,
                        serde_json::to_string(&DrawingScene::empty()).unwrap()
                    ],
                )
                .expect("seed conflict");
        });

        let result = database.complete_note(CompleteNoteInput {
            id: created.id.clone(),
            expected_revision: created.revision,
            completed: CompletedNote {
                id: created.id.clone(),
                size: created.size,
                scene: created.scene.clone(),
                completed_on: "2026-08-20".to_owned(),
                completed_order: 2,
            },
        });
        assert!(result.is_err());
        assert_eq!(database.load_state().expect("state").notes.len(), 1);
    }

    #[test]
    fn delete_log_contains_final_edited_snapshot() {
        let database = Database::in_memory().expect("database");
        let created = database
            .create_note(create_input("first"))
            .expect("create")
            .notes
            .remove(0);
        let saved = database
            .save_note(SaveNoteInput {
                note: Note {
                    id: created.id.clone(),
                    size: NoteSize::L,
                    position: Position {
                        x: 8.0,
                        y: 9.0,
                        z: 7,
                    },
                    scene: scene_with_text("final"),
                    passive_date: Some("someday".to_owned()),
                    revision: 2,
                    created_at: created.created_at.clone(),
                    updated_at: "2026-08-20T12:00:00.000Z".to_owned(),
                },
                expected_revision: created.revision,
            })
            .expect("save")
            .notes
            .remove(0);
        let state = database
            .delete_note(&saved.id, saved.revision)
            .expect("delete");
        assert!(state.notes.is_empty());

        database.with_connection(|connection| {
            let payload: String = connection
                .query_row(
                    "SELECT payload_json FROM recovery_log
                     WHERE event_type = 'note_deleted' AND entity_id = ?1",
                    [&saved.id],
                    |row| row.get(0),
                )
                .expect("deletion snapshot");
            let snapshot: Note = serde_json::from_str(&payload).expect("snapshot");
            assert_eq!(snapshot, saved);
            let count: i64 = connection
                .query_row("SELECT COUNT(*) FROM recovery_log", [], |row| row.get(0))
                .expect("log count");
            assert_eq!(count, 2);
        });
    }
}
