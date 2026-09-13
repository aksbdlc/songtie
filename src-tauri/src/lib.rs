#[cfg_attr(test, allow(dead_code))]
mod commands;
#[cfg_attr(test, allow(dead_code))]
mod desktop;
#[cfg_attr(test, allow(dead_code))]
mod models;
#[cfg_attr(test, allow(dead_code))]
mod persistence;

#[cfg(not(test))]
use std::path::PathBuf;

#[cfg(not(test))]
use persistence::Database;
#[cfg(not(test))]
use tauri::Manager;

#[cfg(not(test))]
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // The single-instance plugin must be registered before every other plugin.
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            if !desktop::show_requested_entry(app, &args) {
                desktop::show_main(app, "wall");
            }
        }))
        .plugin(desktop::global_shortcut_plugin())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .setup(|app| {
            let database_path: PathBuf = app.path().app_data_dir()?.join("songtie.sqlite3");
            let database = Database::open(&database_path)?;
            app.manage(database);
            desktop::setup(app)?;
            let args = std::env::args().collect::<Vec<_>>();
            desktop::show_requested_entry(app.handle(), &args);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::show_quick_capture,
            commands::show_main,
            commands::load_state,
            commands::load_quick_state,
            commands::initialize_wall,
            commands::create_note,
            commands::create_quick_note,
            commands::save_note,
            commands::save_wall,
            commands::complete_note,
            commands::delete_note,
        ])
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                if let Err(error) = window.hide() {
                    eprintln!("could not hide window on close: {error}");
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running Songtie");
}

#[cfg(test)]
pub fn run() {}
