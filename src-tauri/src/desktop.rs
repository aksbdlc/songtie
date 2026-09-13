use std::{
    env,
    path::Path,
    process::Command,
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc,
    },
    time::Duration,
};

use serde::{Deserialize, Serialize};
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    App, AppHandle, Emitter, Listener, Manager,
};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

const QUICK_SHORTCUT: &str = "Ctrl+Alt+N";
const WALL_SHORTCUT: &str = "Ctrl+Alt+M";
const NAVIGATION_EVENT: &str = "navigate";
const FLUSH_REQUEST_EVENT: &str = "flush-request";
const FLUSH_COMPLETE_EVENT: &str = "flush-complete";
const EXIT_FLUSH_TIMEOUT: Duration = Duration::from_secs(3);
const GNOME_MEDIA_SCHEMA: &str = "org.gnome.settings-daemon.plugins.media-keys";
const GNOME_BINDING_SCHEMA: &str = "org.gnome.settings-daemon.plugins.media-keys.custom-keybinding";
const GNOME_QUICK_PATH: &str =
    "/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/songtie-quick/";
const GNOME_WALL_PATH: &str =
    "/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/songtie-wall/";
static EXIT_PENDING: AtomicBool = AtomicBool::new(false);
static EXIT_TOKEN_SEQUENCE: AtomicU64 = AtomicU64::new(0);

#[derive(Clone, Debug, Deserialize, Serialize)]
struct FlushPayload {
    token: String,
}

pub fn setup(app: &mut App) -> Result<(), Box<dyn std::error::Error>> {
    create_tray(app)?;
    register_shortcuts(app);
    register_gnome_wayland_shortcuts();
    enable_autostart_in_production(app);
    Ok(())
}

pub fn show_requested_entry(app: &AppHandle, args: &[String]) -> bool {
    if args.iter().any(|argument| argument == "--quick") {
        show_quick_capture(app);
        true
    } else if args.iter().any(|argument| argument == "--completed") {
        show_main(app, "completed");
        true
    } else if args.iter().any(|argument| argument == "--wall") {
        show_main(app, "wall");
        true
    } else {
        false
    }
}

pub fn global_shortcut_plugin() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    tauri_plugin_global_shortcut::Builder::new()
        .with_handler(|app, shortcut, event| {
            if event.state() != ShortcutState::Pressed {
                return;
            }

            let quick = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::KeyN);
            let wall = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::KeyM);
            if shortcut == &quick {
                show_quick_capture(app);
            } else if shortcut == &wall {
                show_main(app, "wall");
            }
        })
        .build()
}

pub fn show_main(app: &AppHandle, destination: &str) {
    if let Some(quick) = app.get_webview_window("quick-capture") {
        let _ = quick.hide();
    }
    let Some(window) = app.get_webview_window("main") else {
        eprintln!("main window is unavailable");
        return;
    };
    if let Err(error) = window.show() {
        eprintln!("could not show main window: {error}");
        return;
    }
    if let Err(error) = window.set_fullscreen(true) {
        eprintln!("could not make main window fullscreen: {error}");
    }
    let _ = window.unminimize();
    if let Err(error) = window.set_focus() {
        eprintln!("could not focus main window: {error}");
    }
    let mapped_window = window.clone();
    tauri::async_runtime::spawn(async move {
        // Wayland only applies fullscreen reliably after the hidden surface has
        // been mapped once. Repeating the idempotent request after that frame
        // avoids restoring the default 800×600 geometry.
        std::thread::sleep(Duration::from_millis(140));
        if let Err(error) = mapped_window.set_fullscreen(true) {
            eprintln!("could not confirm main fullscreen state: {error}");
        }
        let _ = mapped_window.set_focus();
    });
    if let Err(error) = window.emit(NAVIGATION_EVENT, destination) {
        eprintln!("could not navigate main window: {error}");
    }
}

pub fn show_quick_capture(app: &AppHandle) {
    let Some(window) = app.get_webview_window("quick-capture") else {
        eprintln!("quick-capture window is unavailable");
        return;
    };
    let _ = window.center();
    if let Err(error) = window.show() {
        eprintln!("could not show quick-capture window: {error}");
        return;
    }
    let _ = window.unminimize();
    if let Err(error) = window.set_focus() {
        eprintln!("could not focus quick-capture window: {error}");
    }
}

