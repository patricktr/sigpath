use std::collections::HashMap;
use std::fs;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Mutex;

use base64::{engine::general_purpose::STANDARD, Engine as _};
use tauri::menu::{MenuBuilder, MenuItem, SubmenuBuilder};
use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

/// What a freshly-created window should do once its frontend mounts.
#[derive(Clone, serde::Serialize)]
#[serde(tag = "kind", content = "path", rename_all = "camelCase")]
enum Pending {
    /// Show the open dialog and load the chosen file into this same window.
    OpenDialog,
    /// Load this specific file into this window.
    File(String),
}

#[derive(Default)]
struct PendingOpens(Mutex<HashMap<String, Pending>>);

static WINDOW_SEQ: AtomicU32 = AtomicU32::new(1);

fn spawn_window(app: &AppHandle, pending: Option<Pending>) {
    let label = format!("win-{}", WINDOW_SEQ.fetch_add(1, Ordering::SeqCst));
    if let Some(p) = pending {
        app.state::<PendingOpens>()
            .0
            .lock()
            .unwrap()
            .insert(label.clone(), p);
    }
    let _ = WebviewWindowBuilder::new(app, label, WebviewUrl::App("index.html".into()))
        .title("sigpath")
        .inner_size(980.0, 680.0)
        .build();
}

fn focused_window(app: &AppHandle) -> Option<WebviewWindow> {
    app.webview_windows()
        .into_values()
        .find(|w| w.is_focused().unwrap_or(false))
}

#[tauri::command]
fn read_file(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[tauri::command]
fn write_file(path: String, contents: String) -> Result<(), String> {
    fs::write(&path, contents).map_err(|e| e.to_string())
}

/// Write base64-encoded binary data to a path (used for exporting PNG/JPG/PDF).
#[tauri::command]
fn write_file_base64(path: String, data: String) -> Result<(), String> {
    let bytes = STANDARD.decode(data).map_err(|e| e.to_string())?;
    fs::write(&path, bytes).map_err(|e| e.to_string())
}

#[tauri::command]
fn new_window(app: AppHandle) {
    spawn_window(&app, None);
}

#[tauri::command]
fn open_window(app: AppHandle, path: String) {
    spawn_window(&app, Some(Pending::File(path)));
}

/// What this window should do on mount (load a file, show the open dialog, or nothing).
#[tauri::command]
fn take_pending_open(window: WebviewWindow, state: State<PendingOpens>) -> Option<Pending> {
    state.0.lock().unwrap().remove(window.label())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(PendingOpens::default())
        // New creates a window; Open/Save route to the focused window; with no
        // window open, Open spawns a window that opens into itself. Quit exits.
        .on_menu_event(|app, event| match event.id().0.as_str() {
            "new" => spawn_window(app, None),
            "open" => {
                if let Some(win) = focused_window(app) {
                    let _ = win.emit("menu:open", ());
                } else {
                    spawn_window(app, Some(Pending::OpenDialog));
                }
            }
            "save" => {
                if let Some(win) = focused_window(app) {
                    let _ = win.emit("menu:save", ());
                }
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .setup(|app| {
            let new_item = MenuItem::with_id(app, "new", "New", true, Some("CmdOrCtrl+N"))?;
            let open_item = MenuItem::with_id(app, "open", "Open…", true, Some("CmdOrCtrl+O"))?;
            let save_item = MenuItem::with_id(app, "save", "Save", true, Some("CmdOrCtrl+S"))?;
            let quit_item = MenuItem::with_id(app, "quit", "Quit sigpath", true, Some("CmdOrCtrl+Q"))?;

            let app_menu = SubmenuBuilder::new(app, "sigpath")
                .about(None)
                .separator()
                .item(&quit_item)
                .build()?;
            let file_menu = SubmenuBuilder::new(app, "File")
                .item(&new_item)
                .item(&open_item)
                .separator()
                .item(&save_item)
                .build()?;
            // Text editing items for inputs. Undo/Redo stay off so Cmd+Z is canvas undo.
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
        .invoke_handler(tauri::generate_handler![
            read_file,
            write_file,
            write_file_base64,
            new_window,
            open_window,
            take_pending_open
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| match event {
            // macOS: closing the last window keeps the app alive (window-driven exit
            // carries no code); real quits go through app.exit(0) and pass through.
            #[cfg(target_os = "macos")]
            tauri::RunEvent::ExitRequested { api, code, .. } => {
                if code.is_none() {
                    api.prevent_exit();
                }
            }
            // macOS: clicking the Dock icon with no windows visible makes a new one.
            #[cfg(target_os = "macos")]
            tauri::RunEvent::Reopen { has_visible_windows, .. } => {
                if !has_visible_windows {
                    spawn_window(app, None);
                }
            }
            _ => {}
        });
}
