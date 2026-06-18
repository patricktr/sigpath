use std::fs;
use tauri::Manager;

/// Read a UTF-8 text file at an absolute path chosen by the user via the dialog.
/// File I/O lives in app commands (not the fs plugin) so we don't have to grant
/// broad filesystem scope — the only permission surface is the open/save dialog.
#[tauri::command]
fn read_file(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|e| e.to_string())
}

/// Write `contents` to a UTF-8 text file at the given absolute path.
#[tauri::command]
fn write_file(path: String, contents: String) -> Result<(), String> {
    fs::write(&path, contents).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        // macOS: closing the window hides it and keeps the app alive in the Dock
        // (platform convention), rather than quitting. Cmd+Q still quits via the
        // app menu. On other platforms, last-window-close quits as usual.
        .on_window_event(|_window, _event| {
            #[cfg(target_os = "macos")]
            if let tauri::WindowEvent::CloseRequested { api, .. } = _event {
                api.prevent_close();
                let _ = _window.hide();
            }
        })
        .invoke_handler(tauri::generate_handler![read_file, write_file])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app, _event| {
            // macOS: clicking the Dock icon re-shows the hidden window.
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen { .. } = _event {
                if let Some(window) = _app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
        });
}
