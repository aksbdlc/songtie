use tauri::{AppHandle, Emitter, State};

use crate::{
    desktop,
    models::{
        AppStatePayload, CommandError, CompleteNoteInput, CreateNoteInput, DeleteNoteInput,
        InitializeWallInput, QuickStatePayload, SaveNoteInput, SaveWallInput,
    },
    persistence::{Database, StorageError},
};

const STATE_CHANGED_EVENT: &str = "state-changed";
const STATE_INVALIDATED_EVENT: &str = "state-invalidated";

impl From<StorageError> for CommandError {
    fn from(error: StorageError) -> Self {
        Self {
            code: error.code(),
            message: error.to_string(),
        }
    }
}

#[tauri::command]
pub fn load_state(database: State<'_, Database>) -> Result<AppStatePayload, CommandError> {
    database.load_state().map_err(Into::into)
}

#[tauri::command]
pub fn load_quick_state(database: State<'_, Database>) -> Result<QuickStatePayload, CommandError> {
    database.load_quick_state().map_err(Into::into)
}

#[tauri::command]
pub fn show_quick_capture(app: AppHandle) {
    desktop::show_quick_capture(&app);
}

#[tauri::command]
pub fn show_main(route: String, app: AppHandle) {
    desktop::show_main(&app, &route);
}

#[tauri::command]
pub fn create_note(
    input: CreateNoteInput,
    database: State<'_, Database>,
    app: AppHandle,
) -> Result<AppStatePayload, CommandError> {
    persist_and_broadcast(&app, database.create_note(input))
}

#[tauri::command]
pub fn create_quick_note(
    input: CreateNoteInput,
    database: State<'_, Database>,
    app: AppHandle,
) -> Result<(), CommandError> {
    database
        .create_quick_note(input)
        .map_err(CommandError::from)?;
    if let Err(error) = app.emit_to("main", STATE_INVALIDATED_EVENT, ()) {
        // The note and its recovery snapshot are already committed. The main
        // window can still reload on focus if this best-effort signal fails.
        eprintln!("could not broadcast {STATE_INVALIDATED_EVENT}: {error}");
    }
    Ok(())
}

#[tauri::command]
pub fn initialize_wall(
    input: InitializeWallInput,
    database: State<'_, Database>,
    app: AppHandle,
) -> Result<AppStatePayload, CommandError> {
    persist_and_broadcast(&app, database.initialize_wall(input))
}

#[tauri::command]
pub fn save_note(
    input: SaveNoteInput,
    database: State<'_, Database>,
    app: AppHandle,
) -> Result<AppStatePayload, CommandError> {
    persist_and_broadcast(&app, database.save_note(input))
}

#[tauri::command]
pub fn save_wall(
    input: SaveWallInput,
    database: State<'_, Database>,
    app: AppHandle,
) -> Result<AppStatePayload, CommandError> {
    persist_and_broadcast(&app, database.save_wall(input))
}

#[tauri::command]
pub fn complete_note(
    input: CompleteNoteInput,
    database: State<'_, Database>,
    app: AppHandle,
) -> Result<AppStatePayload, CommandError> {
    persist_and_broadcast(&app, database.complete_note(input))
}

#[tauri::command]
pub fn delete_note(
    input: DeleteNoteInput,
    database: State<'_, Database>,
    app: AppHandle,
) -> Result<AppStatePayload, CommandError> {
    persist_and_broadcast(
        &app,
        database.delete_note(&input.id, input.expected_revision),
    )
}

fn persist_and_broadcast(
    app: &AppHandle,
    operation: Result<AppStatePayload, StorageError>,
) -> Result<AppStatePayload, CommandError> {
    let state = operation.map_err(CommandError::from)?;
    if let Err(error) = app.emit(STATE_CHANGED_EVENT, &state) {
        // The database commit already succeeded. Returning the new state avoids
        // encouraging a caller to retry a non-idempotent lifecycle operation.
        eprintln!("could not broadcast {STATE_CHANGED_EVENT}: {error}");
    }
    Ok(state)
}
