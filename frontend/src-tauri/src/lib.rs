use std::io::{Read, Write};
use tauri::{Emitter, Manager};
use tauri_plugin_http::reqwest;

#[tauri::command]
fn greet(name: &str) -> String {
    format!("QurilishERP: {}", name)
}


fn update_path() -> std::path::PathBuf {
    std::env::temp_dir().join("QurilishERP-update.exe")
}

// Ilova ichidan yangilash (1-bosqich): o'rnatuvchini (NSIS .exe) o'zimizning backend'dan ORQA FONDA
// yuklab oladi. Ilova ishlashda davom etadi; tayyor bo'lgach frontend "O'rnatish va qayta ishga
// tushirish / Keyinroq" deb so'raydi.
#[tauri::command]
async fn download_update(app: tauri::AppHandle, url: String) -> Result<(), String> {
    // Faqat o'zimizning backend'dan (HTTPS) — boshqa manzildan fayl yuklab ishga tushirmaydi.
    const ALLOWED: &str = "https://qurilisherp-backend.onrender.com/uploads/";
    if !url.starts_with(ALLOWED) {
        return Err("URL ruxsat etilmagan".into());
    }
    let mut resp = reqwest::get(&url).await.map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status()));
    }
    let total = resp.content_length().unwrap_or(0);
    let path = update_path();
    let mut file = std::fs::File::create(&path).map_err(|e| e.to_string())?;
    let mut downloaded: u64 = 0;
    let mut last_emit: u64 = 0;
    while let Some(chunk) = resp.chunk().await.map_err(|e| e.to_string())? {
        file.write_all(&chunk).map_err(|e| e.to_string())?;
        downloaded += chunk.len() as u64;
        if downloaded - last_emit > 256 * 1024 {
            last_emit = downloaded;
            let _ = app.emit("update-progress", serde_json::json!({ "downloaded": downloaded, "total": total }));
        }
    }
    drop(file);
    let mut head = [0u8; 2];
    std::fs::File::open(&path).and_then(|mut f| f.read_exact(&mut head)).map_err(|e| e.to_string())?;
    if downloaded < 1_000_000 || &head != b"MZ" {
        let _ = std::fs::remove_file(&path);
        return Err("Yuklangan fayl noto'g'ri".into());
    }
    let _ = app.emit("update-progress", serde_json::json!({ "downloaded": downloaded, "total": downloaded }));
    Ok(())
}

// 2-bosqich: yuklangan o'rnatuvchini "passive" rejimda (faqat progress oynasi) ishga tushiradi va
// ilovadan chiqadi — o'rnatuvchi tugagach yangi versiyani o'zi ochadi (/UPDATE).
#[tauri::command]
fn install_update(app: tauri::AppHandle) -> Result<(), String> {
    let path = update_path();
    if !path.exists() {
        return Err("Yangilanish fayli topilmadi".into());
    }
    std::process::Command::new(&path)
        .args(["/P", "/UPDATE"])
        .spawn()
        .map_err(|e| e.to_string())?;
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

pub fn run() {
    tauri::Builder::default()
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
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![greet, download_update, install_update, save_to_downloads, reveal_file, open_external])
        .run(tauri::generate_context!())
        .expect("QurilishERP ishga tushmadi");
}
