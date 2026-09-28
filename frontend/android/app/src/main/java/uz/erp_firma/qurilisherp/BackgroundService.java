package uz.erp_firma.qurilisherp;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.os.BatteryManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.IBinder;
import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;
import java.util.TimeZone;
import org.json.JSONArray;
import org.json.JSONObject;

// ─── Orqa fonda ishlash (ilova yopilgan / boshqa ilovaga o'tilgan bo'lsa ham) ─────────────────
// Foreground service (doimiy kichik bildirishnoma bilan — Android talabi):
//  • joylashuv (GPS) — ishchi/prorab/brigadir uchun kuzatuv yoqilgan bo'lsa, serverga yuboriladi;
//  • yangi bildirishnomalar — har daqiqada serverdan tekshiriladi va telefon bildirishnomasi sifatida
//    ko'rsatiladi (ilova ochiq bo'lsa ko'rsatilmaydi — u yerda sayt o'zi ko'rsatadi).
// Tizimdan chiqilsa (401) xizmat o'zini to'xtatadi.
public class BackgroundService extends Service implements LocationListener {
    static final String PREFS = "erp_background";
    static final String CH_SERVICE = "erp_bg_service";
    static final String CH_NOTIF = "erp_notifications";
    static final int ONGOING_ID = 7001;
    static final String ALLOWED_API = "https://qurilisherp-backend.onrender.com";
    static volatile boolean running = false;

    private HandlerThread thread;
    private Handler handler;
    private LocationManager lm;
    private long lastLocSent = 0;
    private final Runnable poller = new Runnable() {
        @Override public void run() {
            pollNotifications();
            if (handler != null) handler.postDelayed(this, 60_000);
        }
    };

    public static void start(Context ctx, String token, String api, int intervalSec, boolean track) {
        ctx.getSharedPreferences(PREFS, MODE_PRIVATE).edit()
            .putString("token", token).putString("api", api)
            .putInt("interval", Math.max(20, Math.min(600, intervalSec)))
            .putBoolean("track", track).putBoolean("enabled", true).apply();
        Intent i = new Intent(ctx, BackgroundService.class);
        ContextCompat.startForegroundService(ctx, i);
    }

    public static void stop(Context ctx) {
        ctx.getSharedPreferences(PREFS, MODE_PRIVATE).edit().putBoolean("enabled", false).remove("token").apply();
        ctx.stopService(new Intent(ctx, BackgroundService.class));
    }

    private SharedPreferences prefs() { return getSharedPreferences(PREFS, MODE_PRIVATE); }

