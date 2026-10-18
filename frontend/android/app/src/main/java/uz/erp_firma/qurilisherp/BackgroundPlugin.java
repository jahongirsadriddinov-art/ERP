package uz.erp_firma.qurilisherp;

import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

// JS → orqa fon xizmati (BackgroundService) boshqaruvi.
@CapacitorPlugin(name = "Background")
public class BackgroundPlugin extends Plugin {
    @PluginMethod
    public void start(PluginCall call) {
        String token = call.getString("token");
        String api = call.getString("apiBase", BackgroundService.ALLOWED_API);
        if (token == null || token.isEmpty()) { call.reject("token kerak"); return; }
        if (api == null || !api.startsWith(BackgroundService.ALLOWED_API)) { call.reject("API ruxsat etilmagan"); return; }
        int interval = call.getInt("intervalSec", 60);
        boolean track = Boolean.TRUE.equals(call.getBoolean("trackLocation", false));
        try {
            BackgroundService.start(getContext(), token, api, interval, track);
            call.resolve();
        } catch (Exception e) {
            call.reject(e.getMessage());
        }
    }

    @PluginMethod
    public void stop(PluginCall call) {
        BackgroundService.stop(getContext());
        call.resolve();
    }

    // Fonda ishlash ruxsati (owner 2026-10-19: "Telegram kabi orqa fonda ishlasin"): batareya tejash
    // cheklovidan chiqarish — aks holda tizim ilovani fonda uxlatib, qo'ng'iroq/bildirishnoma kelmaydi.
    @PluginMethod
    public void batteryStatus(PluginCall call) {
        JSObject r = new JSObject();
        boolean ignoring = true;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            PowerManager pm = (PowerManager) getContext().getSystemService(Context.POWER_SERVICE);
            ignoring = pm != null && pm.isIgnoringBatteryOptimizations(getContext().getPackageName());
        }
        r.put("ignoring", ignoring);
        r.put("manufacturer", Build.MANUFACTURER == null ? "" : Build.MANUFACTURER.toLowerCase());
        call.resolve(r);
    }

    @PluginMethod
    public void requestBatteryExemption(PluginCall call) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                Intent i = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
                i.setData(Uri.parse("package:" + getContext().getPackageName()));
                i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(i);
            }
            call.resolve();
        } catch (Exception e) {
            // Ba'zi qurilmalarda bu oyna yo'q — umumiy ro'yxatni ochamiz
            try {
                Intent i = new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS);
                i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(i);
                call.resolve();
            } catch (Exception e2) { call.reject(e2.getMessage()); }
        }
    }

    /** Ilova sozlamalari (Xiaomi/Huawei va h.k.: "Avtomatik ishga tushirish", "Fonda ishlash"). */
    @PluginMethod
    public void openAppSettings(PluginCall call) {
        try {
            Intent i = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
            i.setData(Uri.parse("package:" + getContext().getPackageName()));
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(i);
            call.resolve();
        } catch (Exception e) { call.reject(e.getMessage()); }
    }

    @PluginMethod
    public void status(PluginCall call) {
        JSObject r = new JSObject();
        r.put("running", BackgroundService.running);
        call.resolve(r);
    }
}
