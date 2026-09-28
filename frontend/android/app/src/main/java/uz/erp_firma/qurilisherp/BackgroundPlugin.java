package uz.erp_firma.qurilisherp;

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

    @PluginMethod
    public void status(PluginCall call) {
        JSObject r = new JSObject();
        r.put("running", BackgroundService.running);
        call.resolve(r);
    }
}