    @Override public void onCreate() {
        super.onCreate();
        NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && nm != null) {
            NotificationChannel s = new NotificationChannel(CH_SERVICE, "Orqa fonda ishlash", NotificationManager.IMPORTANCE_MIN);
            s.setShowBadge(false);
            nm.createNotificationChannel(s);
            NotificationChannel n = new NotificationChannel(CH_NOTIF, "Bildirishnomalar", NotificationManager.IMPORTANCE_HIGH);
            n.enableVibration(true);
            nm.createNotificationChannel(n);
        }
        thread = new HandlerThread("erp-background");
        thread.start();
        handler = new Handler(thread.getLooper());
    }

    private PendingIntent openAppIntent() {
        Intent i = new Intent(this, MainActivity.class);
        i.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        return PendingIntent.getActivity(this, 0, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private boolean hasLocationPermission() {
        return ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
            || ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED;
    }

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        SharedPreferences p = prefs();
        if (!p.getBoolean("enabled", false) || p.getString("token", null) == null) { stopSelf(); return START_NOT_STICKY; }
        boolean track = p.getBoolean("track", false) && hasLocationPermission();
        Notification ongoing = new NotificationCompat.Builder(this, CH_SERVICE)
            .setSmallIcon(getApplicationInfo().icon)
            .setContentTitle("QurilishERP")
            .setContentText(track ? "Orqa fonda ishlayapti · joylashuv yoqilgan" : "Orqa fonda ishlayapti · bildirishnomalar")
            .setOngoing(true).setPriority(NotificationCompat.PRIORITY_MIN)
            .setContentIntent(openAppIntent()).build();
        try {
            if (Build.VERSION.SDK_INT >= 34) {
                int type = track ? ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION : ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE;
                startForeground(ONGOING_ID, ongoing, type);
            } else {
                startForeground(ONGOING_ID, ongoing);
            }
        } catch (Exception e) {
            // Masalan, joylashuv ruxsati olib qo'yilgan — joylashuvsiz davom etamiz
            try {
                if (Build.VERSION.SDK_INT >= 34) startForeground(ONGOING_ID, ongoing, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
                else startForeground(ONGOING_ID, ongoing);
                track = false;
            } catch (Exception e2) { stopSelf(); return START_NOT_STICKY; }
        }
        running = true;
        stopLocation();
        if (track) startLocation(p.getInt("interval", 60));
        handler.removeCallbacks(poller);
        handler.postDelayed(poller, 5_000);
        return START_STICKY;
    }

    @SuppressWarnings("MissingPermission")
    private void startLocation(int intervalSec) {
        try {
            lm = (LocationManager) getSystemService(LOCATION_SERVICE);
            if (lm == null) return;
            long ms = intervalSec * 1000L;
            if (lm.isProviderEnabled(LocationManager.GPS_PROVIDER))
                lm.requestLocationUpdates(LocationManager.GPS_PROVIDER, ms, 15f, this, thread.getLooper());
            if (lm.isProviderEnabled(LocationManager.NETWORK_PROVIDER))
                lm.requestLocationUpdates(LocationManager.NETWORK_PROVIDER, ms, 15f, this, thread.getLooper());
        } catch (Exception ignored) { }
    }

    private void stopLocation() {
        try { if (lm != null) lm.removeUpdates(this); } catch (Exception ignored) { }
    }

    @Override public void onLocationChanged(Location loc) {
        long interval = prefs().getInt("interval", 60) * 1000L;
        long now = System.currentTimeMillis();
        if (now - lastLocSent < interval * 8 / 10) return;
        // Ilova ochiq bo'lsa — sayt o'zi yuboradi (takrorlanmasin)
        if (MainActivity.inForeground) return;
        lastLocSent = now;
        try {
            JSONObject o = new JSONObject();
            o.put("lat", loc.getLatitude());
            o.put("lng", loc.getLongitude());
            if (loc.hasAccuracy()) o.put("accuracy", loc.getAccuracy());
            if (loc.hasSpeed()) o.put("speed", loc.getSpeed());
            if (loc.hasBearing()) o.put("heading", loc.getBearing());
            if (loc.hasAltitude()) o.put("altitude", loc.getAltitude());
            Intent b = registerReceiver(null, new IntentFilter(Intent.ACTION_BATTERY_CHANGED));
            if (b != null) {
                int lvl = b.getIntExtra(BatteryManager.EXTRA_LEVEL, -1), sc = b.getIntExtra(BatteryManager.EXTRA_SCALE, -1);
                if (lvl >= 0 && sc > 0) o.put("battery", Math.round(lvl * 100f / sc));
                int st = b.getIntExtra(BatteryManager.EXTRA_STATUS, -1);
                o.put("charging", st == BatteryManager.BATTERY_STATUS_CHARGING || st == BatteryManager.BATTERY_STATUS_FULL);
            }
            SimpleDateFormat f = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US);
            f.setTimeZone(TimeZone.getTimeZone("UTC"));
            o.put("timestamp", f.format(new Date(loc.getTime() > 0 ? loc.getTime() : now)));
            http("POST", "/api/gps", o.toString());
        } catch (Exception ignored) { }
    }

    @Override public void onStatusChanged(String provider, int status, Bundle extras) { }
    @Override public void onProviderEnabled(String provider) { }
    @Override public void onProviderDisabled(String provider) { }

    private void pollNotifications() {
        try {
            String body = http("GET", "/api/notifications?unread=true&limit=10", null);
            if (body == null) return;
            JSONArray arr = new JSONObject(body).optJSONArray("notifications");
            if (arr == null) return;
            SharedPreferences p = prefs();
            Set<String> seen = new HashSet<>(p.getStringSet("seen", new HashSet<>()));
            boolean primed = p.getBoolean("primed", false);
            NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
            for (int i = arr.length() - 1; i >= 0; i--) {
                JSONObject n = arr.getJSONObject(i);
                String id = n.optString("_id");
                if (id.isEmpty() || seen.contains(id)) continue;
                seen.add(id);
                // Birinchi tekshiruvda eski o'qilmaganlar "yangi" deb ko'rsatilmaydi
                if (!primed || MainActivity.inForeground || nm == null) continue;
                Notification notif = new NotificationCompat.Builder(this, CH_NOTIF)
                    .setSmallIcon(getApplicationInfo().icon)
                    .setContentTitle(n.optString("title", "QurilishERP"))
                    .setContentText(n.optString("body", ""))
                    .setStyle(new NotificationCompat.BigTextStyle().bigText(n.optString("body", "")))
                    .setAutoCancel(true).setPriority(NotificationCompat.PRIORITY_HIGH)
                    .setContentIntent(openAppIntent()).build();
                nm.notify(id.hashCode(), notif);
            }
            if (seen.size() > 300) seen.clear();
            p.edit().putStringSet("seen", seen).putBoolean("primed", true).apply();
        } catch (Exception ignored) { }
    }

    /** Oddiy HTTP so'rov (token bilan). 401 — tizimdan chiqilgan: xizmat to'xtaydi. */
    private String http(String method, String path, String json) {
        SharedPreferences p = prefs();
        String token = p.getString("token", null), api = p.getString("api", ALLOWED_API);
        if (token == null || api == null || !api.startsWith(ALLOWED_API)) return null;
        HttpURLConnection c = null;
        try {
            c = (HttpURLConnection) new URL(api + path).openConnection();
            c.setRequestMethod(method);
            c.setConnectTimeout(20_000);
            c.setReadTimeout(30_000);
            c.setRequestProperty("Authorization", "Bearer " + token);
            if (json != null) {
                c.setDoOutput(true);
                c.setRequestProperty("Content-Type", "application/json");
                try (OutputStream os = c.getOutputStream()) { os.write(json.getBytes(StandardCharsets.UTF_8)); }
            }
            int code = c.getResponseCode();
            if (code == 401) { new Handler(getMainLooper()).post(() -> stop(this)); return null; }
            if (code < 200 || code >= 300) return null;
            try (InputStream in = c.getInputStream(); ByteArrayOutputStream bo = new ByteArrayOutputStream()) {
                byte[] buf = new byte[8192]; int n;
                while ((n = in.read(buf)) > 0) bo.write(buf, 0, n);
                return bo.toString("UTF-8");
            }
        } catch (Exception e) {
            return null;
        } finally {
            if (c != null) c.disconnect();
        }
    }

    @Override public void onDestroy() {
        running = false;
        stopLocation();
        if (handler != null) handler.removeCallbacksAndMessages(null);
        if (thread != null) thread.quitSafely();
        super.onDestroy();
    }

    @Override public IBinder onBind(Intent intent) { return null; }
}
