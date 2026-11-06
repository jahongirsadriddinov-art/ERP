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

// Windows'da NSIS o'rnatuvchi (.exe), macOS'da disk tasviri (.dmg) yuklanadi —
// qaysi platformada qurilayotganiga qarab kengaytma tanlanadi (bitta kod
// bazasi ikkala desktop OS uchun ham ishlaydi).
fn update_file_ext() -> &'static str {
    if cfg!(target_os = "macos") { "dmg" } else { "exe" }
}

fn new_update_path() -> std::path::PathBuf {
    let dir = std::env::temp_dir();
    let ext = update_file_ext();
    let suffix = format!(".{}", ext);
    // Eski yuklamalarni tozalash (band bo'lsa — jim o'tkazib yuboriladi)
    if let Ok(entries) = std::fs::read_dir(&dir) {
        for e in entries.flatten() {
            let name = e.file_name().to_string_lossy().to_string();
            if name.starts_with("QurilishERP-update") && name.ends_with(&suffix) {
                let _ = std::fs::remove_file(e.path());
            }
        }
    }
    let ts = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0);
    dir.join(format!("QurilishERP-update-{}.{}", ts, ext))
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
    // NSIS o'rnatuvchi (Windows) "MZ" bilan boshlanadi — .dmg (macOS) boshqa
    // formatda (UDIF), shu sabab header tekshiruvi faqat Windows'da qattiq.
    let mut head = [0u8; 2];
    std::fs::File::open(&path).and_then(|mut f| f.read_exact(&mut head)).map_err(|e| format!("Fayl: {}", e))?;
    let header_ok = cfg!(target_os = "macos") || &head == b"MZ";
    if downloaded < 1_000_000 || !header_ok || (total > 0 && downloaded != total) {
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
    // Faqat O'ZIMIZNING manzillardan (HTTPS) — boshqa joydan fayl yuklab ishga tushirmaydi.
    // 2026-10-28: server Render'dan ko'chgach yangilanish havolasi erp-firma.uz/files/...
    // bo'ldi, ro'yxatda esa faqat eski Render manzili qolgani uchun ilova ichidagi
    // yangilash "URL ruxsat etilmagan" deb to'xtab qolgandi.
    // 2026-10-31: zaxira nom (cf.erp-firma.uz) ham qo'shildi — provayder asosiy
    // nomni to'sib qo'yganda sayt o'sha nomdan ochiladi va yangilanish havolasi
    // ham shu nomga tushadi (Android tomoni: ErpHosts.java).
    const ALLOWED: [&str; 4] = [
        "https://erp-firma.uz/files/",
        "https://www.erp-firma.uz/files/",
        "https://cf.erp-firma.uz/files/",
        "https://erpfirma-backend.up.railway.app/uploads/",
    ];
    if !ALLOWED.iter().any(|p| url.starts_with(p)) {
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

// 2-bosqich: yuklangan o'rnatuvchini ishga tushiradi va ilovadan chiqadi.
// Windows (.exe, NSIS) — "passive" rejimda o'rnatadi, tugagach ilovani o'zi qayta ochadi.
// macOS (.dmg) — owner tanlovi (2026-11-0x, AskUserQuestion: "to'liq avtomatik"): diskni
// o'zi ulaydi, .app'ni topib /Applications'ga (eskisini almashtirib) ko'chiradi, diskni
// ajratadi va yangi versiyani o'zi ochadi — foydalanuvchi hech narsa qo'lda qilmaydi.
#[tauri::command]
fn install_update(app: tauri::AppHandle) -> Result<(), String> {
    let path = UPDATE_FILE.lock().unwrap().clone().ok_or("Yangilanish fayli topilmadi")?;
    if !path.exists() {
        return Err("Yangilanish fayli topilmadi".into());
    }
    #[cfg(target_os = "macos")]
    {
        install_update_macos(&path)?;
        app.exit(0);
        return Ok(());
    }
    #[cfg(windows)]
    {
        install_update_windows(&path)?;
        app.exit(0);
        return Ok(());
    }
    #[cfg(not(any(target_os = "macos", windows)))]
    {
        let _ = &app;
        Err("Bu platformada avtomatik o'rnatish qo'llab-quvvatlanmaydi".into())
    }
}

#[cfg(windows)]
fn install_update_windows(path: &std::path::Path) -> Result<(), String> {
    // /R — o'rnatish tugagach ilova avtomatik qayta ochiladi (owner 2026-10-19; Tauri NSIS: passive rejimda ishlaydi)
    let direct = std::process::Command::new(path).args(["/P", "/UPDATE", "/R"]).spawn();
    if let Err(e) = direct {
        // Masalan, administrator ruxsati (UAC) kerak bo'lsa (os error 740) — ShellExecute orqali
        // ishga tushiramiz, Windows o'zi ruxsat so'raydi.
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        std::process::Command::new("cmd")
            .args(["/C", "start", "", &path.to_string_lossy(), "/P", "/UPDATE", "/R"])
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
            .map_err(|e2| format!("{} / {}", e, e2))?;
    }
    Ok(())
}

#[cfg(target_os = "macos")]
fn install_update_macos(dmg_path: &std::path::Path) -> Result<(), String> {
    use std::process::Command;

    // 1) Diskni UI ko'rsatmasdan ulaymiz (-nobrowse: Finder oynasi ochilmaydi, -noautoopen: ichidagi
    // o'rnatuvchi oynasi avtomatik ochilmaydi — biz o'zimiz boshqaramiz).
    let attach = Command::new("hdiutil")
        .args(["attach", "-nobrowse", "-noautoopen", &dmg_path.to_string_lossy()])
        .output()
        .map_err(|e| format!("hdiutil attach: {}", e))?;
    if !attach.status.success() {
        return Err(format!("Disk ulanmadi: {}", String::from_utf8_lossy(&attach.stderr)));
    }
    let attach_out = String::from_utf8_lossy(&attach.stdout);
    let mount_point = attach_out
        .lines()
        .find_map(|line| line.find("/Volumes/").map(|i| line[i..].trim().to_string()))
        .ok_or("Ulangan diskning joylashuvi topilmadi")?;

    // Tozalash yordamchisi — xatolik bo'lsa ham diskni "band" qilib qoldirmaslik uchun ajratamiz.
    let detach = |mp: &str| { let _ = Command::new("hdiutil").args(["detach", mp, "-quiet"]).status(); };

    // 2) Ulangan disk ichidan .app bog'lamini topamiz.
    let app_name = match std::fs::read_dir(&mount_point) {
        Ok(entries) => entries.flatten().find_map(|e| {
            let name = e.file_name().to_string_lossy().to_string();
            if name.ends_with(".app") { Some(name) } else { None }
        }),
        Err(e) => { detach(&mount_point); return Err(format!("Disk o'qilmadi: {}", e)); }
    };
    let app_name = match app_name {
        Some(n) => n,
        None => { detach(&mount_point); return Err("Diskdan .app topilmadi".into()); }
    };
    let source = std::path::Path::new(&mount_point).join(&app_name);
    let target = std::path::Path::new("/Applications").join(&app_name);

    // 3) Eski nusxani almashtiramiz: avval eskisini o'chiramiz, so'ng yangisini ko'chiramiz
    // (`ditto` — macOS'ning .app bog'lamlarini metama'lumoti bilan birga to'g'ri nusxalaydigan rasmiy vositasi).
    if target.exists() {
        if let Err(e) = std::fs::remove_dir_all(&target) {
            detach(&mount_point);
            return Err(format!("Eski versiyani o'chirib bo'lmadi (ruxsat kerak bo'lishi mumkin): {}", e));
        }
    }
    let copy = Command::new("ditto").args([&source, &target]).status();
    detach(&mount_point);
    match copy {
        Ok(s) if s.success() => {}
        Ok(s) => return Err(format!("Nusxalash muvaffaqiyatsiz (kod {:?})", s.code())),
        Err(e) => return Err(format!("Nusxalash: {}", e)),
    }

    // 4) Yangi versiyani ochamiz — chaqiruvchi (install_update) shundan keyin joriy jarayonni yopadi.
    // Owner 2026-11-06: "yangilash ishladi lekin qaytib kirmadi" — sabab: shu nuqtada ESKI jarayon
    // hali butunlay o'chmagan, bitta bundle ID uchun "open" shu ID allaqachon ishga tushgan bo'lsa
    // YANGI nusxa o'rniga o'sha ESKI (hozir o'chayotgan) jarayonni oldinga chiqaradi — keyin u
    // zudlik bilan exit(0) bilan yopiladi, natijada hech narsa ochiq qolmaydi. "-n" ESKI jarayon
    // holatidan qat'iy nazar har doim YANGI nusxadan jarayon boshlashga majburlaydi.
    Command::new("open").args(["-n", &target.to_string_lossy()]).spawn().map_err(|e| format!("Yangi versiya ochilmadi: {}", e))?;
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
