#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#[cfg(target_os = "linux")]
fn prefer_native_wayland() {
    if std::env::var("XDG_SESSION_TYPE")
        .is_ok_and(|session| session.eq_ignore_ascii_case("wayland"))
    {
        // linuxdeploy's GTK AppImage hook forces X11. Override it before
        // Tauri initializes GTK so fractional scaling stays native Wayland.
        std::env::set_var("GDK_BACKEND", "wayland");
    }
}

#[cfg(not(target_os = "linux"))]
fn prefer_native_wayland() {}

fn main() {
    prefer_native_wayland();
    songtie_lib::run();
}
