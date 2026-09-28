package uz.erp_firma.qurilisherp;

import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.OutputStream;

// Fayl yuklab olish (Excel/CSV, backup, QR, rasm...) — Android WebView'da <a download> ishlamaydi.
// Fayl telefonning umumiy "Download/QurilishERP" papkasiga yoziladi (Android 10+ — hech qanday
// ruxsat so'ralmaydi, MediaStore orqali) va "Ochish" orqali mos ilovada ochiladi.
@CapacitorPlugin(name = "FileSaver")
public class FileSaverPlugin extends Plugin {

    @PluginMethod
    public void saveToDownloads(PluginCall call) {
        String name = call.getString("name", "fayl");
        String data = call.getString("data");
        String mime = call.getString("mime", "application/octet-stream");
        if (data == null) { call.reject("Ma'lumot yo'q"); return; }
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) { call.reject("OLD_ANDROID"); return; }
        // Nomdagi papka ajratgichlari/maxsus belgilar tozalanadi
        String safe = name.replaceAll("[\\\\/:*?\"<>|\\p{Cntrl}]", "_").trim();
        if (safe.isEmpty()) safe = "fayl";
        try {
            byte[] bytes = Base64.decode(data, Base64.DEFAULT);
            ContentResolver resolver = getContext().getContentResolver();
            ContentValues cv = new ContentValues();
            cv.put(MediaStore.MediaColumns.DISPLAY_NAME, safe);
            cv.put(MediaStore.MediaColumns.MIME_TYPE, mime);
            cv.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/QurilishERP");
            Uri uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, cv);
            if (uri == null) { call.reject("Saqlab bo'lmadi"); return; }
            try (OutputStream out = resolver.openOutputStream(uri)) {
                if (out == null) { call.reject("Saqlab bo'lmadi"); return; }
                out.write(bytes);
            }
            JSObject r = new JSObject();
            r.put("uri", uri.toString());
            r.put("path", "Download/QurilishERP/" + safe);
            call.resolve(r);
        } catch (Exception e) {
            call.reject(e.getMessage() != null ? e.getMessage() : "Saqlab bo'lmadi");
        }
    }

    @PluginMethod
    public void openFile(PluginCall call) {
        String uri = call.getString("uri");
        String mime = call.getString("mime", "*/*");
        // Faqat biz saqlagan MediaStore fayllari ochiladi
        if (uri == null || !uri.startsWith("content://media/")) { call.reject("Ruxsat etilmagan"); return; }
        try {
            Intent i = new Intent(Intent.ACTION_VIEW);
            i.setDataAndType(Uri.parse(uri), mime);
            i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(Intent.createChooser(i, null).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
            call.resolve();
        } catch (Exception e) {
            call.reject(e.getMessage() != null ? e.getMessage() : "Ochib bo'lmadi");
        }
    }
}
