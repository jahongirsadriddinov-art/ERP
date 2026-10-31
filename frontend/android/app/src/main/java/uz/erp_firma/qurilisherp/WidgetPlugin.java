package uz.erp_firma.qurilisherp;

import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

// Veb ilova bilan bosh ekrandagi widget orasidagi ko'prik (owner 2026-10-31).
//
// Widget alohida jarayonda ishlaydi va WebView'dagi localStorage'ga KIRA OLMAYDI.
// Shuning uchun ilova kirgandan keyin kirish tokenini va server manzilini shu
// yerga beradi; widget esa ularni SharedPreferences'dan o'qiydi.
//
// XAVFSIZLIK: token ilovaning O'Z shaxsiy fayliga yoziladi (MODE_PRIVATE) —
// boshqa ilovalar o'qiy olmaydi. Chiqishda clear() chaqiriladi va widget
// darhol "kirilmagan" holatga tushadi.
@CapacitorPlugin(name = "ErpWidget")
public class WidgetPlugin extends Plugin {

    public static final String PREFS = "erp_widget";
    public static final String KEY_TOKEN = "token";
    public static final String KEY_BASE = "apiBase";
    public static final String KEY_NAME = "company";

    private SharedPreferences prefs() {
        return getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    /** Kirgandan keyin chaqiriladi: token + server manzili. */
    @PluginMethod
    public void setAuth(PluginCall call) {
        String token = call.getString("token");
        String base = call.getString("apiBase");
        String company = call.getString("company", "");
        if (token == null || base == null) { call.reject("token va apiBase kerak"); return; }
        prefs().edit().putString(KEY_TOKEN, token).putString(KEY_BASE, base).putString(KEY_NAME, company).apply();
        refresh();
        call.resolve();
    }

    /** Chiqishda — widget ham "kirilmagan" holatga tushadi. */
    @PluginMethod
    public void clear(PluginCall call) {
        prefs().edit().clear().apply();
        refresh();
        call.resolve();
    }

    /** Ma'lumot o'zgargan bo'lsa widgetni darhol yangilash (masalan chiqim qo'shilgach). */
    @PluginMethod
    public void refreshNow(PluginCall call) {
        refresh();
        call.resolve();
    }

    private void refresh() {
        Context ctx = getContext();
        Intent intent = new Intent(ctx, ErpWidgetProvider.class);
        intent.setAction(AppWidgetManager.ACTION_APPWIDGET_UPDATE);
        int[] ids = AppWidgetManager.getInstance(ctx)
                .getAppWidgetIds(new ComponentName(ctx, ErpWidgetProvider.class));
        intent.putExtra(AppWidgetManager.EXTRA_APPWIDGET_IDS, ids);
        ctx.sendBroadcast(intent);
    }
}
