use std::io::{Read, Write};
use tauri::{Emitter, Manager};
use tauri_plugin_http::reqwest;

#[tauri::command]
fn greet(name: &str) -> String {
    format!("QurilishERP: {}", name)
}


// Yuklangan o'rnatuvchining yo'li (har yuklashda yangi nom — eski fayl antivirus/o'rnatuvchi tomonidan
// band bo'lib qolgan bo'lsa ham yozish xatosi bermaydi).
static UPDATE_FILE: std::sync::Mutex<Option<std::path::PathBuf>> = std::sync::Mutex::new(None);

fn new_update_path() -> std::path::PathBuf {
    let dir = std::env::temp_dir();
    // Eski yuklamalarni tozalash (band bo'lsa — jim o'tkazib yuboriladi)
    if let Ok(entries) = std::fs::read_dir(&dir) {
        for e in entries.flatten() {
            let name = e.file_name().to_string_lossy().to_string();
            if name.starts_with("QurilishERP-update") && name.ends_with(".exe") {
                let _ = std::fs::remove_file(e.path());
            }
        }
    }
    let ts = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0);
    dir.join(format!("QurilishERP-update-{}.exe", ts))
}

async fn try_download(app: &tauri::AppHandle, url: &str) -> Result<std::path::PathBuf, String> {
    let client = reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(30))
        .timeout(std::time::Duration::from_secs(15 * 60))
        .build()
        .map_err(|e| e.to_string())?;
    let mut resp = client.get(url).send().await.map_err(|e| format!("Tarmoq: {}", e))?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status()));
    }
    let total = resp.content_length().unwrap_or(0);
    let path = new_update_path();
    let mut file = std::fs::File::create(&path).map_err(|e| format!("Fayl: {}", e))?;
    let mut downloaded: u64 = 0;
    let mut last_emit: u64 = 0;
    while let Some(chunk) = resp.chunk().await.map_err(|e| format!("Tarmoq: {}", e))? {
        file.write_all(&chunk).map_err(|e| format!("Fayl: {}", e))?;
        downloaded += chunk.len() as u64;
        if downloaded - last_emit > 256 * 1024 {
            last_emit = downloaded;
            let _ = app.emit("update-progress", serde_json::json!({ "downloaded": downloaded, "total": total }));
        }
    }
    file.flush().map_err(|e| format!("Fayl: {}", e))?;
    drop(file);
    let mut head = [0u8; 2];
    std::fs::File::open(&path).and_then(|mut f| f.read_exact(&mut head)).map_err(|e| format!("Fayl: {}", e))?;
    if downloaded < 1_000_000 || &head != b"MZ" || (total > 0 && downloaded != total) {
        let _ = std::fs::remove_file(&path);
        return Err("Yuklangan fayl to'liq emas".into());
    }
    let _ = app.emit("update-progress", serde_json::json!({ "downloaded": downloaded, "total": downloaded }));
    Ok(path)
}

// Ilova ichidan yangilash (1-bosqich): o'rnatuvchini (NSIS .exe) o'zimizning backend'dan ORQA FONDA
// yuklab oladi. Server qayta ishga tushayotgan (deploy) paytga to'g'ri kelsa — 4 marta qayta uriniladi.
#[tauri::command]
async fn download_update(app: tauri::AppHandle, url: String) -> Result<(), String> {
    // Faqat o'zimizning backend'dan (HTTPS) — boshqa manzildan fayl yuklab ishga tushirmaydi.
    const ALLOWED: &str = "https://qurilisherp-backend.onrender.com/uploads/";
    if !url.starts_with(ALLOWED) {
        return Err("URL ruxsat etilmagan".into());
    }
    let mut last_err = String::new();
    for attempt in 0..4u64 {
        if attempt > 0 {
            let wait = std::time::Duration::from_secs(5 * attempt);
            let _ = tauri::async_runtime::spawn_blocking(move || std::thread::sleep(wait)).await;
        }
        match try_download(&app, &url).await {
            Ok(path) => {
                *UPDATE_FILE.lock().unwrap() = Some(path);
                return Ok(());
            }
            Err(e) => last_err = e,
        }
    }
    Err(last_err)
}

