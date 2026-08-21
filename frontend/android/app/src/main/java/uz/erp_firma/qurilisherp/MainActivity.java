package uz.erp_firma.qurilisherp;

import android.Manifest;
import android.content.pm.PackageManager;
import android.os.Bundle;
import android.webkit.PermissionRequest;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebChromeClient;
import java.util.ArrayList;
import java.util.List;

// MUHIM: AndroidManifest.xml'da CAMERA/RECORD_AUDIO ruxsatlari e'lon
// qilingan bo'lsa ham, ba'zi qurilma/Android versiyalarida (yoki avval,
// bu ruxsatlar manifestga qo'shilishidan OLDINGI eski o'rnatishda bir marta
// "rad etilgan" holat saqlanib qolgan bo'lsa) veb sahifadagi getUserMedia()
// (kamera/QR-skaner/qo'ng'iroq/ovozli xabar) hech qanday native ruxsat
// dialogisiz to'g'ridan-to'g'ri "ruxsat yo'q" xatosi bilan qaytishi mumkin.
// Standart Capacitor Bridge buni odatda o'zi to'g'ri boshqaradi, lekin bu
// yerda ANIQ, o'zimiz nazorat qiladigan variant bilan mustahkamlaymiz —
// BridgeWebChromeClient'ni (fayl tanlash kabi boshqa hamma narsa ishlab
// turishi uchun to'liq ALMASHTIRISH o'rniga UNI KENGAYTIRIB) faqat
// onPermissionRequest'ni qayta belgilaymiz: Android runtime ruxsati hali
// berilmagan bo'lsa — chinakam tizim dialogini so'raymiz, keyin natijaga
// qarab WebView so'rovini granted/denied qilamiz.
public class MainActivity extends BridgeActivity {
    private static final int MEDIA_PERMISSION_REQUEST_CODE = 9001;
    private PermissionRequest pendingWebRequest;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        this.bridge.getWebView().setWebChromeClient(new BridgeWebChromeClient(this.bridge) {
            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                runOnUiThread(() -> {
                    List<String> androidPerms = new ArrayList<>();
                    for (String resource : request.getResources()) {
                        if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(resource)) {
                            androidPerms.add(Manifest.permission.CAMERA);
                        } else if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(resource)) {
                            androidPerms.add(Manifest.permission.RECORD_AUDIO);
                        }
                    }
                    if (androidPerms.isEmpty()) {
                        // Kamera/mikrofon bilan bog'liq bo'lmagan so'rov (masalan
                        // MIDI) — asosiy Capacitor mantig'iga qoldiramiz.
                        super.onPermissionRequest(request);
                        return;
                    }
                    List<String> toRequest = new ArrayList<>();
                    for (String p : androidPerms) {
                        if (ContextCompat.checkSelfPermission(MainActivity.this, p) != PackageManager.PERMISSION_GRANTED) {
                            toRequest.add(p);
                        }
                    }
                    if (toRequest.isEmpty()) {
                        request.grant(request.getResources());
                        return;
                    }
                    pendingWebRequest = request;
                    ActivityCompat.requestPermissions(MainActivity.this, toRequest.toArray(new String[0]), MEDIA_PERMISSION_REQUEST_CODE);
                });
            }

            @Override
            public void onPermissionRequestCanceled(PermissionRequest request) {
                super.onPermissionRequestCanceled(request);
                pendingWebRequest = null;
            }
        });
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == MEDIA_PERMISSION_REQUEST_CODE && pendingWebRequest != null) {
            boolean granted = grantResults.length > 0;
            for (int r : grantResults) {
                if (r != PackageManager.PERMISSION_GRANTED) { granted = false; break; }
            }
            if (granted) pendingWebRequest.grant(pendingWebRequest.getResources());
            else pendingWebRequest.deny();
            pendingWebRequest = null;
        }
    }
}