fn create_tray(app: &App) -> Result<(), Box<dyn std::error::Error>> {
    let current_wall = MenuItem::with_id(app, "current-wall", "当前墙", true, None::<&str>)?;
    let quick_capture = MenuItem::with_id(app, "quick-capture", "随手贴", true, None::<&str>)?;
    let completed_wall = MenuItem::with_id(app, "completed-wall", "完成陈列", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "退出松贴", true, None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[&current_wall, &quick_capture, &completed_wall, &quit],
    )?;

    let mut tray = TrayIconBuilder::with_id("songtie-tray")
        .tooltip("松贴")
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "current-wall" => show_main(app, "wall"),
            "quick-capture" => show_quick_capture(app),
            "completed-wall" => show_main(app, "completed"),
            "quit" => request_flush_and_exit(app),
            _ => {}
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    Ok(())
}

fn request_flush_and_exit(app: &AppHandle) {
    if EXIT_PENDING.swap(true, Ordering::AcqRel) {
        return;
    }

    let token = next_flush_token();
    let exited = Arc::new(AtomicBool::new(false));
    let listener_app = app.clone();
    let listener_token = token.clone();
    let listener_exited = Arc::clone(&exited);
    app.listen(FLUSH_COMPLETE_EVENT, move |event| {
        if !flush_payload_matches(event.payload(), &listener_token) {
            return;
        }
        listener_app.unlisten(event.id());
        exit_once(&listener_app, &listener_exited);
    });

    if let Err(error) = app.emit_to("main", FLUSH_REQUEST_EVENT, FlushPayload { token }) {
        eprintln!("could not request a final frontend flush: {error}");
    }

    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        // The acknowledgement normally exits immediately. This bounded fallback
        // only covers a crashed or unresponsive frontend and stays off the IPC
        // executor so an in-flight save can finish and acknowledge.
        std::thread::sleep(EXIT_FLUSH_TIMEOUT);
        exit_once(&app, &exited);
    });
}

fn next_flush_token() -> String {
    let sequence = EXIT_TOKEN_SEQUENCE.fetch_add(1, Ordering::Relaxed) + 1;
    format!("songtie-exit-{}-{sequence}", std::process::id())
}

fn flush_payload_matches(payload: &str, expected_token: &str) -> bool {
    serde_json::from_str::<FlushPayload>(payload)
        .is_ok_and(|acknowledgement| acknowledgement.token == expected_token)
}

fn exit_once(app: &AppHandle, exited: &AtomicBool) {
    if !exited.swap(true, Ordering::AcqRel) {
        app.exit(0);
    }
}

fn register_shortcuts(app: &App) {
    for shortcut in [QUICK_SHORTCUT, WALL_SHORTCUT] {
        if let Err(error) = app.global_shortcut().register(shortcut) {
            // A conflicting desktop shortcut must not make the local data space
            // unusable; the same actions remain available from the tray.
            eprintln!("could not register global shortcut {shortcut}: {error}");
        }
    }
}

fn register_gnome_wayland_shortcuts() {
    let session = env::var("XDG_SESSION_TYPE").unwrap_or_default();
    let desktop = env::var("XDG_CURRENT_DESKTOP").unwrap_or_default();
    if !session.eq_ignore_ascii_case("wayland")
        || !(desktop.to_ascii_lowercase().contains("gnome")
            || desktop.to_ascii_lowercase().contains("ubuntu"))
    {
        return;
    }

    let executable = env::var_os("APPIMAGE")
        .map(Into::into)
        .or_else(|| env::current_exe().ok());
    let Some(executable) = executable else {
        eprintln!("could not resolve executable for GNOME shortcuts");
        return;
    };

    let existing = Command::new("gsettings")
        .args(["get", GNOME_MEDIA_SCHEMA, "custom-keybindings"])
        .output();
    let Ok(existing) = existing else {
        eprintln!("could not read GNOME custom shortcuts");
        return;
    };
    let mut paths = parse_gsettings_paths(&String::from_utf8_lossy(&existing.stdout));

    for (path, name, argument, binding) in [
        (
            GNOME_QUICK_PATH,
            "松贴：随手贴",
            "--quick",
            "<Primary><Alt>n",
        ),
        (GNOME_WALL_PATH, "松贴：当前墙", "--wall", "<Primary><Alt>m"),
    ] {
        if gnome_binding_is_used(&paths, path, binding) {
            paths.retain(|current| current != path);
            eprintln!(
                "GNOME shortcut {binding} is already in use; tray fallback remains available"
            );
            continue;
        }
        if let Err(error) =
            install_gnome_binding(path, name, &command_for(&executable, argument), binding)
        {
            paths.retain(|current| current != path);
            eprintln!("could not install GNOME shortcut {binding}: {error}");
            continue;
        }
        if !paths.iter().any(|current| current == path) {
            paths.push(path.to_owned());
        }
    }
    let value = format!(
        "[{}]",
        paths
            .iter()
            .map(|path| format!("'{path}'"))
            .collect::<Vec<_>>()
            .join(", ")
    );
    if !gsettings_set(GNOME_MEDIA_SCHEMA, "custom-keybindings", &value) {
        eprintln!("could not activate GNOME custom shortcuts");
    }
}

