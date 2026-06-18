use std::fs;
use tauri::menu::{MenuBuilder, MenuItem, SubmenuBuilder};
use tauri::{Emitter, Manager};

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
        // (platform convention), rather than quitting. Cmd+Q still quits.
        .on_window_event(|_window, _event| {
            #[cfg(target_os = "macos")]
            if let tauri::WindowEvent::CloseRequested { api, .. } = _event {
                api.prevent_close();
                let _ = _window.hide();
            }
        })
        // File-menu items forward to the frontend, which owns the New/Open/Save logic.
        .on_menu_event(|app, event| match event.id().0.as_str() {
            "new" => {
                let _ = app.emit("menu:new", ());
            }
            "open" => {
                let _ = app.emit("menu:open", ());
            }
            "save" => {
                let _ = app.emit("menu:save", ());
            }
            _ => {}
        })
        .setup(|app| {
            let new_item = MenuItem::with_id(app, "new", "New", true, Some("CmdOrCtrl+N"))?;
            let open_item = MenuItem::with_id(app, "open", "Open…", true, Some("CmdOrCtrl+O"))?;
            let save_item = MenuItem::with_id(app, "save", "Save", true, Some("CmdOrCtrl+S"))?;

            let app_menu = SubmenuBuilder::new(app, "sigpath")
                .about(None)
                .separator()
                .quit()
                .build()?;

            let file_menu = SubmenuBuilder::new(app, "File")
                .item(&new_item)
                .item(&open_item)
                .separator()
                .item(&save_item)
                .build()?;

            // Standard editing items so text fields support cut/copy/paste/select-all.
            // Undo/Redo are intentionally omitted so ⌘Z stays bound to canvas undo.
            let edit_menu = SubmenuBuilder::new(app, "Edit")
                .cut()
                .copy()
                .paste()
                .select_all()
                .build()?;

            let window_menu = SubmenuBuilder::new(app, "Window").minimize().build()?;

            let menu = MenuBuilder::new(app)
                .item(&app_menu)
                .item(&file_menu)
                .item(&edit_menu)
                .item(&window_menu)
                .build()?;

            app.set_menu(menu)?;
            Ok(())
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
