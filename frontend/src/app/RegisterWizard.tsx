import { useState, useRef, useEffect } from "react";
import { ArrowLeft, AlertTriangle, CheckCircle, Send, Loader2, Check, Camera, Copy, MessageCircle } from "lucide-react";
import { toast } from "sonner";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";
import { API_BASE, uploadChatMedia } from "./api";
import { setSiteLanguage, SiteLang } from "./i18n";
import LanguageSwitcher from "./i18n/LanguageSwitcher";

// v1.2 self-signup — faqat yangi firma ochayotgan foydalanuvchi ko'radi,
// shuning uchun alohida faylga chiqarilib React.lazy orqali faqat
// "Firma ochish" bosilganda yuklanadi (asosiy bundle kichrayadi).
type RegStep = "warn" | "tarif" | "payment" | "phone" | "bot" | "owner" | "company" | "brand" | "summary" | "done";

// Modul darajasida (render ichida emas) — aks holda input fokusini yo'qotadi
function RegField({ label, children, hint }: { label: string; children: any; hint?: string }) {
  return (
    <div>
      <label className="text-sm md:text-xs font-medium block mb-1.5 ml-1 text-muted-foreground">{label}</label>
      {children}
      {hint && <p className="text-[11px] text-muted-foreground mt-1 ml-1">{hint}</p>}
    </div>
  );
}

