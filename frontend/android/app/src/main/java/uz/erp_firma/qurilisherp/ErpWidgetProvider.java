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
import java.text.NumberFormat;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONObject;

// Bosh ekrandagi widget (owner 2026-10-31: "ilovalarga widget chiqarish kerak").
//
// Ko'rsatadi: bugungi chiqim (faqat rahbarga — server o'zi hal qiladi), bugun
// kelganlar soni va tasdiq kutayotganlar. Pastda uchta tezkor tugma.
//
// TARMOQ: Android widget'da asosiy oqimda tarmoqqa chiqib bo'lmaydi, shuning
// uchun so'rov alohida oqimda ketadi va natija kelganda RemoteViews qayta
// chiziladi. Xato bo'lsa widget "ochib ko'ring" deb yozadi — hech qachon bo'sh
// yoki "xato" deb qotib qolmaydi.
//
// YANGILANISH: tizim o'zi ~30 daqiqada bir marta so'raydi (bundan tez-tez
// so'rash Android'da baribir mumkin emas), ustiga ilova ichidan WidgetPlugin
// orqali darhol yangilash mumkin.
public class ErpWidgetProvider extends AppWidgetProvider {

    private static final ExecutorService POOL = Executors.newSingleThreadExecutor();
    /** Widget tugmasi qaysi sahifani ochishini ilovaga shu kalit bilan aytamiz. */
    public static final String EXTRA_ROUTE = "erp_widget_route";

    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] ids) {
        for (int id : ids) render(context, manager, id, null);
        POOL.execute(() -> {
            JSONObject data = fetch(context);
            AppWidgetManager m = AppWidgetManager.getInstance(context);
            int[] live = m.getAppWidgetIds(new ComponentName(context, ErpWidgetProvider.class));
            for (int id : live) render(context, m, id, data);
        });
    }

    /** Tugma bosilganda ilovani ochadi va qaysi bo'lim kerakligini uzatadi. */
    private PendingIntent open(Context ctx, String route, int code) {
        Intent i = new Intent(ctx, MainActivity.class);
        i.setAction(Intent.ACTION_VIEW);
        i.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        i.putExtra(EXTRA_ROUTE, route);
        // Har bir tugma uchun alohida data — aks holda Android PendingIntent'larni
        // bir xil deb hisoblab, hammasini bitta qilib yuboradi.
        i.setData(Uri.parse("erpwidget://" + route));
        int flags = PendingIntent.FLAG_UPDATE_CURRENT
                | (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0);
        return PendingIntent.getActivity(ctx, code, i, flags);
    }

    private void render(Context ctx, AppWidgetManager manager, int id, JSONObject data) {
        RemoteViews v = new RemoteViews(ctx.getPackageName(), R.layout.erp_widget);
        SharedPreferences p = ctx.getSharedPreferences(WidgetPlugin.PREFS, Context.MODE_PRIVATE);
        String token = p.getString(WidgetPlugin.KEY_TOKEN, null);
        String company = p.getString(WidgetPlugin.KEY_NAME, "");

        v.setTextViewText(R.id.w_company, company == null || company.isEmpty() ? "QurilishERP" : company);

        if (token == null) {
            v.setTextViewText(R.id.w_main, "Kiring");
            v.setTextViewText(R.id.w_main_label, "ilovaga kirilmagan");
            v.setTextViewText(R.id.w_sub, "");
        } else if (data == null) {
            // Birinchi chizish yoki tarmoq yo'q — eski qiymat qolmasin, lekin
            // "xato" deb qo'rqitmaymiz ham
            v.setTextViewText(R.id.w_main, "—");
            v.setTextViewText(R.id.w_main_label, "yangilanmoqda");
            v.setTextViewText(R.id.w_sub, "");
        } else {
            boolean hasMoney = !data.isNull("todayExpense");
            if (hasMoney) {
                v.setTextViewText(R.id.w_main, money(data.optLong("todayExpense", 0)));
                v.setTextViewText(R.id.w_main_label, "bugungi chiqim");
            } else {
                v.setTextViewText(R.id.w_main, String.valueOf(data.optInt("attendance", 0)));
                v.setTextViewText(R.id.w_main_label, "bugun ishda");
            }
            int pending = data.optInt("pending", 0);
            String sub = "Bugun ishda: " + data.optInt("attendance", 0) + "/" + data.optInt("employees", 0);
            if (pending > 0) sub += "  ·  Tasdiq kutmoqda: " + pending;
            v.setTextViewText(R.id.w_sub, sub);
        }

        v.setOnClickPendingIntent(R.id.w_root, open(ctx, "dashboard", 1));
        v.setOnClickPendingIntent(R.id.w_btn_checkin, open(ctx, "attendance", 2));
        v.setOnClickPendingIntent(R.id.w_btn_expense, open(ctx, "finance", 3));
        v.setOnClickPendingIntent(R.id.w_btn_chat, open(ctx, "chat", 4));

        manager.updateAppWidget(id, v);
    }

    private static String money(long v) {
        // 28 870 000 ko'rinishida — widgetda o'qishga qulay
        NumberFormat f = NumberFormat.getInstance(new Locale("uz", "UZ"));
        f.setGroupingUsed(true);
        return f.format(v).replace(',', ' ').replace(' ', ' ');
    }

    /** Serverdan ixcham xulosa. Xato bo'lsa null — chaqiruvchi o'zi hal qiladi. */
    private static JSONObject fetch(Context ctx) {
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
            return new JSONObject(sb.toString());
        } catch (Exception e) {
            return null;    // tarmoq yo'q / token eskirgan — widget "yangilanmoqda" deb turadi
        } finally {
            if (c != null) c.disconnect();
        }
    }
}
