package uz.erp_firma.qurilisherp;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Build;
import android.widget.RemoteViews;
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONObject;

/**
 * Bosh ekrandagi BARCHA widgetlar uchun umumiy asos (owner 2026-11-02:
 * "widgetlarni ko'paytir iloji boricha").
 *
 * Ilgari bitta widget bor edi va butun mantiq (tarmoq, pul formati, tugmalar)
 * o'sha sinf ichida yozilgan edi. Endi widget bir nechta — shuning uchun
 * takrorlanadigan hammasi shu yerga olindi, har bir widget esa faqat O'Z
 * ko'rinishini chizadi.
 *
 * TARMOQ: Android widget'da asosiy oqimda tarmoqqa chiqib bo'lmaydi, shuning
 * uchun so'rov alohida oqimda ketadi. Bosh ekranda bir nechta widget tursa,
 * har biri alohida so'rov yuborsa — trafik va batareya behuda ketardi.
 * Shuning uchun javob SharedPreferences'ga qisqa muddatga saqlanadi va
 * yangi so'rov faqat eskirganda yuboriladi (server javobi ham 60 s keshlanadi).
 */
public abstract class ErpWidgetBase extends AppWidgetProvider {

    private static final ExecutorService POOL = Executors.newSingleThreadExecutor();

    /** Widget tugmasi qaysi sahifani ochishini ilovaga shu kalit bilan aytamiz. */
    public static final String EXTRA_ROUTE = "erp_widget_route";

    private static final String KEY_CACHE = "summaryJson";
    private static final String KEY_CACHE_AT = "summaryAt";
    /** Kesh muddati — server javobi ham shuncha vaqt keshlanadi. */
    private static final long CACHE_MS = 60_000L;

    /** Shu widgetning ko'rinish fayli. */
    protected abstract int layoutId();

