use std::io::{Read, Write};
use tauri::{Emitter, Manager};
use tauri_plugin_http::reqwest;

#[tauri::command]
fn greet(name: &str) -> String {
    format!("QurilishERP: {}", name)
}


// Ilova ichidan yangilash: o'rnatuvchini (NSIS .exe) o'zimizning backend'dan yuklab olib,
// "passive" rejimda (faqat progress oynasi, hech narsa so'ramaydi) ishga tushiradi va
// ilovadan chiqadi — o'rnatuvchi tugagach yangi versiyani o'zi ochadi (/UPDATE).
#[tauri::command]
async fn download_and_install_update(app: tauri::AppHandle, url: String) -> Result<(), String> {
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
    let path = std::env::temp_dir().join("QurilishERP-update.exe");
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
    std::process::Command::new(&path)
        .args(["/P", "/UPDATE"])
        .spawn()
        .map_err(|e| e.to_string())?;
    app.exit(0);
    Ok(())
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
        .invoke_handler(tauri::generate_handler![greet, download_and_install_update])
        .run(tauri::generate_context!())
        .expect("QurilishERP ishga tushmadi");
}
