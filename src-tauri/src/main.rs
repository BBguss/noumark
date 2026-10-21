#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fs;
use std::path::{Component, Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;

use notify::{EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::{Deserialize, Serialize};
use tauri::utils::config::{Color, WindowConfig};
use tauri::webview::PageLoadEvent;
use tauri::{AppHandle, Emitter, Manager, State, WebviewWindow, Window, WindowEvent};

const MD_EXT: [&str; 4] = ["md", "markdown", "mdown", "mkd"];
const SKIP_DIRS: [&str; 8] = [
    "node_modules",
    "target",
    "dist",
    "build",
    "vendor",
    "__pycache__",
    "venv",
    "bin",
];
const MAX_FILES: usize = 3000;
const MAX_DEPTH: usize = 6;

#[derive(Default)]
struct AppState {
    /// Files to open that arrived before the frontend was listening:
    /// (frontend ready, queued paths).
    pending: Mutex<(bool, Vec<String>)>,
    watcher: Mutex<Option<RecommendedWatcher>>,
    /// Background colour of the active theme, reported by the frontend and
    /// persisted so the next launch paints the window in the right colour.
    background: Mutex<[u8; 3]>,
}

/// Logical (DPI-independent) window geometry.
#[derive(Serialize, Deserialize, Default)]
struct WinState {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    maximized: bool,
    #[serde(default)]
    background: Option<[u8; 3]>,
}

#[derive(Serialize)]
struct Entry {
    path: String,
    rel: String,
}

fn is_markdown(p: &Path) -> bool {
    p.extension()
        .and_then(|e| e.to_str())
        .map(|e| MD_EXT.contains(&e.to_ascii_lowercase().as_str()))
        .unwrap_or(false)
}

/// Lexically resolves `.` and `..` without touching the filesystem
/// (canonicalize would add the `\\?\` prefix on Windows).
fn normalize(p: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for c in p.components() {
        match c {
            Component::ParentDir => {
                out.pop();
            }
            Component::CurDir => {}
            other => out.push(other.as_os_str()),
        }
    }
    out
}

fn file_from_args<I: IntoIterator<Item = String>>(args: I, cwd: &Path) -> Option<String> {
    args.into_iter()
        .skip(1)
        .filter(|a| !a.starts_with("--"))
        .find_map(|a| {
            let p = PathBuf::from(&a);
            let p = normalize(&if p.is_absolute() { p } else { cwd.join(p) });
            p.is_file().then(|| p.to_string_lossy().into_owned())
        })
}

fn hex(b: u8) -> Option<u8> {
    match b {
        b'0'..=b'9' => Some(b - b'0'),
        b'a'..=b'f' => Some(b - b'a' + 10),
        b'A'..=b'F' => Some(b - b'A' + 10),
        _ => None,
    }
}

fn percent_decode(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' && i + 2 < b.len() {
            if let (Some(h), Some(l)) = (hex(b[i + 1]), hex(b[i + 2])) {
                out.push(h * 16 + l);
                i += 3;
                continue;
            }
        }
        out.push(b[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn walk(root: &Path, dir: &Path, depth: usize, out: &mut Vec<Entry>) {
    if depth > MAX_DEPTH || out.len() >= MAX_FILES {
        return;
    }
    let Ok(rd) = fs::read_dir(dir) else { return };
    for e in rd.flatten() {
        let p = e.path();
        let name = e.file_name().to_string_lossy().into_owned();
        if name.starts_with('.') {
            continue;
        }
        let Ok(ft) = e.file_type() else { continue };
        if ft.is_dir() {
            if !SKIP_DIRS.contains(&name.to_ascii_lowercase().as_str()) {
                walk(root, &p, depth + 1, out);
            }
        } else if is_markdown(&p) {
            let rel = p
                .strip_prefix(root)
                .unwrap_or(&p)
                .to_string_lossy()
                .replace('\\', "/");
            out.push(Entry {
                path: p.to_string_lossy().into_owned(),
                rel,
            });
        }
    }
}

/// Same location Tauri uses for `app_config_dir` on Windows, but available
/// before the app is built so the window can be created at its saved size.
fn win_state_file(identifier: &str) -> Option<PathBuf> {
    std::env::var_os("APPDATA").map(|d| PathBuf::from(d).join(identifier).join("window.json"))
}

fn read_win_state(file: &Path) -> Option<WinState> {
    serde_json::from_str(&fs::read_to_string(file).ok()?).ok()
}

fn apply_win_state(cfg: &mut WindowConfig, st: &WinState) {
    if st.width >= 300.0 && st.height >= 200.0 {
        cfg.width = st.width;
        cfg.height = st.height;
        cfg.x = Some(st.x);
        cfg.y = Some(st.y);
        cfg.center = false;
    }
    cfg.maximized = st.maximized;
}

/// A saved position can point at a monitor that is no longer connected.
fn ensure_on_screen(win: &WebviewWindow) {
    let Ok(pos) = win.outer_position() else {
        return;
    };
    // The title bar area just right of the window's top-left must be reachable.
    let (gx, gy) = (pos.x + 120, pos.y + 20);
    let reachable = win
        .available_monitors()
        .unwrap_or_default()
        .iter()
        .any(|m| {
            let (p, s) = (m.position(), m.size());
            gx >= p.x && gy >= p.y && gx < p.x + s.width as i32 && gy < p.y + s.height as i32
        });
    if !reachable {
        let _ = win.center();
    }
    // Never leave the window larger than its monitor (e.g. after a resolution change).
    if let (Ok(Some(m)), Ok(size)) = (win.current_monitor(), win.outer_size()) {
        if size.width > m.size().width || size.height > m.size().height {
            let _ = win.maximize();
        }
    }
}

fn save_window(win: &Window) {
    let Some(file) = win_state_file(&win.app_handle().config().identifier) else {
        return;
    };
    if win.is_minimized().unwrap_or(false) {
        return;
    }
    let mut st = read_win_state(&file).unwrap_or_default();
    st.maximized = win.is_maximized().unwrap_or(false);
    if !st.maximized {
        let scale = win.scale_factor().unwrap_or(1.0);
        if let (Ok(size), Ok(pos)) = (win.inner_size(), win.outer_position()) {
            let size = size.to_logical::<f64>(scale);
            let pos = pos.to_logical::<f64>(scale);
            st = WinState {
                x: pos.x,
                y: pos.y,
                width: size.width,
                height: size.height,
                ..st
            };
        }
    }
    st.background = Some(*win.state::<AppState>().background.lock().unwrap());
    if let Some(dir) = file.parent() {
        let _ = fs::create_dir_all(dir);
    }
    if let Ok(json) = serde_json::to_string(&st) {
        let _ = fs::write(file, json);
    }
}

/// Called once by the frontend after its listeners are registered: returns any
/// queued paths and switches to emitting "open-file" events directly.
#[tauri::command]
fn take_pending(state: State<AppState>) -> Vec<String> {
    let mut p = state.pending.lock().unwrap();
    p.0 = true;
    std::mem::take(&mut p.1)
}

/// Parses `#rrggbb`.
fn parse_hex_color(s: &str) -> Option<[u8; 3]> {
    let h = s.strip_prefix('#')?;
    if h.len() != 6 || !h.is_ascii() {
        return None;
    }
    let c = |i: usize| u8::from_str_radix(&h[i..i + 2], 16).ok();
    Some([c(0)?, c(2)?, c(4)?])
}

#[tauri::command]
fn set_background(state: State<AppState>, color: String) -> Result<(), String> {
    let rgb = parse_hex_color(&color).ok_or("expected a #rrggbb colour")?;
    *state.background.lock().unwrap() = rgb;
    Ok(())
}

// File-system commands are async so they run on a worker thread instead of
// blocking the main (window) thread.
#[tauri::command]
async fn read_file(path: String) -> Result<String, String> {
    let bytes = fs::read(&path).map_err(|e| e.to_string())?;
    let text = String::from_utf8_lossy(&bytes);
    Ok(text.strip_prefix('\u{feff}').unwrap_or(&text).to_string())
}

#[tauri::command]
async fn write_file(path: String, content: String) -> Result<(), String> {
    fs::write(&path, content).map_err(|e| e.to_string())
}

/// Watches the parent directory (not the file) so atomic-rename saves from
/// other editors and tools are still picked up.
#[tauri::command]
fn watch_file(app: AppHandle, state: State<AppState>, path: String) -> Result<(), String> {
    let target = PathBuf::from(&path);
    let dir = target
        .parent()
        .ok_or("file has no parent directory")?
        .to_path_buf();
    let name = target.file_name().map(|n| n.to_ascii_lowercase());
    let emit_path = path.clone();
    let mut watcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
        let Ok(ev) = res else { return };
        if !matches!(ev.kind, EventKind::Modify(_) | EventKind::Create(_)) {
            return;
        }
        if ev
            .paths
            .iter()
            .any(|p| p.file_name().map(|n| n.to_ascii_lowercase()) == name)
        {
            let _ = app.emit("file-changed", &emit_path);
        }
    })
    .map_err(|e| e.to_string())?;
    watcher
        .watch(&dir, RecursiveMode::NonRecursive)
        .map_err(|e| e.to_string())?;
    *state.watcher.lock().unwrap() = Some(watcher);
    Ok(())
}

/// The nearest ancestor containing `.git` (up to 5 levels), else the file's folder.
#[tauri::command]
async fn workspace_root(path: String) -> String {
    let p = Path::new(&path);
    let dir = p.parent().unwrap_or(p);
    dir.ancestors()
        .take(5)
        .find(|a| a.join(".git").exists())
        .unwrap_or(dir)
        .to_string_lossy()
        .into_owned()
}

#[tauri::command]
async fn list_markdown(root: String) -> Vec<Entry> {
    let root = PathBuf::from(root);
    let mut out = Vec::new();
    walk(&root, &root, 0, &mut out);
    out
}

#[tauri::command]
async fn resolve_link(from: String, href: String) -> Option<String> {
    let decoded = percent_decode(&href).replace('/', std::path::MAIN_SEPARATOR_STR);
    let base = Path::new(&from).parent()?;
    let p = normalize(&base.join(decoded));
    if p.exists() {
        return Some(p.to_string_lossy().into_owned());
    }
    // Wiki-style links without an extension: [[setup]] -> setup.md
    let with_ext = p.with_extension("md");
    with_ext
        .exists()
        .then(|| with_ext.to_string_lossy().into_owned())
}

#[tauri::command]
fn open_external(target: String) -> Result<(), String> {
    let lower = target.to_ascii_lowercase();
    let allowed = ["http://", "https://", "mailto:", "ms-settings:"]
        .iter()
        .any(|s| lower.starts_with(s))
        || Path::new(&target).exists();
    if !allowed {
        return Err("refused to open this target".into());
    }
    std::process::Command::new("explorer")
        .arg(&target)
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn reveal(path: String) -> Result<(), String> {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        std::process::Command::new("explorer")
            .raw_arg(format!("/select,\"{}\"", path))
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(not(windows))]
    let _ = path;
    Ok(())
}

fn main() {
    let cwd = std::env::current_dir().unwrap_or_default();
    let initial = file_from_args(std::env::args(), &cwd);

    // Configure the window before it exists: saved geometry, and a background
    // in the theme colour so there is no white frame before the page paints.
    let mut context = tauri::generate_context!();
    let identifier = context.config().identifier.clone();
    let saved = win_state_file(&identifier).and_then(|f| read_win_state(&f));
    let background = saved
        .as_ref()
        .and_then(|s| s.background)
        .unwrap_or([18, 18, 21]);
    if let Some(cfg) = context.config_mut().app.windows.get_mut(0) {
        let [r, g, b] = background;
        cfg.background_color = Some(Color(r, g, b, 255));
        if let Some(st) = &saved {
            apply_win_state(cfg, st);
        }
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
            if let Some(p) = file_from_args(args, Path::new(&cwd)) {
                let state = app.state::<AppState>();
                let mut pending = state.pending.lock().unwrap();
                if pending.0 {
                    let _ = app.emit("open-file", p);
                } else {
                    pending.1.push(p);
                }
            }
            // The window may not exist yet if we are still starting up; the
            // queued path is picked up by the frontend once it is ready.
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.show();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState {
            pending: Mutex::new((false, initial.into_iter().collect())),
            background: Mutex::new(background),
            ..Default::default()
        })
        .setup(|app| {
            let win = app.get_webview_window("main").expect("main window");
            ensure_on_screen(&win);
            // Last-resort: never stay invisible, whatever happens in the page.
            std::thread::spawn(move || {
                std::thread::sleep(Duration::from_secs(6));
                if !win.is_visible().unwrap_or(true) {
                    let _ = win.show();
                    let _ = win.set_focus();
                }
            });
            Ok(())
        })
        // Show as soon as WebView2 has loaded the page; this does not depend
        // on the frontend's startup code succeeding.
        .on_page_load(|webview, payload| {
            if payload.event() == PageLoadEvent::Finished {
                let win = webview.window();
                let _ = win.show();
                let _ = win.set_focus();
            }
        })
        .on_window_event(|w, e| match e {
            WindowEvent::CloseRequested { .. } => save_window(w),
            WindowEvent::Destroyed if w.label() == "main" => w.app_handle().exit(0),
            _ => {}
        })
        .invoke_handler(tauri::generate_handler![
            take_pending,
            set_background,
            read_file,
            write_file,
            watch_file,
            workspace_root,
            list_markdown,
            resolve_link,
            open_external,
            reveal
        ])
        .run(context)
        .expect("error while running Noumark");
}
