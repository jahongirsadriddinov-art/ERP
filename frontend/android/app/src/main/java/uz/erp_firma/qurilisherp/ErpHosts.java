package uz.erp_firma.qurilisherp;

import android.net.Uri;

/**
 * Ilova ishonadigan O'Z manzillarimiz — bitta joyda.
 *
 * NIMA UCHUN KERAK (2026-10-31):
 *   1) Manzil ko'chdi, ro'yxat qolib ketdi. Avval har plaginda alohida
 *      `"https://qurilisherp-backend.onrender.com..."` qotirib yozilgan edi.
 *      Backend Railway'ga, sayt esa Cloudflare'ga (erp-firma.uz) ko'chgach:
 *        • AppUpdaterPlugin — APK havolasi (`https://erp-firma.uz/files/...`)
 *          "ruxsat etilmagan" bo'lib, ANDROID ILOVADA YANGILANISH BUTUNLAY
 *          ISHLAMAY QOLGAN edi (owner shikoyati: "apk da auto update ishlamaydi");
 *        • BackgroundPlugin — `start()` darhol rad etilib, orqa fon xizmati
 *          (bildirishnoma va GPS) hech qachon ishga tushmay qolgan edi.
 *   2) `url.startsWith(prefix)` tekshiruvi XAVFSIZ EMAS: satr prefiksi
 *      domen chegarasini bilmaydi, shuning uchun
 *      `https://qurilisherp-backend.onrender.com.evil.com/uploads/x.apk`
 *      eski tekshiruvdan O'TIB KETARDI (ya'ni begona serverdan APK
 *      o'rnatish mumkin edi). Endi HOST ANIQ solishtiriladi va faqat
 *      https qabul qilinadi.
 *
 * Manzil yana ko'chsa — faqat shu ro'yxat o'zgartiriladi.
 */
final class ErpHosts {
    private ErpHosts() {}

    /** O'z domenlarimiz (host aniq solishtiriladi, prefiks EMAS). */
    private static final String[] HOSTS = {
            "erp-firma.uz",
            "www.erp-firma.uz",
            // Provayder asosiy nomni to'sib qo'ysa ishlatiladigan zaxira nom
            "cf.erp-firma.uz",
            // Backend to'g'ridan-to'g'ri (Worker orqali emas)
            "erpfirma-backend.up.railway.app",
            // Eski manzil — allaqachon o'rnatilgan ilovalar uchun orqaga moslik
            "qurilisherp-backend.onrender.com",
    };

    /** HTTPS va bizning hostlarimizdan birimi. */
    static boolean isOurs(String url) {
        if (url == null || url.isEmpty()) return false;
        final Uri u;
        try { u = Uri.parse(url); } catch (Exception e) { return false; }
        if (!"https".equalsIgnoreCase(u.getScheme())) return false;
        final String host = u.getHost();
        if (host == null) return false;
        for (String h : HOSTS) if (h.equalsIgnoreCase(host)) return true;
        return false;
    }

    /**
     * APK yuklab olish uchun havola: o'z hostimiz VA ruxsat etilgan yo'l
     * ({@code /files/...} — Cloudflare ko'prigi, {@code /uploads/...} — eski
     * bevosita backend yo'li). So'rov qismi (`?v=...`) ahamiyatsiz.
     */
    static boolean isApkUrl(String url) {
        if (!isOurs(url)) return false;
        final String path = Uri.parse(url).getPath();
        if (path == null) return false;
        return path.startsWith("/files/") || path.startsWith("/uploads/");
    }
}
