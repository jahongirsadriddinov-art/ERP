import { useEffect, useState } from "react";
import { MorphIcon } from "morphicons/react";
import AlertCircle from "@hugeicons/core-free-icons/AlertCircleIcon";
import Send from "@hugeicons/core-free-icons/SendIcon";
import Check from "@hugeicons/core-free-icons/Tick01Icon";
import ChevronDown from "@hugeicons/core-free-icons/ArrowDown01Icon";
import { API_BASE } from "./api";

// Obuna muddati tugaganda chiqadigan ekran (owner 2026-10-30).
//
// OLDIN: boshi berk ko'cha edi — "To'lovni yangilash uchun admin bilan
// bog'laning" va bitta Telegram havolasi. Foydalanuvchi adminni topishi,
// o'zini tanishtirishi, firma nomi va tarifini aytishi kerak edi.
//
// ENDI shu ekranning o'zida:
//   • tarifni tanlaydi (xohlasa BOSHQA tarifga o'tadi),
//   • onlayn to'laydi (Click/Payme/Paynet havolasi shu yerda ochiladi),
//   • yoki BITTA TUGMA bilan adminga so'rov yuboradi — firma, tarif va
//     bog'lanish ma'lumotlari bilan tayyor xabar o'zi ketadi.
//
// Token: kirish muvaffaqiyatli bo'lgan, faqat obuna tugagan. Server shu
// holatda to'lov uchun token beradi; u bilan FAQAT tarif va to'lov yo'llari
// ochiq (middleware/subscriptionGate), qolgan hamma narsa yopiq.

type Plan = { key: string; label: string; days: number; amount: number; period?: string; tier?: string };

export type BlockedInfo = {
  reason: "expired" | "rejected" | "pending";
  token?: string;
  selectedPlan?: string | null;
  periodEnd?: string | null;
  canPay?: boolean;
};

const fmt = (n: number) => n.toLocaleString("uz-UZ");

/**
 * Standart tanlov: eng QISQA muddatli (1 oylik) tariflar ichidan eng QIMMATI.
 * Owner qarori — odam hech narsa tanlamasa, to'liq imkoniyatli oylik tarif
 * tanlangan bo'lib tursin; uzoq muddatga bog'lab qo'ymaydi.
 */
export function defaultPlanKey(plans: Plan[]): string {
  if (!plans.length) return "";
  const minDays = Math.min(...plans.map((p) => p.days || 0).filter((d) => d > 0));
  const shortest = plans.filter((p) => p.days === minDays);
  const pool = shortest.length ? shortest : plans;
  return pool.reduce((best, p) => (p.amount > best.amount ? p : best), pool[0]).key;
}

