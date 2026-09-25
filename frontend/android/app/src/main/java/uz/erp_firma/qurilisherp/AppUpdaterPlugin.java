package uz.erp_firma.qurilisherp;

import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

// Ilova ichidan yangilash: APK'ni o'zimizning backend'dan yuklab olib, Android
// o'rnatuvchisini ochadi (foydalanuvchi bitta "O'rnatish" tugmasini bosadi —
// Android buni sukut ostida qilishga ruxsat bermaydi).
@CapacitorPlugin(name = "AppUpdater")
public class AppUpdaterPlugin extends Plugin {
    // Faqat o'zimizning backend'dan — boshqa manzildan APK yuklab o'rnatishga yo'l yo'q.
    private static final String ALLOWED_PREFIX = "https://qurilisherp-backend.onrender.com/uploads/";
    private static final long MIN_APK_BYTES = 1_000_000L;

    private File apkFile() {
        File dir = new File(getContext().getCacheDir(), "updates");
        if (!dir.exists()) dir.mkdirs();
        return new File(dir, "update.apk");
    }

    @PluginMethod
    public void download(final PluginCall call) {
        final String url = call.getString("url");
        if (url == null || !url.startsWith(ALLOWED_PREFIX)) {
            call.reject("URL ruxsat etilmagan");
            return;
        }
        new Thread(() -> {
            HttpURLConnection conn = null;
            try {
                conn = (HttpURLConnection) new URL(url).openConnection();
                conn.setConnectTimeout(20000);
                conn.setReadTimeout(30000);
                conn.setInstanceFollowRedirects(true);
                if (conn.getResponseCode() != 200) {
                    call.reject("HTTP " + conn.getResponseCode());
                    return;
                }
                long total = conn.getContentLengthLong();
                File out = apkFile();
                long downloaded = 0, lastNotified = 0;
                try (InputStream in = conn.getInputStream(); FileOutputStream fos = new FileOutputStream(out)) {
                    byte[] buf = new byte[64 * 1024];
                    int n;
                    while ((n = in.read(buf)) > 0) {
                        fos.write(buf, 0, n);
                        downloaded += n;
                        if (downloaded - lastNotified > 256 * 1024) {
                            lastNotified = downloaded;
                            JSObject d = new JSObject();
                            d.put("downloaded", downloaded);
                            d.put("total", total);
                            notifyListeners("progress", d);
                        }
                    }
                }
                if (downloaded < MIN_APK_BYTES || !looksLikeZip(out)) {
                    out.delete();
                    call.reject("Yuklangan fayl noto'g'ri");
                    return;
                }
                JSObject d = new JSObject();
                d.put("downloaded", downloaded);
                d.put("total", total > 0 ? total : downloaded);
                notifyListeners("progress", d);
                call.resolve();
            } catch (Exception e) {
                call.reject(e.getMessage() != null ? e.getMessage() : "Yuklab bo'lmadi");
            } finally {
                if (conn != null) conn.disconnect();
            }
        }).start();
    }

    private boolean looksLikeZip(File f) {
        try (FileInputStream in = new FileInputStream(f)) {
            return in.read() == 'P' && in.read() == 'K';
        } catch (Exception e) {
            return false;
        }
    }

    @PluginMethod
    public void install(PluginCall call) {
        File f = apkFile();
        if (!f.exists()) {
            call.reject("Fayl topilmadi");
            return;
        }
        // Android 8+: "noma'lum manbalardan o'rnatish" ruxsati ilova uchun berilgan bo'lishi shart.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !getContext().getPackageManager().canRequestPackageInstalls()) {
            Intent s = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + getContext().getPackageName()));
            s.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(s);
            call.reject("PERMISSION");
            return;
        }
        try {
            Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", f);
            Intent i = new Intent(Intent.ACTION_VIEW);
            i.setDataAndType(uri, "application/vnd.android.package-archive");
            i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(i);
            call.resolve();
        } catch (Exception e) {
            call.reject(e.getMessage() != null ? e.getMessage() : "O'rnatuvchi ochilmadi");
        }
    }
}