fn gnome_binding_is_used(paths: &[String], own_path: &str, binding: &str) -> bool {
    let wanted = normalize_binding(binding);
    paths
        .iter()
        .filter(|path| path.as_str() != own_path)
        .any(|path| {
            let schema = format!("{GNOME_BINDING_SCHEMA}:{path}");
            Command::new("gsettings")
                .args(["get", &schema, "binding"])
                .output()
                .ok()
                .filter(|output| output.status.success())
                .is_some_and(|output| {
                    normalize_binding(&String::from_utf8_lossy(&output.stdout)) == wanted
                })
        })
}

fn normalize_binding(value: &str) -> String {
    value
        .trim()
        .trim_matches(['\'', '"'])
        .to_ascii_lowercase()
        .replace("<primary>", "<control>")
}

fn install_gnome_binding(
    path: &str,
    name: &str,
    command: &str,
    binding: &str,
) -> Result<(), &'static str> {
    let schema = format!("{GNOME_BINDING_SCHEMA}:{path}");
    for (key, value) in [
        ("name", gvariant_string(name)),
        ("command", gvariant_string(command)),
        ("binding", gvariant_string(binding)),
    ] {
        if !gsettings_set(&schema, key, &value) {
            return Err("gsettings rejected a custom shortcut value");
        }
    }
    Ok(())
}

fn gsettings_set(schema: &str, key: &str, value: &str) -> bool {
    Command::new("gsettings")
        .args(["set", schema, key, value])
        .status()
        .is_ok_and(|status| status.success())
}

fn gvariant_string(value: &str) -> String {
    format!("'{}'", value.replace('\\', "\\\\").replace('\'', "\\'"))
}

fn command_for(executable: &Path, argument: &str) -> String {
    let path = executable.to_string_lossy();
    format!("'{}' {argument}", path.replace('\'', "'\\''"))
}

fn parse_gsettings_paths(value: &str) -> Vec<String> {
    value
        .split('\'')
        .skip(1)
        .step_by(2)
        .filter(|item| item.starts_with('/'))
        .map(str::to_owned)
        .collect()
}

#[cfg(not(debug_assertions))]
fn enable_autostart_in_production(app: &App) {
    use tauri_plugin_autostart::ManagerExt;

    if let Err(error) = app.autolaunch().enable() {
        eprintln!("could not enable autostart: {error}");
    }
}

#[cfg(debug_assertions)]
fn enable_autostart_in_production(_app: &App) {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_gsettings_path_lists_without_losing_existing_entries() {
        let parsed = parse_gsettings_paths("['/org/example/custom0/', '/org/example/custom1/']");
        assert_eq!(
            parsed,
            vec!["/org/example/custom0/", "/org/example/custom1/"]
        );
        assert!(parse_gsettings_paths("@as []").is_empty());
    }

    #[test]
    fn shell_command_quotes_executable_paths() {
        assert_eq!(
            command_for(Path::new("/tmp/Song tie's/app"), "--quick"),
            "'/tmp/Song tie'\\''s/app' --quick"
        );
    }

    #[test]
    fn normalizes_primary_and_control_as_the_same_binding() {
        assert_eq!(
            normalize_binding("'<Primary><Alt>N'"),
            normalize_binding("<Control><Alt>n")
        );
    }

    #[test]
    fn flush_acknowledgement_requires_the_matching_token() {
        assert!(flush_payload_matches(
            r#"{"token":"songtie-exit-42-1"}"#,
            "songtie-exit-42-1"
        ));
        assert!(!flush_payload_matches(
            r#"{"token":"songtie-exit-42-0"}"#,
            "songtie-exit-42-1"
        ));
        assert!(!flush_payload_matches("not-json", "songtie-exit-42-1"));
    }

    #[test]
    fn flush_tokens_are_unique_within_the_process() {
        assert_ne!(next_flush_token(), next_flush_token());
    }
}
