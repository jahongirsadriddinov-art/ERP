package uz.erp_firma.qurilisherp;

import android.content.Context;
import android.widget.RemoteViews;
import org.json.JSONObject;

// To'liq widget (4x2) — bugungi chiqim, davomat va uchta tezkor tugma.
// Umumiy mantiq ErpWidgetBase'da; bu yerda faqat shu ko'rinishning o'zi.
//
// Sinf nomi ATAYLAB o'zgartirilmadi: bosh ekranga allaqachon qo'yilgan
// widgetlar provider nomiga bog'langan, nom o'zgarsa ular yo'qolib ketardi.
public class ErpWidgetProvider extends ErpWidgetBase {

    @Override
    protected int layoutId() { return R.layout.erp_widget; }

    @Override
    protected void paint(Context ctx, RemoteViews v, JSONObject data, boolean signedIn, String company) {
        v.setTextViewText(R.id.w_company, company);

        if (!signedIn) {
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
                // Birlik ("so'm") raqamning O'ZIDA — owner 2026-11-02: valyuta
                // ko'rsatilmagani uchun so'mmi yoki dollarmi bilib bo'lmasdi.
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
    }
}