export default function RegisterWizard({ onBack, onDone }: { onBack: () => void; onDone: (u: any, company?: any) => void }) {
  const { t, i18n } = useTranslation();
  const [step, setStep] = useState<RegStep>("warn");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [regLanguage, setRegLanguage] = useState<SiteLang>((i18n.language as SiteLang) || 'uz');

  // Qadam 1 — ogohlantirish
  const [ownerConfirm, setOwnerConfirm] = useState(false);

  // Qadam 2 — tarif tanlash
  const [selectedPlan, setSelectedPlan] = useState<'1month'|'3month'|'6month'|'12month'|null>(null);
  const [regDoneInfo, setRegDoneInfo] = useState<{phone:string;planLabel:string;planAmount:number;companyName:string;branchId:string;ownerName:string}|null>(null);
  const [doneCopied, setDoneCopied] = useState(false);

  // Qadam 3 — telefon
  const [phone, setPhone] = useState("+998 ");

  // Ro'yxat sessiyasi (resume uchun localStorage'da saqlanadi)
  const [reg, setReg] = useState<{ registrationId: string; token: string; deepLink: string; botUsername: string; expiresAt: string } | null>(() => {
    try { const s = localStorage.getItem("erp_reg"); return s ? JSON.parse(s) : null; } catch { return null; }
  });
  const [botStatus, setBotStatus] = useState<string>("");
  const [timeLeft, setTimeLeft] = useState(0);
  const [resendCd, setResendCd] = useState(0);

  // Qadam 5.1 — egasi
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [middleName, setMiddleName] = useState("");
  const [email, setEmail] = useState("");
  const [position, setPosition] = useState("Direktor");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");

  // Qadam 5.2 — firma
  const [companyName, setCompanyName] = useState("");
  const [legalName, setLegalName] = useState("");
  const [inn, setInn] = useState("");
  const [activityType, setActivityType] = useState("qurilish");
  const [region, setRegion] = useState("");
  const [employeeRange, setEmployeeRange] = useState("1-10");

  // Qadam 5.3 — logo + valyuta
  const [logoUrl, setLogoUrl] = useState("");
  const [logoUploading, setLogoUploading] = useState(false);
  const [currency, setCurrency] = useState<"UZS" | "USD">("UZS");
  const logoRef = useRef<HTMLInputElement>(null);

  const saveReg = (r: any, plan?: string) => {
    setReg(r);
    try { localStorage.setItem("erp_reg", JSON.stringify(r)); } catch {}
    if (plan) try { localStorage.setItem("erp_reg_plan", plan); } catch {}
  };
  const clearReg = () => {
    setReg(null);
    try { localStorage.removeItem("erp_reg"); localStorage.removeItem("erp_reg_plan"); } catch {}
  };

  // Resume: sahifa ochilganda faol sessiya bo'lsa botga/keyingi qadamга o'tamiz
  useEffect(() => {
    if (reg && step === "warn") {
      setOwnerConfirm(true);
      // Saqlangan tarifni tiklaymiz
      const savedPlan = localStorage.getItem("erp_reg_plan") as '1month'|'3month'|'12month'|null;
      if (savedPlan) setSelectedPlan(savedPlan);
      setStep("bot");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 15 daqiqa timer
  useEffect(() => {
    if (step !== "bot" || !reg) return;
    const tick = () => {
      const left = Math.max(0, Math.floor((new Date(reg.expiresAt).getTime() - Date.now()) / 1000));
      setTimeLeft(left);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [step, reg]);

  // Resend cooldown
  useEffect(() => {
    if (resendCd <= 0) return;
    const id = setTimeout(() => setResendCd(resendCd - 1), 1000);
    return () => clearTimeout(id);
  }, [resendCd]);

  // Polling: bot tomonda tasdiqlanganini kutamiz
  useEffect(() => {
    if (step !== "bot" || !reg) return;
    let stop = false;
    const poll = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/register/status?registrationId=${reg.registrationId}`);
        const d = await res.json();
        if (stop) return;
        setBotStatus(d.step);
        if (d.step === "EXPIRED") { setError("Sessiya muddati tugadi. Qaytadan boshlang."); clearReg(); setStep("phone"); return; }
        if (d.consentGiven) { setStep("owner"); return; }
      } catch { /* tarmoq — keyingi urinishda */ }
    };
    poll();
    const id = setInterval(poll, 2500);
    return () => { stop = true; clearInterval(id); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, reg?.registrationId]);

  const submitPhone = async () => {
    const clean = phone.replace(/\s+/g, "");
    if (!/^\+998\d{9}$/.test(clean)) { setError("To'g'ri raqam kiriting: +998 XX XXX XX XX"); return; }
    setError(""); setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/register/phone`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: clean, ownerConfirm, language: regLanguage }),
      });
      const d = await res.json();
      if (!res.ok) { setError(d.error || "Xatolik"); setLoading(false); return; }
      if (d.exists) { setError("Bu raqam bilan firma mavjud. Tizimga kiring."); setLoading(false); setTimeout(onBack, 1800); return; }
      // Tarifni ham saqlaymiz — resume qilganda tiklanadi
      saveReg(
        { registrationId: d.registrationId, token: d.token, deepLink: d.deepLink, botUsername: d.botUsername, expiresAt: d.expiresAt },
        selectedPlan || '1month'
      );
      setStep("bot");
    } catch { setError("Server bilan ulanishda xatolik"); }
    setLoading(false);
  };

  const resend = async () => {
    if (!reg || resendCd > 0) return;
    try {
      const res = await fetch(`${API_BASE}/api/register/resend`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ registrationId: reg.registrationId }),
      });
      const d = await res.json();
      if (res.ok) { saveReg({ registrationId: d.registrationId, token: d.token, deepLink: d.deepLink, botUsername: d.botUsername, expiresAt: d.expiresAt }); setResendCd(60); }
      else if (d.retryAfterSec) setResendCd(d.retryAfterSec);
    } catch {}
  };

  const pickLogo = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; if (!f) return;
    if (f.size > 2 * 1024 * 1024) { setError("Logo 2MB dan katta bo'lmasin"); return; }
    if (!/^image\/(png|jpe?g|webp)$/.test(f.type)) { setError("Faqat PNG/JPG/WEBP"); return; }
    setError(""); setLogoUploading(true);
    try { const { url } = await uploadChatMedia(f, f.name); setLogoUrl(url); }
    catch { setError("Logo yuklanmadi"); }
    setLogoUploading(false);
  };

  const complete = async () => {
    if (!reg) return;
    setError(""); setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/register/complete`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token: reg.token,
          selectedPlan: selectedPlan || '1month',
          owner: { firstName, lastName, middleName, email, position, password },
          company: { name: companyName, legalName, inn, activityType, region, employeeRange, currency },
          logoUrl,
        }),
      });
      const d = await res.json();
      if (!res.ok) { setError(d.error || "Xatolik"); setLoading(false); return; }
      // Server endi JWT bermaydi — pending holatida admin tasdiqini kutamiz
      clearReg();
      setRegDoneInfo({
        phone: d.phone || phone.replace(/\s/g,''),
        planLabel: d.planLabel || '1 oylik',
        planAmount: d.planAmount ?? 0,
        companyName: d.company?.name || companyName,
        branchId: d.company?.branchId || '',
        ownerName: `${firstName} ${lastName}`.trim(),
      });
      setStep("done");
    } catch { setError("Server bilan ulanishda xatolik"); setLoading(false); }
    setLoading(false);
  };

  // ── Kichik UI yordamchilar ──────────────────────────────────────────────────
  const STEPS_ORDER: RegStep[] = ["tarif", "payment", "phone", "bot", "owner", "company", "brand", "summary"];
  const progress = Math.max(0, STEPS_ORDER.indexOf(step)) / (STEPS_ORDER.length - 1);
  const inputCls = "w-full text-base border border-border/50 rounded-xl px-4 py-3 bg-white/60 dark:bg-black/20 focus:bg-white dark:focus:bg-black/40 focus:outline-none focus:ring-2 focus:ring-primary/50 liquid-transition";

  const goBack = () => {
    const map: Record<RegStep, RegStep | null> = {
      warn: null, tarif: "warn", payment: "tarif", phone: "payment",
      bot: "phone", owner: "bot", company: "owner", brand: "company", summary: "brand", done: null
    };
    const prev = map[step];
    if (prev) setStep(prev); else onBack();
  };

  return (
    <div className="h-[100dvh] bg-background flex flex-col liquid-transition relative overflow-hidden" style={{ paddingTop: "env(safe-area-inset-top)" }}>
      <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-primary/20 rounded-full blur-[100px]" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-accent/20 rounded-full blur-[100px]" />

      {/* Header: back + progress */}
      <div className="relative z-10 flex items-center gap-3 px-4 pt-4">
        <button onClick={goBack} aria-label="Orqaga" className="w-10 h-10 rounded-full bg-white/50 dark:bg-black/20 flex items-center justify-center shrink-0">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="flex-1 h-1.5 rounded-full bg-border/60 overflow-hidden">
          <div className="h-full bg-primary liquid-transition" style={{ width: `${step === "warn" ? 0 : progress * 100}%` }} />
        </div>
      </div>

      {/* pb-24 = sticky button height uchun joy qoldiradi — content uning ostiga tushib ketmaydi */}
      <div className="relative z-10 flex-1 overflow-y-auto scrollbar-hide px-4 py-6 pb-24 flex flex-col">
        <div className="w-full max-w-md mx-auto flex-1 flex flex-col">
          {error && <div className="bg-red-500/10 text-red-700 dark:text-red-400 text-sm p-3 rounded-lg border border-red-500/20 text-center mb-4 animate-pop-in">{error}</div>}

          {/* ── Qadam 1: Ogohlantirish ── */}
          {step === "warn" && (
            <div className="space-y-5 animate-slide-up-fade">
              <div className="space-y-1.5">
                <p className="text-xs text-muted-foreground text-center">{t('login.chooseLanguage')}</p>
                <LanguageSwitcher size="sm" value={regLanguage} onChange={l => { setRegLanguage(l); setSiteLanguage(l); }}/>
              </div>
              <div className="bg-amber-500/10 border border-amber-500/30 rounded-2xl p-4">
                <div className="flex items-center gap-2 mb-2 text-amber-800 dark:text-amber-300 font-bold">
                  <AlertTriangle className="w-5 h-5" /> Diqqat!
                </div>
                <p className="text-sm leading-relaxed text-foreground">
                  Faqat <b>firma egasi (rahbari)</b> ro'yxatdan o'ta oladi. Bu formani shaxsan firma egasi o'zi to'ldirishi kerak.
                  Xodimlar mustaqil ro'yxatdan o'ta olmaydi — sizni firma egasi tizimga taklif qiladi.
                  Har bir yangi firmaga alohida <b>Branch ID</b> beriladi va ma'lumotlaringiz boshqa firmalarga ko'rinmaydi.
                </p>
              </div>
              <label className="flex items-start gap-3 cursor-pointer select-none">
                <input type="checkbox" checked={ownerConfirm} onChange={e => setOwnerConfirm(e.target.checked)} className="mt-1 w-5 h-5 accent-primary" />
                <span className="text-sm">Men firma egasi ekanligimni va ma'lumotlar to'g'ri ekanini tasdiqlayman</span>
              </label>
            </div>
          )}

          {/* ── Qadam 2: Tarif tanlash ── */}
          {step === "tarif" && (
            <div className="space-y-5 animate-slide-in-right">
              <div>
                <h2 className="text-xl font-bold mb-1">Tarif tanlang</h2>
                <p className="text-sm text-muted-foreground">Firma uchun obuna muddatini tanlang</p>
              </div>

              {/* Barcha tariflarga kiritilgan (bir marta, takrorlanmaydi) */}
              <div className="rounded-2xl border border-border/50 bg-white/40 dark:bg-black/20 p-4">
                <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-2">Barcha tariflarga kiritilgan</p>
                <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
                  {["Cheklanmagan xodimlar", "Cheklanmagan obyektlar", "AI yordamchi", "Real-time chat va qo'ng'iroq", "Smeta va hisobotlar", "Telegram bot integratsiyasi"].map(f => (
                    <div key={f} className="flex items-center gap-1.5 text-xs text-foreground/80"><CheckCircle className="w-3.5 h-3.5 flex-shrink-0 text-green-500"/>{f}</div>
                  ))}
                </div>
              </div>

              <div className="space-y-3">
                {([
                  { key: '1month',  label: '1 oylik',  fullPrice: 700_000,   price: 0,         days: 30,  ribbon: undefined as string|undefined, featured: false },
                  { key: '3month',  label: '3 oylik',  fullPrice: 2_100_000, price: 1_400_000, days: 90,  ribbon: 'ENG TEJAMKOR',   featured: false },
                  { key: '6month',  label: '6 oylik',  fullPrice: 4_200_000, price: 3_500_000, days: 180, ribbon: undefined,        featured: false },
                  { key: '12month', label: '12 oylik', fullPrice: 8_400_000, price: 7_700_000, days: 365, ribbon: 'ENG UZOQ MUDDAT',featured: true },
                ] as const).map((plan, i) => {
                  const selected = selectedPlan === plan.key;
                  return (
                    <motion.button key={plan.key} type="button" onClick={() => setSelectedPlan(plan.key)}
                      initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0, scale: selected ? 1.02 : 1 }}
                      transition={{ delay: i * 0.05, type: "spring", stiffness: 320, damping: 26 }}
                      whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.98 }}
                      className={`relative w-full rounded-3xl p-4 text-left overflow-visible ${plan.ribbon ? "pt-7" : ""} ${
                        plan.featured
                          ? "shadow-xl shadow-primary/30 text-white"
                          : `border-2 ${selected ? "border-primary bg-primary/8 shadow-md shadow-primary/20" : "border-border/50 bg-white/40 dark:bg-black/20 hover:border-primary/40"}`
                      }`}
                      style={plan.featured ? { background: "linear-gradient(135deg, var(--primary) 0%, var(--accent) 100%)", border: selected ? "2px solid white" : "2px solid transparent" } : undefined}>
                      {plan.ribbon && (
                        <span className={`absolute -top-3 left-1/2 -translate-x-1/2 text-[9px] font-bold px-3 py-1 rounded-full tracking-wide shadow-md whitespace-nowrap ${plan.featured ? "bg-accent text-accent-foreground" : "bg-primary text-white"}`}>{plan.ribbon}</span>
                      )}
                      {selected && (
                        <span className={`absolute -top-2.5 -right-2.5 w-7 h-7 rounded-full flex items-center justify-center shadow-md ${plan.featured ? "bg-white text-primary" : "bg-primary text-white"}`}>
                          <Check className="w-4 h-4"/>
                        </span>
                      )}
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <p className={`text-base font-bold leading-tight ${plan.featured ? "text-white" : ""}`}>{plan.label}</p>
                          <p className={`text-[11px] mt-0.5 ${plan.featured ? "text-white/70" : "text-muted-foreground"}`}>{plan.days} kun</p>
                          <span className={`inline-block mt-1.5 text-[10px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap ${
                            plan.featured ? "bg-white/20 text-white" : "bg-green-500/15 text-green-800 dark:text-green-400"
                          }`}>🎁 1-oy bepul</span>
                        </div>
                        <div className="text-right flex-shrink-0">
                          {plan.price === 0 ? (
                            <p className={`text-2xl font-bold ${plan.featured ? "text-white" : "text-green-800 dark:text-green-400"}`}>BEPUL</p>
                          ) : (
                            <p className={`text-xl font-bold ${plan.featured ? "text-white" : "text-primary"}`}>{plan.price.toLocaleString('uz-UZ')}<span className="text-[11px] font-normal ml-0.5">so'm</span></p>
                          )}
                          <p className={`text-[11px] line-through ${plan.featured ? "text-white/50" : "text-muted-foreground"}`}>{plan.fullPrice.toLocaleString('uz-UZ')} so'm</p>
                        </div>
                      </div>
                    </motion.button>
                  );
                })}
              </div>
              <p className="text-xs text-center text-muted-foreground pt-1">Har bir tarifda birinchi oy bepul. Keyingi oylardan to'lov boshlanadi.</p>
            </div>
          )}

          {/* ── Qadam 3: To'lov jarayoni ── */}
          {step === "payment" && selectedPlan && (
            <div className="space-y-5 animate-slide-in-right">
              <div>
                <h2 className="text-xl font-bold mb-1">To'lov jarayoni</h2>
                <p className="text-sm text-muted-foreground">Ro'yxatdan o'tgandan so'ng qanday ishlaydi</p>
              </div>
              <div className="bg-primary/8 border border-primary/20 rounded-2xl p-4">
                <p className="text-[11px] font-semibold text-primary uppercase tracking-wider mb-2">Tanlangan tarif</p>
                {selectedPlan === '1month' ? (
                  <div>
                    <p className="text-2xl font-bold text-green-800 dark:text-green-400">BEPUL</p>
                    <p className="text-sm line-through text-muted-foreground">700 000 so'm</p>
                  </div>
                ) : (
                  <div>
                    <p className="text-2xl font-bold text-primary">
                      {selectedPlan==='3month'?'1 400 000':selectedPlan==='6month'?'3 500 000':'7 700 000'}
                      <span className="text-base font-normal text-muted-foreground ml-1">so'm</span>
                    </p>
                    <p className="text-sm line-through text-muted-foreground">
                      {selectedPlan==='3month'?'2 100 000':selectedPlan==='6month'?'4 200 000':'8 400 000'} so'm
                    </p>
                  </div>
                )}
                <p className="text-sm text-muted-foreground mt-1">
                  {selectedPlan==='1month'?'1 oylik (30 kun) — birinchi oy bepul':selectedPlan==='3month'?'3 oylik (90 kun)':selectedPlan==='6month'?'6 oylik (180 kun)':'12 oylik (365 kun)'}
                </p>
              </div>
              <div className="surface rounded-2xl p-4 space-y-3">
                {[
                  { n: "1", t: "Ro'yxatdan o'ting", d: "Barcha bosqichlarni to'ldiring va firmangizni oching" },
                  { n: "2", t: "Ma'lumotlarni yuboring", d: "@Sadriddinov_Jahongir'ga (Telegram) nusxalangan ma'lumotni yuboring" },
                  { n: "3", t: "Operator tasdiqlaydi", d: "1 daqiqadan 24 soat ichida akkauntingiz tekshiriladi" },
                  { n: "4", t: "Akkaunt ochiladi", d: "Birinchi oy — BEPUL! Keyingi oydan to'lov boshlanadi" },
                ].map(s => (
                  <div key={s.n} className="flex items-start gap-3">
                    <div className="w-6 h-6 rounded-full bg-primary text-white text-xs flex items-center justify-center font-bold flex-shrink-0 mt-0.5">{s.n}</div>
                    <div><p className="text-sm font-semibold">{s.t}</p><p className="text-xs text-muted-foreground">{s.d}</p></div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Qadam 4: Telefon ── */}
          {step === "phone" && (
            <div className="space-y-5 animate-slide-in-right">
              <div>
                <h2 className="text-xl font-bold mb-1">Telefon raqamingiz</h2>
                <p className="text-sm text-muted-foreground">Firma egasining raqami. Telegram orqali tasdiqlanadi.</p>
              </div>
              <RegField label="Telefon">
                <input inputMode="tel" className={inputCls + " font-mono"} value={phone}
                  onChange={e => { setError(""); const v = e.target.value; if (v.startsWith("+998 ")) setPhone(v); else if (v === "+998") setPhone("+998 "); }}
                  autoFocus />
              </RegField>
            </div>
          )}

          {/* ── Qadam 3: Botga o'tish ── */}
          {step === "bot" && reg && (
            <div className="space-y-5 animate-slide-in-right text-center">
              <div>
                <h2 className="text-xl font-bold mb-1">Telegram orqali tasdiqlash</h2>
                <p className="text-sm text-muted-foreground">Botga o'ting, raqamingizni yuboring va rozilik bering. Bu sahifa avtomatik davom etadi.</p>
              </div>
              <a href={reg.deepLink} target="_blank" rel="noopener noreferrer"
                className="w-full inline-flex items-center justify-center gap-2 bg-gradient-to-r from-primary to-primary/90 text-white text-base font-semibold py-4 rounded-xl shadow-lg shadow-primary/25 min-h-[54px] active:scale-[0.98] transition-transform">
                <Send className="w-5 h-5" /> Telegram botga o'tish
              </a>
              {/* Bosib to'liq /start <token> nusxalanadi (kesilmaydi) */}
              <button type="button" onClick={() => {
                const txt = `/start ${reg.token}`;
                const done = () => toast.success("Nusxalandi ✅ — botga joylab yuboring");
                if (navigator.clipboard?.writeText) navigator.clipboard.writeText(txt).then(done).catch(()=>{});
                else { try { const ta=document.createElement("textarea"); ta.value=txt; document.body.appendChild(ta); ta.select(); document.execCommand("copy"); document.body.removeChild(ta); done(); } catch {} }
              }} className="w-full bg-white/50 dark:bg-black/20 rounded-xl p-3 border border-border/50 text-left active:scale-[0.99] transition-transform">
                <div className="flex items-center justify-between mb-1">
                  <p className="text-[11px] text-muted-foreground">Tugma ishlamasa — bosib nusxalang:</p>
                  <span className="text-[11px] text-primary font-semibold whitespace-nowrap">📋 Nusxalash</span>
                </div>
                <code className="text-xs break-all font-mono text-primary block leading-relaxed">/start {reg.token}</code>
              </button>
              <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="w-4 h-4 animate-spin" />
                {botStatus === "PHONE_CONFIRMED" ? "Raqam tasdiqlandi, rozilik kutilmoqda…" : "Bot javobini kutmoqdamiz…"}
              </div>
              {/* Timer 2:00 → 0:00; "Qayta yuborish" FAQAT muddat tugagach chiqadi */}
              {timeLeft > 0 ? (
                <p className="text-sm text-muted-foreground">Kod <span className="font-mono font-semibold text-foreground">{Math.floor(timeLeft / 60)}:{(timeLeft % 60).toString().padStart(2, "0")}</span> amal qiladi</p>
              ) : (
                <button onClick={resend} disabled={resendCd > 0} className={`text-sm font-semibold min-h-[44px] px-4 rounded-lg ${resendCd > 0 ? "text-muted-foreground/50" : "text-primary hover:bg-primary/10"}`}>
                  {resendCd > 0 ? `Qayta yuborish (${resendCd}s)` : "🔄 Kodni qayta yuborish"}
                </button>
              )}
            </div>
          )}

          {/* ── Qadam 5.1: Egasi ── */}
          {step === "owner" && (
            <div className="space-y-4 animate-slide-in-right">
              <div><h2 className="text-xl font-bold mb-1">Firma egasi</h2><p className="text-sm text-muted-foreground">Sizning ma'lumotlaringiz.</p></div>
              <div className="grid grid-cols-2 gap-3">
                <RegField label="Ism *"><input className={inputCls} value={firstName} onChange={e => setFirstName(e.target.value)} autoFocus /></RegField>
                <RegField label="Familiya *"><input className={inputCls} value={lastName} onChange={e => setLastName(e.target.value)} /></RegField>
              </div>
              <RegField label="Otasining ismi"><input className={inputCls} value={middleName} onChange={e => setMiddleName(e.target.value)} /></RegField>
              <RegField label="Email"><input type="email" className={inputCls} value={email} onChange={e => setEmail(e.target.value)} /></RegField>
              <RegField label="Lavozim"><input className={inputCls} value={position} onChange={e => setPosition(e.target.value)} /></RegField>
              <RegField label="Parol *" hint="Kamida 8 belgi">
                <input type="password" className={inputCls} value={password} onChange={e => setPassword(e.target.value)} />
                <div className="h-1 mt-1.5 rounded-full bg-border/60 overflow-hidden">
                  <div className={`h-full liquid-transition ${password.length >= 12 ? "bg-green-500 w-full" : password.length >= 8 ? "bg-amber-500 w-2/3" : "bg-red-500 w-1/3"}`} />
                </div>
              </RegField>
              <RegField label="Parolni tasdiqlang *"><input type="password" className={inputCls} value={password2} onChange={e => setPassword2(e.target.value)} /></RegField>
            </div>
          )}

          {/* ── Qadam 5.2: Firma ── */}
          {step === "company" && (
            <div className="space-y-4 animate-slide-in-right">
              <div><h2 className="text-xl font-bold mb-1">Firma ma'lumotlari</h2></div>
              <RegField label="Firma nomi *"><input className={inputCls} value={companyName} onChange={e => setCompanyName(e.target.value)} autoFocus /></RegField>
              <RegField label="Yuridik nomi"><input className={inputCls} value={legalName} onChange={e => setLegalName(e.target.value)} /></RegField>
              <RegField label="INN / STIR" hint="9 raqam"><input inputMode="numeric" className={inputCls + " font-mono"} value={inn} maxLength={9} onChange={e => setInn(e.target.value.replace(/\D/g, ""))} /></RegField>
              <RegField label="Faoliyat turi">
                <select className={inputCls} value={activityType} onChange={e => setActivityType(e.target.value)}>
                  <option value="qurilish">Qurilish</option><option value="tamirlash">Ta'mirlash</option>
                  <option value="loyihalash">Loyihalash</option><option value="boshqa">Boshqa</option>
                </select>
              </RegField>
              <RegField label="Viloyat / Manzil"><input className={inputCls} value={region} onChange={e => setRegion(e.target.value)} /></RegField>
              <RegField label="Xodimlar soni">
                <select className={inputCls} value={employeeRange} onChange={e => setEmployeeRange(e.target.value)}>
                  <option value="1-10">1–10</option><option value="11-50">11–50</option>
                  <option value="51-200">51–200</option><option value="200+">200+</option>
                </select>
              </RegField>
            </div>
          )}

          {/* ── Qadam 5.3: Logo + valyuta ── */}
          {step === "brand" && (
            <div className="space-y-5 animate-slide-in-right">
              <div><h2 className="text-xl font-bold mb-1">Logotip va brend</h2></div>
              <div className="flex flex-col items-center gap-3">
                <div className="w-28 h-28 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center overflow-hidden">
                  {logoUploading ? <Loader2 className="w-6 h-6 animate-spin text-primary" />
                    : logoUrl ? <img src={logoUrl} alt="logo" className="w-full h-full object-cover" />
                    : <span className="text-3xl font-bold text-primary">{(companyName || "F").slice(0, 1).toUpperCase()}</span>}
                </div>
                <input ref={logoRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={pickLogo} />
                <button onClick={() => logoRef.current?.click()} className="text-sm font-semibold text-primary flex items-center gap-1.5">
                  <Camera className="w-4 h-4" /> {logoUrl ? "O'zgartirish" : "Logo yuklash"}
                </button>
                <p className="text-[11px] text-muted-foreground">PNG/JPG/WEBP, maks 2MB. Ixtiyoriy.</p>
              </div>
              <RegField label="Asosiy valyuta">
                <div className="grid grid-cols-2 gap-3">
                  {(["UZS", "USD"] as const).map(c => (
                    <button key={c} onClick={() => setCurrency(c)}
                      className={`py-3 rounded-xl border text-sm font-semibold ${currency === c ? "border-primary bg-primary/10 text-primary" : "border-border/50"}`}>{c}</button>
                  ))}
                </div>
              </RegField>
            </div>
          )}

          {/* ── Qadam 9: Yakuniy tasdiq ── */}
          {step === "summary" && (
            <div className="space-y-4 animate-slide-in-right">
              <div><h2 className="text-xl font-bold mb-1">Tekshirib tasdiqlang</h2></div>
              {[
                { t: "Tarif", v: selectedPlan==='1month'?'1 oylik — BEPUL':selectedPlan==='3month'?'3 oylik — 1 400 000 so\'m':selectedPlan==='6month'?'6 oylik — 3 500 000 so\'m':'12 oylik — 7 700 000 so\'m', go: "tarif" as RegStep },
                { t: "Egasi", v: `${firstName} ${lastName}`, go: "owner" as RegStep },
                { t: "Telefon", v: phone, go: "phone" as RegStep },
                { t: "Firma", v: companyName, go: "company" as RegStep },
                { t: "Faoliyat", v: activityType, go: "company" as RegStep },
                { t: "Valyuta", v: currency, go: "brand" as RegStep },
              ].map((r, i) => (
                <div key={i} className="flex items-center justify-between surface rounded-xl px-4 py-3">
                  <div><p className="text-[11px] text-muted-foreground">{r.t}</p><p className="text-sm font-medium">{r.v || "—"}</p></div>
                  <button onClick={() => setStep(r.go)} className="text-xs text-primary font-semibold">Tahrirlash</button>
                </div>
              ))}
            </div>
          )}

          {/* ── Qadam 10: Ro'yxatdan o'tdingiz — ma'lumotlarni yuborish ── */}
          {step === "done" && regDoneInfo && (
            <div className="space-y-5 animate-slide-in-right flex-1 flex flex-col justify-center">
              <div className="flex flex-col items-center gap-3 text-center">
                <div className="w-16 h-16 rounded-full bg-green-500/15 flex items-center justify-center">
                  <CheckCircle className="w-8 h-8 text-green-500"/>
                </div>
                <div>
                  <h2 className="text-xl font-bold mb-1">Ro'yxatdan o'tdingiz!</h2>
                  <p className="text-sm text-muted-foreground">Quyidagi ma'lumotlarni @Sadriddinov_Jahongir'ga (Telegram) yuboring</p>
                </div>
              </div>

              {/* Copyable info block */}
              <div className="relative">
                <div className="bg-slate-900 dark:bg-slate-800 text-green-400 rounded-2xl p-4 font-mono text-xs leading-relaxed whitespace-pre-wrap border border-slate-700 select-all">
                  {[
                    `📋 YANGI FIRMA RO'YXATI`,
                    `─────────────────────────`,
                    `🏢 Firma: ${regDoneInfo.companyName}`,
                    `👤 Egasi: ${regDoneInfo.ownerName}`,
                    `📞 Telefon: ${regDoneInfo.phone}`,
                    `📦 Tarif: ${regDoneInfo.planLabel}`,
                    `💰 Summa: ${regDoneInfo.planAmount.toLocaleString('uz-UZ')} so'm`,
                    ...(regDoneInfo.branchId ? [`🔑 ID: ${regDoneInfo.branchId}`] : []),
                    `─────────────────────────`,
                  ].join('\n')}
                </div>
                <button
                  onClick={() => {
                    const text = [
                      `📋 YANGI FIRMA RO'YXATI`,
                      `─────────────────────────`,
                      `🏢 Firma: ${regDoneInfo.companyName}`,
                      `👤 Egasi: ${regDoneInfo.ownerName}`,
                      `📞 Telefon: ${regDoneInfo.phone}`,
                      `📦 Tarif: ${regDoneInfo.planLabel}`,
                      `💰 Summa: ${regDoneInfo.planAmount.toLocaleString('uz-UZ')} so'm`,
                      ...(regDoneInfo.branchId ? [`🔑 ID: ${regDoneInfo.branchId}`] : []),
                      `─────────────────────────`,
                    ].join('\n');
                    navigator.clipboard.writeText(text).then(() => {
                      setDoneCopied(true);
                      setTimeout(() => setDoneCopied(false), 2500);
                    });
                  }}
                  className={`absolute top-3 right-3 flex items-center gap-1.5 text-[11px] font-semibold px-3 py-1.5 rounded-xl transition-all ${doneCopied ? 'bg-green-500 text-white' : 'bg-white/10 text-white hover:bg-white/20'}`}>
                  {doneCopied ? <><Check className="w-3 h-3"/>Nusxalandi!</> : <><Copy className="w-3 h-3"/>Nusxalash</>}
                </button>
              </div>

              <div className="surface rounded-2xl p-4 space-y-2.5">
                <p className="text-sm font-semibold">Keyingi qadam:</p>
                <p className="text-sm leading-relaxed text-muted-foreground">Yuqoridagi ma'lumotni nusxalab @Sadriddinov_Jahongir'ga (Telegram) yuboring:</p>
                <a href="https://t.me/Sadriddinov_Jahongir" target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-2.5 bg-primary/10 border border-primary/25 rounded-xl px-4 py-3">
                  <div className="w-9 h-9 rounded-full bg-primary/15 flex items-center justify-center flex-shrink-0">
                    <MessageCircle className="w-4 h-4 text-primary"/>
                  </div>
                  <div>
                    <p className="text-sm font-bold text-primary">@Sadriddinov_Jahongir</p>
                    <p className="text-[11px] text-muted-foreground">Telegram — ma'lumotlarni yuboring</p>
                  </div>
                </a>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Operator javobini kuting. <b className="text-foreground">Birinchi oy — BEPUL!</b> Keyingi oydan to'lov boshlanadi.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Sticky primary button (thumb zone) */}
      <div className="relative z-10 px-4 pb-4 pt-2" style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 16px)" }}>
        <div className="w-full max-w-md mx-auto">
          {step === "warn" && (
            <button disabled={!ownerConfirm} onClick={() => setStep("tarif")}
              className="w-full bg-primary text-white text-sm font-semibold py-3.5 rounded-xl min-h-[48px] disabled:opacity-40 disabled:cursor-not-allowed active:scale-[0.98] transition-transform">
              Davom etish
            </button>
          )}
          {step === "tarif" && (
            <button disabled={!selectedPlan} onClick={() => setStep("payment")}
              className="w-full bg-primary text-white text-sm font-semibold py-3.5 rounded-xl min-h-[48px] disabled:opacity-40 disabled:cursor-not-allowed active:scale-[0.98] transition-transform">
              Davom etish
            </button>
          )}
          {step === "payment" && (
            <button onClick={() => setStep("phone")}
              className="w-full bg-primary text-white text-sm font-semibold py-3.5 rounded-xl min-h-[48px] active:scale-[0.98] transition-transform">
              Davom etish
            </button>
          )}
          {step === "phone" && (
            <button disabled={loading} onClick={submitPhone}
              className="w-full bg-primary text-white text-sm font-semibold py-3.5 rounded-xl min-h-[48px] disabled:opacity-60 flex items-center justify-center gap-2 active:scale-[0.98] transition-transform">
              {loading && <Loader2 className="w-4 h-4 animate-spin" />} Davom etish
            </button>
          )}
          {step === "owner" && (
            <button onClick={() => {
              if (!firstName.trim() || !lastName.trim()) { setError("Ism va familiya majburiy"); return; }
              if (password.length < 8) { setError("Parol kamida 8 belgi"); return; }
              if (password !== password2) { setError("Parollar mos kelmadi"); return; }
              setError(""); setStep("company");
            }} className="w-full bg-primary text-white text-sm font-semibold py-3.5 rounded-xl min-h-[48px]">Davom etish</button>
          )}
          {step === "company" && (
            <button onClick={() => {
              if (!companyName.trim()) { setError("Firma nomi majburiy"); return; }
              if (inn && !/^\d{9}$/.test(inn)) { setError("INN 9 raqam bo'lishi kerak"); return; }
              setError(""); setStep("brand");
            }} className="w-full bg-primary text-white text-sm font-semibold py-3.5 rounded-xl min-h-[48px]">Davom etish</button>
          )}
          {step === "brand" && (
            <button onClick={() => setStep("summary")} className="w-full bg-primary text-white text-sm font-semibold py-3.5 rounded-xl min-h-[48px]">Davom etish</button>
          )}
          {step === "summary" && (
            <button disabled={loading} onClick={complete}
              className="w-full bg-accent text-white text-sm font-semibold py-3.5 rounded-xl min-h-[48px] disabled:opacity-60 flex items-center justify-center gap-2 active:scale-[0.98] transition-transform">
              {loading && <Loader2 className="w-4 h-4 animate-spin" />} Firmani ochish
            </button>
          )}
          {step === "done" && (
            <button onClick={onBack}
              className="w-full bg-primary text-white text-sm font-semibold py-3.5 rounded-xl min-h-[48px] active:scale-[0.98] transition-transform">
              Tizimga kirish
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