    /** Ma'lumot tayyor bo'lganda shu widget o'zini chizadi. */
    protected abstract void paint(Context ctx, RemoteViews v, JSONObject data, boolean signedIn, String company);

    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] ids) {
        // 1) darhol — keshdagi (yoki bo'sh) holat bilan, ekran bo'sh qolmasin
        JSONObject cached = readCache(context);
        for (int id : ids) render(context, manager, id, cached);
        // 2) keyin — kerak bo'lsa yangisini olib, qayta chizamiz
        if (cached != null) return;
        POOL.execute(() -> {
            JSONObject data = fetch(context);
            if (data == null) return;
            AppWidgetManager m = AppWidgetManager.getInstance(context);
            int[] live = m.getAppWidgetIds(new ComponentName(context, getClass()));
            for (int id : live) render(context, m, id, data);
        });
    }

    private void render(Context ctx, AppWidgetManager manager, int id, JSONObject data) {
        RemoteViews v = new RemoteViews(ctx.getPackageName(), layoutId());
        SharedPreferences p = ctx.getSharedPreferences(WidgetPlugin.PREFS, Context.MODE_PRIVATE);
        boolean signedIn = p.getString(WidgetPlugin.KEY_TOKEN, null) != null;
        String company = p.getString(WidgetPlugin.KEY_NAME, "");
        if (company == null || company.isEmpty()) company = "QurilishERP";
        paint(ctx, v, data, signedIn, company);
        manager.updateAppWidget(id, v);
    }

    /** Tugma bosilganda ilovani ochadi va qaysi bo'lim kerakligini uzatadi. */
    protected PendingIntent open(Context ctx, String route, int code) {
        Intent i = new Intent(ctx, MainActivity.class);
        i.setAction(Intent.ACTION_VIEW);
        i.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        i.putExtra(EXTRA_ROUTE, route);
        // Har bir tugma uchun alohida data — aks holda Android PendingIntent'larni
        // bir xil deb hisoblab, hammasini bitta qilib yuboradi.
        i.setData(Uri.parse("erpwidget://" + getClass().getSimpleName() + "/" + route));
        int flags = PendingIntent.FLAG_UPDATE_CURRENT
                | (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0);
        return PendingIntent.getActivity(ctx, (getClass().getSimpleName() + route).hashCode() + code, i, flags);
    }

    // ─── Pul ko'rinishi ──────────────────────────────────────────────────────
    // OWNER SHIKOYATI (2026-11-02): "summa dollorda kiritilgani so'mdami bilib
    // bo'lmadi". Widget shunchaki "10 000" deb yozardi — birlik umuman yo'q edi.
    // Serverda chiqim HAR DOIM so'mda saqlanadi (Transaction.amount; dollarda
    // kiritilgani originalAmount/currency'da alohida turadi va widgetga
    // kelmaydi), shuning uchun bu yerdagi raqam HAMISHA so'm. Endi birlik
    // ANIQ yozib qo'yiladi — hech qanday taxmin qolmaydi.

    /** "28 870 000 so'm" — to'liq, guruhlangan. */
    protected static String money(long v) {
        return group(v) + " so'm";
    }

    /** Tor widget uchun qisqa: "28,9 mln so'm", "870 ming so'm". */
    protected static String moneyShort(long v) {
        long a = Math.abs(v);
        if (a >= 1_000_000_000L) return trim(v / 1_000_000_000d) + " mlrd so'm";
        if (a >= 1_000_000L) return trim(v / 1_000_000d) + " mln so'm";
        if (a >= 100_000L) return group(Math.round(v / 1000d)) + " ming so'm";
        return group(v) + " so'm";
    }

    private static String trim(double d) {
        String s = String.format(new java.util.Locale("uz", "UZ"), "%.1f", d);
        return s.endsWith(",0") || s.endsWith(".0") ? s.substring(0, s.length() - 2) : s;
    }

    /** 28870000 -> "28 870 000". Lokalga tayanmaydi (qurilmaga qarab vergul/nuqta chiqib qolmasin). */
    private static String group(long v) {
        String digits = Long.toString(Math.abs(v));
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < digits.length(); i++) {
            if (i > 0 && (digits.length() - i) % 3 == 0) sb.append(' '); // ingichka bo'linmas probel
            sb.append(digits.charAt(i));
        }
        return (v < 0 ? "-" : "") + sb;
    }

    // ─── Server bilan ────────────────────────────────────────────────────────

    private static JSONObject readCache(Context ctx) {
        SharedPreferences p = ctx.getSharedPreferences(WidgetPlugin.PREFS, Context.MODE_PRIVATE);
        String raw = p.getString(KEY_CACHE, null);
        if (raw == null) return null;
        if (System.currentTimeMillis() - p.getLong(KEY_CACHE_AT, 0L) > CACHE_MS) return null;
        try { return new JSONObject(raw); } catch (Exception e) { return null; }
    }

    /** Serverdan ixcham xulosa. Xato bo'lsa null — chaqiruvchi o'zi hal qiladi. */
    protected static JSONObject fetch(Context ctx) {
        SharedPreferences p = ctx.getSharedPreferences(WidgetPlugin.PREFS, Context.MODE_PRIVATE);
        String token = p.getString(WidgetPlugin.KEY_TOKEN, null);
        String base = p.getString(WidgetPlugin.KEY_BASE, null);
        if (token == null || base == null) return null;
        HttpURLConnection c = null;
        try {
            URL url = new URL(base.replaceAll("/+$", "") + "/api/widget/summary");
            c = (HttpURLConnection) url.openConnection();
            c.setRequestMethod("GET");
            c.setRequestProperty("Authorization", "Bearer " + token);
            c.setRequestProperty("Accept", "application/json");
            c.setConnectTimeout(8000);
            c.setReadTimeout(8000);
            if (c.getResponseCode() != 200) return null;
            StringBuilder sb = new StringBuilder();
            try (BufferedReader r = new BufferedReader(new InputStreamReader(c.getInputStream(), "UTF-8"))) {
                String line;
                while ((line = r.readLine()) != null) sb.append(line);
            }
            String body = sb.toString();
            p.edit().putString(KEY_CACHE, body).putLong(KEY_CACHE_AT, System.currentTimeMillis()).apply();
            return new JSONObject(body);
        } catch (Exception e) {
            return null;    // tarmoq yo'q / token eskirgan — widget "yangilanmoqda" deb turadi
        } finally {
            if (c != null) c.disconnect();
        }
    }
}