// 2-bosqich: yuklangan o'rnatuvchini "passive" rejimda (faqat progress oynasi) ishga tushiradi va
// ilovadan chiqadi — o'rnatuvchi tugagach yangi versiyani o'zi ochadi (/UPDATE).
#[tauri::command]
fn install_update(app: tauri::AppHandle) -> Result<(), String> {
    let path = UPDATE_FILE.lock().unwrap().clone().ok_or("Yangilanish fayli topilmadi")?;
    if !path.exists() {
        return Err("Yangilanish fayli topilmadi".into());
    }
    let direct = std::process::Command::new(&path).args(["/P", "/UPDATE"]).spawn();
    if let Err(e) = direct {
        // Masalan, administrator ruxsati (UAC) kerak bo'lsa (os error 740) — ShellExecute orqali
        // ishga tushiramiz, Windows o'zi ruxsat so'raydi.
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x0800_0000;
            std::process::Command::new("cmd")
                .args(["/C", "start", "", &path.to_string_lossy(), "/P", "/UPDATE"])
                .creation_flags(CREATE_NO_WINDOW)
                .spawn()
                .map_err(|e2| format!("{} / {}", e, e2))?;
        }
        #[cfg(not(windows))]
        return Err(e.to_string());
    }
    app.exit(0);
    Ok(())
}

// Fayl yuklab olish (Excel/CSV, backup, QR, rasm...). WebView2'da <a download> ishlamaydi —
// fayl to'g'ridan-to'g'ri foydalanuvchining "Yuklanmalar" (Downloads) papkasiga yoziladi.
// Nom tozalanadi (papka ajratgichlari/maxsus belgilar) — boshqa joyga yozib bo'lmaydi.
#[tauri::command]
fn save_to_downloads(app: tauri::AppHandle, filename: String, data_b64: String) -> Result<String, String> {
    use base64::Engine;
    let bytes = base64::engine::general_purpose::STANDARD.decode(data_b64.as_bytes()).map_err(|e| e.to_string())?;
    let dir = app.path().download_dir().map_err(|e| e.to_string())?;
    let mut safe: String = filename.chars()
        .map(|c| if r#"<>:"/\|?*"#.contains(c) || c.is_control() { '_' } else { c })
        .collect::<String>().trim().trim_matches('.').to_string();
    if safe.is_empty() { safe = "fayl".into(); }
    let (stem, ext) = match safe.rfind('.') {
        Some(i) if i > 0 => (safe[..i].to_string(), safe[i..].to_string()),
        _ => (safe.clone(), String::new()),
    };
    let mut path = dir.join(&safe);
    let mut n = 1;
    while path.exists() {
        path = dir.join(format!("{} ({}){}", stem, n, ext));
        n += 1;
    }
    std::fs::write(&path, bytes).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().into_owned())
}

// Saqlangan faylni Explorer'da ko'rsatish ("Ochish" tugmasi)
#[tauri::command]
fn reveal_file(app: tauri::AppHandle, path: String) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    let dir = app.path().download_dir().map_err(|e| e.to_string())?;
    let p = std::path::PathBuf::from(&path);
    if !p.starts_with(&dir) { return Err("Ruxsat etilmagan yo'l".into()); }
    app.opener().reveal_item_in_dir(p).map_err(|e| e.to_string())
}

// Tashqi havola (chatdagi fayl, sayt, xarita) — tizim brauzerida ochiladi; faqat http(s)
#[tauri::command]
fn open_external(app: tauri::AppHandle, url: String) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    if !(url.starts_with("https://") || url.starts_with("http://")) { return Err("Ruxsat etilmagan havola".into()); }
    app.opener().open_url(url, None::<&str>).map_err(|e| e.to_string())
}

fn show_main(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

pub fn run() {
    tauri::Builder::default()
        // Ilova allaqachon (tepsida) ishlayotgan bo'lsa — ikkinchi nusxa ochilmaydi, mavjud oyna ko'rsatiladi
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| show_main(app)))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_http::init())
        .setup(|app| {
            // Asosiy oyna oldingi holatini tiklash (o'lchov, pozitsiya)
            let window = app.get_webview_window("main").unwrap();
            window.show().unwrap();

            // Orqa fonda ishlash: oyna yopilsa ilova to'xtamaydi — tizim tepsisida (soat yonida) qoladi,
            // bildirishnomalar va joylashuv ishlashda davom etadi. To'liq chiqish — tepsidagi "Chiqish".
            use tauri::menu::{Menu, MenuItem};
            use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
            let open_i = MenuItem::with_id(app, "open", "Ochish", true, None::<&str>)?;
            let quit_i = MenuItem::with_id(app, "quit", "Chiqish", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open_i, &quit_i])?;
            let mut tray = TrayIconBuilder::with_id("main-tray")
                .tooltip("QurilishERP — orqa fonda ishlayapti")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "open" => show_main(app),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                        show_main(tray.app_handle());
                    }
                });
            if let Some(icon) = app.default_window_icon() { tray = tray.icon(icon.clone()); }
            tray.build(app)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![greet, download_update, install_update, save_to_downloads, reveal_file, open_external])
        .run(tauri::generate_context!())
        .expect("QurilishERP ishga tushmadi");
}
