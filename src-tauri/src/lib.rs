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
    // Open at the current window's size so a new window matches the one you're in
    // (in logical px, so HiDPI is handled). Falls back to a comfortable default.
    let (w, h) = focused_window(app)
        .or_else(|| app.webview_windows().into_values().next())
        .and_then(|win| {
            let size = win.inner_size().ok()?;
            let scale = win.scale_factor().unwrap_or(1.0);
            Some((size.width as f64 / scale, size.height as f64 / scale))
        })
        .unwrap_or((1200.0, 800.0));
    let _ = WebviewWindowBuilder::new(app, label, WebviewUrl::App("index.html".into()))
        .title("sigpath")
        .inner_size(w, h)
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
        // Remember each window's size + position (and maximized state) so the app
        // reopens where and how you left it instead of a fixed default. The plugin
        // clamps a restored position back on-screen if the display layout changed.
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(
                    tauri_plugin_window_state::StateFlags::SIZE
                        | tauri_plugin_window_state::StateFlags::POSITION
                        | tauri_plugin_window_state::StateFlags::MAXIMIZED,
                )
                .build(),
        )
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(PendingOpens::default())
        // New creates a window; everything else routes to the focused window as a
        // `menu:*` event the frontend listens for. With no window open, Open spawns
        // a window that opens into itself. Quit exits.
        .on_menu_event(|app, event| {
            // Emit a `menu:*` event (optionally with a string payload) to whichever
            // window currently has focus — the same pattern Open/Save already use.
            let to_focused = |name: &str, payload: Option<&str>| {
                if let Some(win) = focused_window(app) {
                    match payload {
                        Some(p) => {
                            let _ = win.emit(name, p);
                        }
                        None => {
                            let _ = win.emit(name, ());
                        }
                    }
                }
            };
            match event.id().0.as_str() {
                "new" => spawn_window(app, None),
                "open" => {
                    if let Some(win) = focused_window(app) {
                        let _ = win.emit("menu:open", ());
                    } else {
                        spawn_window(app, Some(Pending::OpenDialog));
                    }
                }
                "save" => to_focused("menu:save", None),
                "save_as" => to_focused("menu:saveAs", None),
                "export_png" => to_focused("menu:export", Some("png")),
                "export_jpeg" => to_focused("menu:export", Some("jpeg")),
                "export_pdf" => to_focused("menu:export", Some("pdf")),
                "export_csv" => to_focused("menu:export", Some("csv")),
                "undo" => to_focused("menu:undo", None),
                "redo" => to_focused("menu:redo", None),
                "insert_device" => to_focused("menu:insertDevice", None),
                "insert_zone" => to_focused("menu:insertZone", None),
                "insert_note" => to_focused("menu:insertNote", None),
                "fit_view" => to_focused("menu:fitView", None),
                "zoom_zone" => to_focused("menu:zoomZone", None),
                "theme_system" => to_focused("menu:theme", Some("system")),
                "theme_light" => to_focused("menu:theme", Some("light")),
                "theme_dark" => to_focused("menu:theme", Some("dark")),
                "arrange" => to_focused("menu:arrange", None),
                "quit" => app.exit(0),
                _ => {}
            }
        })
        .setup(|app| {
            let new_item = MenuItem::with_id(app, "new", "New", true, Some("CmdOrCtrl+N"))?;
            let open_item = MenuItem::with_id(app, "open", "Open…", true, Some("CmdOrCtrl+O"))?;
            let save_item = MenuItem::with_id(app, "save", "Save", true, Some("CmdOrCtrl+S"))?;
            let save_as_item =
                MenuItem::with_id(app, "save_as", "Save As…", true, Some("CmdOrCtrl+Shift+S"))?;
            let export_png = MenuItem::with_id(app, "export_png", "PNG Image", true, None::<&str>)?;
            let export_jpeg =
                MenuItem::with_id(app, "export_jpeg", "JPEG Image", true, None::<&str>)?;
            let export_pdf = MenuItem::with_id(app, "export_pdf", "PDF", true, None::<&str>)?;
            let export_csv =
                MenuItem::with_id(app, "export_csv", "Lists (CSV)", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Quit sigpath", true, Some("CmdOrCtrl+Q"))?;

            // Edit
            let undo_item = MenuItem::with_id(app, "undo", "Undo", true, Some("CmdOrCtrl+Z"))?;
            let redo_item =
                MenuItem::with_id(app, "redo", "Redo", true, Some("CmdOrCtrl+Shift+Z"))?;

            // Insert
            let insert_device =
                MenuItem::with_id(app, "insert_device", "Device…", true, Some("CmdOrCtrl+D"))?;
            let insert_zone = MenuItem::with_id(app, "insert_zone", "Zone", true, None::<&str>)?;
            let insert_note = MenuItem::with_id(app, "insert_note", "Note", true, None::<&str>)?;

            // View
            let fit_view = MenuItem::with_id(app, "fit_view", "Fit View", true, Some("CmdOrCtrl+0"))?;
            let zoom_zone =
                MenuItem::with_id(app, "zoom_zone", "Zoom to Selected Zone", true, None::<&str>)?;
            let theme_system =
                MenuItem::with_id(app, "theme_system", "Match System", true, None::<&str>)?;
            let theme_light = MenuItem::with_id(app, "theme_light", "Light", true, None::<&str>)?;
            let theme_dark = MenuItem::with_id(app, "theme_dark", "Dark", true, None::<&str>)?;

            // Arrange
            let arrange_item = MenuItem::with_id(
                app,
                "arrange",
                "Auto-Arrange Left → Right",
                true,
                Some("CmdOrCtrl+Shift+L"),
            )?;

            let app_menu = SubmenuBuilder::new(app, "sigpath")
                .about(None)
                .separator()
                .hide()
                .hide_others()
                .show_all()
                .separator()
                .item(&quit_item)
                .build()?;
            let export_menu = SubmenuBuilder::new(app, "Export")
                .item(&export_png)
                .item(&export_jpeg)
                .item(&export_pdf)
                .separator()
                .item(&export_csv)
                .build()?;
            let file_menu = SubmenuBuilder::new(app, "File")
                .item(&new_item)
                .item(&open_item)
                .separator()
                .item(&save_item)
                .item(&save_as_item)
                .separator()
                .item(&export_menu)
                .separator()
                .close_window()
                .build()?;
            // Undo/Redo now drive the canvas history (the frontend handles them); the
            // predefined cut/copy/paste/select-all still serve focused text inputs.
            let edit_menu = SubmenuBuilder::new(app, "Edit")
                .item(&undo_item)
                .item(&redo_item)
                .separator()
                .cut()
                .copy()
                .paste()
                .select_all()
                .build()?;
            let theme_menu = SubmenuBuilder::new(app, "Theme")
                .item(&theme_system)
                .item(&theme_light)
                .item(&theme_dark)
                .build()?;
            let view_menu = SubmenuBuilder::new(app, "View")
                .item(&theme_menu)
                .separator()
                .item(&fit_view)
                .item(&zoom_zone)
                .build()?;
            let insert_menu = SubmenuBuilder::new(app, "Insert")
                .item(&insert_device)
                .separator()
                .item(&insert_zone)
                .item(&insert_note)
                .build()?;
            let arrange_menu = SubmenuBuilder::new(app, "Arrange").item(&arrange_item).build()?;
            let window_menu = SubmenuBuilder::new(app, "Window").minimize().build()?;

            let menu = MenuBuilder::new(app)
                .item(&app_menu)
                .item(&file_menu)
                .item(&edit_menu)
                .item(&view_menu)
                .item(&insert_menu)
                .item(&arrange_menu)
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