export default function SubscriptionBlocked({ info, adminHandle, onBack }: {
  info: BlockedInfo; adminHandle: string; onBack: () => void;
}) {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [chosen, setChosen] = useState<string>(info.selectedPlan || "");
  const [busy, setBusy] = useState<"" | "pay" | "admin">("");
  // Owner 2026-10-30: "buni ochib-yopiladigan bo'lim qil — hohlasa o'zgartiradi,
  // hohlamasa o'zi default 1 oylik eng qimmat versiyasiga o'tadi".
  // Yopiq holatda ro'yxat ekranni to'ldirib, pastki tugmalarga yetib
  // bo'lmasdi; endi bitta qator ko'rinadi, ochish ixtiyoriy.
  const [open, setOpen] = useState(false);
  // Owner 2026-10-30: provayder sahifasida "Проверяем платёж…" da qotib qolardi
  // va usul tanlash menyusi ochilmasdi. Bizda har bir usulning TO'G'RIDAN-TO'G'RI
  // havolasi bor (order.providers) — shuning uchun usulni shu yerda tanlaymiz.
  const [providers, setProviders] = useState<{ code: string; name: string; url: string }[]>([]);
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    fetch(`${API_BASE}/api/plans`)
      .then((r) => (r.ok ? r.json() : []))
      .then((list: Plan[]) => {
        const payable = (Array.isArray(list) ? list : []).filter((p) => p.amount > 0);
        setPlans(payable);
        setChosen((c) => c || defaultPlanKey(payable));
      })
      .catch(() => setPlans([]));
  }, [info.selectedPlan]);

  // Token ikki yo'ldan keladi: kirish paytida server bergan to'lov tokeni,
  // yoki ilova ichida ishlab turib obuna tugasa (API 402) — allaqachon
  // saqlangan oddiy token. Ikkalasida ham faqat to'lov yo'llari ochiq.
  const token = info.token || (() => {
    try { return localStorage.getItem("token") || ""; } catch { return ""; }
  })();

  const call = async (path: string, body: Record<string, unknown>) => {
    const r = await fetch(`${API_BASE}/api/admin/subscriptions${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    });
    const d = await r.json().catch(() => ({}));
    return { ok: r.ok, status: r.status, d };
  };

  const payOnline = async () => {
    if (!chosen) return;
    setErr(""); setBusy("pay");
    try {
      const { ok, d } = await call("/pay", { selectedPlan: chosen, renew: true });
      if (!ok) { setErr(d?.error || "To'lov havolasini olib bo'lmadi"); return; }
      const list = Array.isArray(d?.providers) ? d.providers.filter((p: any) => p?.url) : [];
      // Usullar kelgan bo'lsa — shu yerda tanlanadi (bitta bosishda to'g'ri
      // ilovaga o'tadi). Kelmasa — eski yo'l: umumiy to'lov sahifasi.
      if (list.length) setProviders(list);
      else if (d?.payUrl) window.location.href = d.payUrl;
      else setErr("To'lov usullari kelmadi");
    } catch {
      setErr("Server bilan ulanishda xatolik");
    } finally {
      setBusy("");
    }
  };

  const askAdmin = async () => {
    setErr(""); setBusy("admin");
    try {
      const { ok, status, d } = await call("/contact-admin", { selectedPlan: chosen });
      // 429 — so'rov yaqinda yuborilgan. Bu xato emas: foydalanuvchiga ayni
      // natija (admin xabardor) ko'rsatiladi, qayta bosishga undalmaydi.
      if (ok || status === 429) setSent(true);
      else setErr(d?.error || "Xabarni yuborib bo'lmadi");
    } catch {
      setErr("Server bilan ulanishda xatolik");
    } finally {
      setBusy("");
    }
  };

  const current = plans.find((p) => p.key === chosen) || null;
  const ended = info.periodEnd ? new Date(info.periodEnd).toLocaleDateString("uz-UZ") : "";
  const canPay = info.canPay !== false && !!token;

  return (
    <div className="space-y-4" data-testid="sub-blocked">
      <div className="flex flex-col items-center gap-2 text-center">
        <div className="w-14 h-14 rounded-full bg-red-500/15 flex items-center justify-center">
          <MorphIcon icon={AlertCircle} className="w-7 h-7 text-red-500" />
        </div>
        <p className="text-sm font-semibold">
          {info.reason === "rejected" ? "Obuna rad etilgan" : "Obuna muddati tugagan"}
        </p>
        <p className="text-xs text-muted-foreground leading-relaxed">
          {ended ? `Muddati ${ended} da tugagan. ` : ""}
          To'lovni shu yerda yangilashingiz mumkin.
        </p>
      </div>

      {sent ? (
        <div className="rounded-xl bg-green-500/10 border border-green-500/20 px-4 py-4 text-center space-y-1.5">
          <MorphIcon icon={Check} className="w-6 h-6 text-green-600 mx-auto" />
          <p className="text-sm font-semibold">So'rov adminga yuborildi</p>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Firma nomi, tarif va bog'lanish ma'lumotlari bilan birga ketdi — hech narsa yozish shart emas.
            Tez orada bog'lanishadi.
          </p>
          <a href={`https://t.me/${adminHandle.replace(/^@/, "")}`} target="_blank" rel="noopener noreferrer"
            className="inline-block text-xs text-primary hover:underline pt-1">
            Shoshilinch bo'lsa — {adminHandle}
          </a>
        </div>
      ) : (
        <>
          {canPay && !!plans.length && (
            <div className="space-y-1.5">
              {/* Yig'ilgan holat: faqat tanlangan tarif. Ro'yxat ochilsa ham
                  ichida skroll qiladi — kartochka ekrandan oshmaydi va pastki
                  tugmalar doim ko'rinib turadi. */}
              <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open}
                data-testid="sub-plan-toggle"
                className="w-full flex items-center justify-between gap-2 px-4 py-3 rounded-xl border border-primary bg-primary/10 text-left">
                <span className="min-w-0">
                  <span className="text-sm font-semibold block truncate">{current?.label || "Tarifni tanlang"}</span>
                  <span className="text-[11px] text-muted-foreground">
                    {current ? `${current.days} kun · ${open ? "boshqasini tanlang" : "o'zgartirish uchun bosing"}` : "ro'yxatni oching"}
                  </span>
                </span>
                <span className="flex items-center gap-2 flex-shrink-0">
                  {current && <span className="text-sm font-bold whitespace-nowrap">{fmt(current.amount)} so'm</span>}
                  <MorphIcon icon={ChevronDown} className={`w-4 h-4 text-muted-foreground transition-transform duration-300 ${open ? "rotate-180" : ""}`} />
                </span>
              </button>

              {open && (
                <div className="space-y-1.5 max-h-[38vh] overflow-y-auto scrollbar-hide pt-0.5">
                  {plans.map((p) => (
                    <button key={p.key} type="button" onClick={() => { setChosen(p.key); setOpen(false); }}
                      data-testid={`sub-plan-${p.key}`}
                      className={`w-full flex items-center justify-between gap-2 px-4 py-3 rounded-xl border text-left liquid-transition ${
                        chosen === p.key ? "border-primary bg-primary/10" : "border-border hover:bg-muted/50"
                      }`}>
                      <span className="min-w-0">
                        <span className="text-sm font-semibold block truncate">{p.label}</span>
                        <span className="text-[11px] text-muted-foreground">
                          {p.days} kun{p.key === info.selectedPlan ? " · hozirgi tarifingiz" : ""}
                        </span>
                      </span>
                      <span className="text-sm font-bold whitespace-nowrap">{fmt(p.amount)} so'm</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {!!err && <p className="text-xs text-red-500 text-center">{err}</p>}

          {!!providers.length && (
            <div className="rounded-xl border border-primary/30 bg-primary/5 px-3 py-3 space-y-2">
              <p className="text-[12px] font-semibold text-center">To'lov usulini tanlang</p>
              {providers.map((p) => (
                <a key={p.code} href={p.url} rel="noopener noreferrer"
                  data-testid={`sub-pay-${p.code}`}
                  className="w-full block text-center bg-primary text-white text-sm font-semibold py-3 rounded-full min-h-[44px] active:scale-[0.98] transition-transform">
                  {p.name || p.code}
                </a>
              ))}
              <button type="button" onClick={() => setProviders([])}
                className="w-full text-[12px] text-muted-foreground hover:text-foreground py-1">
                Bekor qilish
              </button>
            </div>
          )}

          {canPay && !providers.length && (
            <button type="button" onClick={payOnline} disabled={!chosen || busy !== ""}
              data-testid="sub-pay-online"
              className="w-full bg-primary text-white text-sm font-semibold py-3.5 rounded-full min-h-[44px] active:scale-[0.98] transition-transform disabled:opacity-60">
              {busy === "pay" ? "Havola tayyorlanmoqda…" : "Onlayn to'lash (Click / Payme / Paynet)"}
            </button>
          )}

          {/* Ikkinchi yo'l: admin orqali — bitta tugma, hamma ma'lumot o'zi ketadi */}
          <button type="button" onClick={askAdmin} disabled={busy !== "" || !token}
            data-testid="sub-ask-admin"
            className="w-full inline-flex items-center justify-center gap-2 bg-blue-500 text-white text-sm font-semibold py-3.5 rounded-full min-h-[44px] active:scale-[0.98] transition-transform disabled:opacity-60">
            <MorphIcon icon={Send} className="w-4 h-4" />
            {busy === "admin" ? "Yuborilmoqda…" : "Admin orqali faollashtirish"}
          </button>

          {!token && (
            <a href={`https://t.me/${adminHandle.replace(/^@/, "")}`} target="_blank" rel="noopener noreferrer"
              className="w-full inline-flex items-center justify-center gap-2 bg-blue-500 text-white text-sm font-semibold py-3.5 rounded-full min-h-[44px]">
              <MorphIcon icon={Send} className="w-4 h-4" /> {adminHandle}'ga yozish
            </a>
          )}

          <p className="text-[11px] text-muted-foreground text-center leading-relaxed">
            Admin orqali tanlasangiz — firma va tarif ma'lumotlari bilan tayyor so'rov yuboriladi,
            o'zingiz hech narsa yozmaysiz.
          </p>
        </>
      )}

      <button type="button" onClick={onBack} className="w-full text-sm text-muted-foreground hover:text-foreground py-2">
        Orqaga
      </button>
    </div>
  );
}
