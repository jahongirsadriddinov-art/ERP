import { useEffect, useState } from "react";
import {
  Building2, DollarSign, Users, MessageCircle, MapPin, Send,
  ChevronDown, CheckCircle, Smartphone, Laptop,
  FileSpreadsheet, ShieldCheck, Sparkles, ArrowRight, Layers,
  UserPlus, Settings2, Rocket, Globe2,
} from "lucide-react";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";
import LanguageSwitcher from "./i18n/LanguageSwitcher";
import { setSiteLanguage, SiteLang } from "./i18n";
import { AppDownloadCards } from "./AppDownload";

// ─── Marketing/reklama sahifasi — funksionallikka ega emas, faqat login/
// register'ga olib boradigan kirish nuqtasi. GoogleBot uchun ham, haqiqiy
// tashrif buyuruvchi uchun ham asosiy mazmun shu yerda (login formasi endi
// bunga aralashmaydi — LoginScreen o'zi alohida, toza qoladi). ────────────
//
// DIZAYN TILI (2026 yangilanish) — "muhandislik chizmasi" ("blueprint")
// mavzusi: qurilish sohasiga xos, umumiy SaaS shablonidan farq qiladigan
// ko'rinish. Uch unsur: (1) burchak-belgilar (CornerMarks) — arxitektura
// chizmalaridagi "crop mark"lar kabi, (2) xavfsizlik-chizig'i naqshi
// (HazardStripe) — qurilish maydonidagi ogohlantiruvchi lentaga ishora,
// firmaning o'z accent-rangida (D2440F), (3) monospace texnik yorliqlar —
// JetBrains Mono, chizma izohlari kabi. Ranglar mavjud tema tokenlaridan
// (--primary, --accent) olinadi — alohida rang qo'shilmadi, shu bilan
// ilovaning qolgan qismi (dashboard, tugmalar) bilan bir xil bo'lib qoladi.

const FEATURES = [
  { icon: FileSpreadsheet, title: "Loyihalar va smeta", desc: "Har bir obyekt, byudjet va bajarilish foizini bir joydan kuzating — Excel va qog'oz jadvallarsiz." },
  { icon: DollarSign, title: "Moliya nazorati", desc: "Chiqim, kirim va o'tkazmalarni real vaqtda ko'ring, tasdiqlash zanjiri bilan nazorat qiling." },
  { icon: Users, title: "Xodimlar va davomat", desc: "Ishga kelish/ketish, ishlagan soatlar va GPS orqali joylashuvni avtomatik hisoblang." },
  { icon: MessageCircle, title: "Real-time chat", desc: "Jamoa bilan tizim ichida to'g'ridan-to'g'ri yozishing — alohida messenjer shart emas." },
  { icon: Sparkles, title: "AI yordamchi", desc: "Loyiha va moliya bo'yicha savollaringizga sun'iy intellektdan tezkor javob oling." },
  { icon: Send, title: "Telegram integratsiyasi", desc: "Xodimlar ishga kelish, joylashuv va bildirishnomalarni Telegram bot orqali ham boshqarishadi." },
];

const AUDIENCE = [
  { icon: Building2, title: "Qurilish firmalari", desc: "Bir nechta obyektni bir vaqtda boshqaruvchi tashkilotlar" },
  { icon: ShieldCheck, title: "Pudratchi tashkilotlar", desc: "Subpudrat ishlarini va hisob-kitobni tartibga solish" },
  { icon: Users, title: "Remont-ta'mirlash jamoalari", desc: "Kichik jamoalar uchun sodda, tezkor boshqaruv" },
  { icon: MapPin, title: "Loyiha menejerlari", desc: "Bir nechta obyektni masofadan nazorat qilish" },
];

// Haqiqatan ham QurilishERP'dan foydalanadigan firmalar — faqat nom, soxta
// logotip yoki iqtibos (sharh) YO'Q. Ro'yxat mijoz/hamkor sonini ko'paytirish
// uchun sun'iy nom bilan to'ldirilmaydi — bu haqiqiy bo'lmagan mijozni
// ko'rsatish bo'lardi.
const PARTNERS = [
  "Jondor Iris Story MCHJ",
  "Alpha Plus Spektr MCHJ",
  "The Progressive Build Your Dreams24 MCHJ",
  "Buhoro Invest MCHJ",
];

const CAPABILITIES = [
  { value: "6+", label: "Asosiy modul", icon: Layers },
  { value: "3", label: "Platforma — veb, Android, Windows", icon: Smartphone },
  { value: "24/7", label: "Telegram bot orqali kirish", icon: Send },
  { value: "1-oy", label: "Bepul sinov muddati", icon: Rocket },
];

const STEPS = [
  { icon: UserPlus, title: "Ro'yxatdan o'ting", desc: "Firma ma'lumotlarini kiriting — kredit karta shart emas, bir necha daqiqa vaqt oladi." },
  { icon: Settings2, title: "Jamoangizni qo'shing", desc: "Xodimlaringizni taklif qiling, har biriga o'z roliga mos huquq beriladi." },
  { icon: Rocket, title: "Boshqarishni boshlang", desc: "Loyiha, moliya va xodimlarni bir joydan — veb, Android yoki Telegram orqali nazorat qiling." },
];

const BENEFITS = [
  { icon: CheckCircle, text: "Qog'oz va tarqoq Excel jadvallaridan bitta tizimga o'ting" },
  { icon: Smartphone, text: "Veb, Android ilova va Windows dasturi — istalgan qurilmadan kiring" },
  { icon: ShieldCheck, text: "Har bir firmaning ma'lumoti butunlay izolyatsiyalangan va xavfsiz" },
];

const FAQS = [
  { q: "Ma'lumotlarim xavfsizmi?", a: "Ha. Har bir firmaning ma'lumotlari bir-biridan to'liq izolyatsiyalangan — boshqa firma xodimlari sizning loyiha, moliya yoki xodimlaringizni hech qachon ko'ra olmaydi." },
  { q: "Necha kishi ishlata oladi?", a: "Direktor, o'rinbosar, prorab, brigadir va oddiy ishchilar — barcha xodimlaringizni tizimga qo'shishingiz mumkin, har biri o'z roliga mos huquqlarga ega bo'ladi." },
  { q: "Telegram bot orqali ham ishlaydimi?", a: "Ha — xodimlar ishga kelish/ketishni, joylashuvni va bildirishnomalarni Telegram bot orqali ham boshqarishlari mumkin, sayt yoki ilovaga kirmasdan ham." },
  { q: "Qanday boshlashim mumkin?", a: "\"Bepul boshlash\" tugmasini bosib, firmangizni bir necha daqiqada ro'yxatdan o'tkazasiz — birinchi oy bepul." },
];

function useYear() {
  return new Date().getFullYear();
}

function SectionBadge({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] font-bold tracking-wide uppercase text-primary bg-primary/10 px-3 py-1.5 rounded-full mb-4">
      {children}
    </span>
  );
}

// Arxitektura chizmalaridagi "crop mark" (burchak-belgi) — texnik chizma
// hissi beruvchi, faqat shu loyihaga xos bezak unsuri (umumiy SaaS
// shablonlarida uchramaydigan detal). Har doim ota elementga nisbatan
// mutlaq joylashadi — ota element `relative` bo'lishi shart.
function CornerMarks({ visible = true }: { visible?: boolean }) {
  const base = "absolute w-3.5 h-3.5 border-primary/50 dark:border-primary/60 liquid-transition";
  const cls = visible ? "opacity-100" : "opacity-0 group-hover:opacity-100";
  return (
    <div className="pointer-events-none absolute inset-2.5" aria-hidden="true">
      <span className={`${base} ${cls} -top-0 -left-0 border-t-2 border-l-2 rounded-tl-[3px]`} />
      <span className={`${base} ${cls} -top-0 -right-0 border-t-2 border-r-2 rounded-tr-[3px]`} />
      <span className={`${base} ${cls} -bottom-0 -left-0 border-b-2 border-l-2 rounded-bl-[3px]`} />
      <span className={`${base} ${cls} -bottom-0 -right-0 border-b-2 border-r-2 rounded-br-[3px]`} />
    </div>
  );
}

// Qurilish maydonidagi ogohlantiruvchi (xavfsizlik) lentasiga ishora —
// firmaning o'z accent-rangida diagonal chiziqlar. Sahifaning "imzosi":
// tepada va pastda ingichka chegara sifatida, bo'limlar orasida esa
// tikuv (seam) sifatida ishlatiladi — brendni tanish qiluvchi doimiy detal.
function HazardStripe({ className = "" }: { className?: string }) {
  return (
    <div
      className={`w-full pointer-events-none ${className}`}
      style={{
        height: 5,
        backgroundImage: "repeating-linear-gradient(135deg, var(--accent) 0px, var(--accent) 9px, color-mix(in srgb, var(--accent) 18%, transparent) 9px, color-mix(in srgb, var(--accent) 18%, transparent) 18px)",
      }}
      aria-hidden="true"
    />
  );
}

// Texnik izoh uslubidagi monospace yorliq — chizma annotatsiyasiga o'xshash.
function TechTag({ children }: { children: React.ReactNode }) {
  return (
    <span
      className="text-[10px] font-semibold tracking-[0.18em] uppercase text-accent"
      style={{ fontFamily: "'JetBrains Mono', ui-monospace, monospace" }}
    >
      {children}
    </span>
  );
}

export default function LandingPage({ onLogin, onRegister }: { onLogin: () => void; onRegister: () => void }) {
  const { t, i18n } = useTranslation();
  const [openFaq, setOpenFaq] = useState<number | null>(0);
  const year = useYear();

  // Landing sahifa doim OCHIQ (light) rejimda ko'rinsin — foydalanuvchining
  // dark tema tanlovi (yoki tizim tanlovi) bo'lsa ham. index.html'dagi FOUC
  // oldini olish skripti sahifa yuklanishida <html> ga "dark" klassini
  // qo'yadi — shu klassni faqat LandingPage ko'rsatilib turgan vaqtga
  // vaqtincha olib tashlaymiz, keyin (login/ilova ochilganda) foydalanuvchi
  // haqiqiy tanlovi qaytariladi.
  useEffect(() => {
    const root = document.documentElement;
    const hadDark = root.classList.contains('dark');
    const prevColorScheme = root.style.colorScheme;
    root.classList.remove('dark');
    root.style.colorScheme = 'light';
    return () => {
      if (hadDark) root.classList.add('dark');
      root.style.colorScheme = prevColorScheme;
    };
  }, []);

  return (
    <main className="h-[100dvh] overflow-y-auto scrollbar-hide bg-background overflow-x-hidden">
      {/* FAQPage structured data — Google'da savol-javoblar to'g'ridan-to'g'ri
          qidiruv natijasida (rich result) chiqishi uchun. FAQS massividan
          avtomatik hosil qilinadi — matn bilan sinxronlikdan chiqib
          qolmaydi. GoogleBot JS'ni bajarib bunday dinamik <script> teglarni
          ham o'qiydi (rasmiy hujjatlashtirilgan, statik bo'lishi shart emas). */}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify({
        "@context": "https://schema.org",
        "@type": "FAQPage",
        mainEntity: FAQS.map(f => ({
          "@type": "Question",
          name: f.q,
          acceptedAnswer: { "@type": "Answer", text: f.a },
        })),
      }) }} />

      {/* Sahifaning "imzosi" — xavfsizlik-lentasi chizig'i, eng tepada */}
      <HazardStripe className="sticky top-0 z-50" />

      {/* ── Sticky top nav ─────────────────────────────────────────────── */}
      <header className="sticky top-0 z-40 backdrop-blur-xl bg-background/70 border-b border-border/50"
        style={{ paddingTop: "env(safe-area-inset-top)" }}>
        <div className="max-w-6xl mx-auto px-5 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <img src="/favicon-96.png" alt="QurilishERP" className="w-9 h-9 rounded-xl shadow-md shadow-primary/20" />
            <span className="font-bold text-lg font-['Roboto_Slab',serif]">QurilishERP</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="hidden sm:block"><LanguageSwitcher size="sm" value={i18n.language as SiteLang} onChange={l => setSiteLanguage(l)} /></div>
            <button onClick={onLogin} className="btn btn-outline text-sm px-4 py-2 rounded-full font-semibold">Kirish</button>
            <button onClick={onRegister} className="btn btn-accent text-sm px-4 py-2 rounded-full font-semibold hidden sm:inline-flex">Bepul boshlash</button>
          </div>
        </div>
      </header>

      {/* ── Hero ────────────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden">
        {/* Blueprint chizma to'ri — kvadrat panjara, muhandislik chizmasi
            hissini beradi (avvalgi generik nuqtali "mesh" fon o'rniga). */}
        <div className="absolute inset-0 opacity-[0.5] dark:opacity-[0.3] pointer-events-none"
          style={{
            backgroundImage:
              "linear-gradient(color-mix(in srgb, var(--primary) 14%, transparent) 1px, transparent 1px), linear-gradient(90deg, color-mix(in srgb, var(--primary) 14%, transparent) 1px, transparent 1px)",
            backgroundSize: "40px 40px",
            maskImage: "radial-gradient(ellipse 75% 60% at 50% 0%, black 35%, transparent 100%)",
          }} />
        <div className="absolute top-[-18%] right-[-14%] w-[52%] h-[58%] bg-accent/[0.14] rounded-full blur-[150px] blob-anim pointer-events-none" />

        <div className="relative max-w-6xl mx-auto px-5 pt-16 pb-8 md:pt-24 text-center">
          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ type: "spring", stiffness: 260, damping: 26 }} className="relative z-10">
            <div className="mb-5">
              <TechTag>[ Qurilish firmalari uchun boshqaruv tizimi ]</TechTag>
            </div>
            <h1 className="text-4xl md:text-6xl lg:text-7xl font-bold font-['Roboto_Slab',serif] leading-[1.08] max-w-4xl mx-auto tracking-tight">
              <span className="text-foreground">Qurilish firmangizni</span>
              <br/>
              <span className="bg-clip-text text-transparent bg-gradient-to-r from-primary via-primary to-accent">bitta joydan boshqaring</span>
            </h1>
            {/* Aksent chiziqcha — sarlavha ostida, brend rangida, "muhr" kabi */}
            <div className="mx-auto mt-5 w-14 h-[3px] rounded-full bg-gradient-to-r from-primary to-accent" />
            <p className="text-base md:text-lg text-muted-foreground mt-6 max-w-xl mx-auto leading-relaxed">
              Loyihalar, smeta, moliya, xodimlar va GPS nazorati, real-time chat, AI yordamchi va Telegram bot —
              firmangizni raqamlashtirish uchun kerakli hammasi bitta tizimda.
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-3 mt-9">
              <button onClick={onRegister}
                className="group w-full sm:w-auto bg-gradient-to-r from-primary via-primary to-blue-700 text-white text-sm font-bold px-8 py-4 rounded-full shadow-xl shadow-primary/30 hover:shadow-2xl hover:shadow-primary/40 hover:-translate-y-0.5 active:scale-[0.98] liquid-transition flex items-center justify-center gap-2">
                Bepul boshlash <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 liquid-transition" />
              </button>
              <button onClick={onLogin}
                className="w-full sm:w-auto btn btn-outline text-sm font-semibold px-8 py-4 rounded-full">
                Hisobga kirish
              </button>
            </div>
            <p className="text-xs text-muted-foreground mt-4">
              Kredit karta talab qilinmaydi · Birinchi oy bepul · Bir necha daqiqada sozlanadi
            </p>
          </motion.div>

          {/* Stilizatsiyalangan dashboard ko'rinishi (real skrinshot emas — namunaviy illyustratsiya).
              Burchak-belgilar chizma varag'i ko'rinishini beradi. */}
          <motion.div initial={{ opacity: 0, y: 32 }} animate={{ opacity: 1, y: 0 }} transition={{ type: "spring", stiffness: 220, damping: 28, delay: 0.15 }}
            className="relative z-10 mt-14 max-w-3xl mx-auto">
            <div className="absolute -inset-1 bg-gradient-to-br from-primary/25 via-accent/15 to-transparent rounded-[2.2rem] blur-2xl opacity-60 pointer-events-none" />
            <div className="relative surface rounded-[2rem] p-5 md:p-7 text-left shadow-2xl shadow-primary/10 border border-white/20">
              <CornerMarks />
              <div className="flex items-center justify-between mb-5">
                <div>
                  <TechTag>Obyekt · namuna</TechTag>
                  <p className="font-bold text-sm mt-1">"Bog'bo'ston" turar-joy majmuasi</p>
                </div>
                <span className="text-[10px] font-bold px-2.5 py-1 rounded-full bg-green-500/15 text-green-700 dark:text-green-400 flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" /> Bajarilmoqda
                </span>
              </div>
              <div className="grid grid-cols-3 gap-3 mb-5">
                {[["Byudjet", "18.0 mlrd"], ["Ishlatilgan", "9.4 mlrd"], ["Bajarildi", "52%"]].map(([label, val]) => (
                  <div key={label} className="bg-muted/40 rounded-2xl p-3 text-center">
                    <p className="text-[10px] text-muted-foreground mb-1">{label}</p>
                    <p className="font-bold text-sm md:text-base" style={{ fontFamily: "'JetBrains Mono', ui-monospace, monospace" }}>{val}</p>
                  </div>
                ))}
              </div>
              <div className="w-full h-2.5 rounded-full bg-muted overflow-hidden">
                <motion.div initial={{ width: 0 }} animate={{ width: "52%" }} transition={{ duration: 1.2, delay: 0.4, ease: "easeOut" }}
                  className="h-full rounded-full bg-gradient-to-r from-accent to-accent/70" />
              </div>
              <div className="flex items-center gap-3 mt-5 pt-4 border-t border-border/50">
                <div className="flex -space-x-2">
                  {[0,1,2].map(i => <div key={i} className="w-7 h-7 rounded-full bg-gradient-to-br from-primary to-accent border-2 border-background" />)}
                </div>
                <p className="text-xs text-muted-foreground">Jamoa loyihada birga ishlamoqda</p>
              </div>
            </div>
          </motion.div>
        </div>

        {/* Imkoniyatlar chizig'i — haqiqiy, tekshirsa bo'ladigan faktlar (soxta statistika emas) */}
        <div className="relative max-w-5xl mx-auto px-5 pb-16 md:pb-20 mt-10">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {CAPABILITIES.map((c, i) => (
              <motion.div key={c.label} initial={{ opacity: 0, y: 12 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}
                transition={{ delay: i * 0.06 }}
                className="group relative surface rounded-2xl px-4 py-4 text-center overflow-hidden">
                <div className="absolute top-0 left-0 right-0 h-[3px] opacity-0 group-hover:opacity-100 liquid-transition"
                  style={{ backgroundImage: "repeating-linear-gradient(135deg, var(--accent) 0px, var(--accent) 6px, transparent 6px, transparent 12px)" }} />
                <c.icon className="w-4 h-4 text-primary mx-auto mb-2 opacity-70" />
                <p className="text-xl md:text-2xl font-bold" style={{ fontFamily: "'JetBrains Mono', ui-monospace, monospace" }}>{c.value}</p>
                <p className="text-[10px] md:text-[11px] text-muted-foreground mt-1 leading-snug">{c.label}</p>
              </motion.div>
            ))}
          </div>
        </div>

        {/* Bizga ishonch bildirgan firmalar — "plastinka" (plate) uslubi:
            po'lat lavhaga o'xshash, texnik ID bilan — soddagina icon+nom
            kartochkasidan farqli, brendga xos ko'rinish. Faqat nom, soxta
            logotip/sharh yo'q. */}
        <div className="relative max-w-5xl mx-auto px-5 pb-16 md:pb-20">
          <p className="text-center text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-6">Bizga ishonch bildirgan firmalar</p>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {PARTNERS.map((name, i) => (
              <motion.div key={name} initial={{ opacity: 0, y: 12 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}
                transition={{ delay: i * 0.06 }}
                className="relative surface rounded-2xl p-5 flex flex-col items-center text-center gap-3 hover:-translate-y-1 liquid-transition overflow-hidden">
                <span className="absolute top-2.5 right-3 text-[9px] text-muted-foreground/60" style={{ fontFamily: "'JetBrains Mono', ui-monospace, monospace" }}>
                  #{String(i + 1).padStart(2, "0")}
                </span>
                <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-primary/15 to-accent/15 flex items-center justify-center flex-shrink-0">
                  <Building2 className="w-5 h-5 text-primary" />
                </div>
                <p className="text-sm font-bold text-foreground leading-snug">{name}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      <HazardStripe />

      {/* ── Features ────────────────────────────────────────────────────── */}
      <section className="max-w-6xl mx-auto px-5 py-16 md:py-24">
        <div className="text-center max-w-xl mx-auto mb-12">
          <SectionBadge>Imkoniyatlar</SectionBadge>
          <h2 className="text-2xl md:text-4xl font-bold font-['Roboto_Slab',serif] tracking-tight">Bitta tizim, hamma narsa nazoratda</h2>
          <p className="text-sm text-muted-foreground mt-3">Qurilish firmasini boshqarish uchun kerakli barcha vositalar</p>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {FEATURES.map((f, i) => (
            <motion.div key={f.title} initial={{ opacity: 0, y: 16 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: "-40px" }}
              transition={{ delay: i * 0.05, type: "spring", stiffness: 260, damping: 26 }}
              className="group relative surface rounded-3xl p-6 overflow-hidden hover:-translate-y-1 hover:shadow-xl hover:shadow-primary/10 liquid-transition">
              <CornerMarks visible={false} />
              <div className="absolute -right-6 -top-6 w-24 h-24 rounded-full bg-primary/5 group-hover:bg-primary/10 liquid-transition pointer-events-none" />
              <div className="relative w-12 h-12 rounded-2xl bg-gradient-to-br from-primary to-primary/70 flex items-center justify-center mb-4 shadow-md shadow-primary/25">
                <f.icon className="w-5.5 h-5.5 text-white" />
              </div>
              <h3 className="relative font-bold text-sm mb-1.5">{f.title}</h3>
              <p className="relative text-sm text-muted-foreground leading-relaxed">{f.desc}</p>
            </motion.div>
          ))}
        </div>
      </section>

      {/* ── Qanday ishlaydi ─────────────────────────────────────────────── */}
      <section className="relative bg-muted/30 py-16 md:py-24 overflow-hidden">
        <div className="absolute inset-0 opacity-[0.4] dark:opacity-[0.2] pointer-events-none"
          style={{
            backgroundImage:
              "linear-gradient(color-mix(in srgb, var(--primary) 10%, transparent) 1px, transparent 1px), linear-gradient(90deg, color-mix(in srgb, var(--primary) 10%, transparent) 1px, transparent 1px)",
            backgroundSize: "40px 40px",
            maskImage: "radial-gradient(ellipse 80% 100% at 50% 50%, black 30%, transparent 100%)",
          }} />
        <div className="relative max-w-5xl mx-auto px-5">
          <div className="text-center max-w-xl mx-auto mb-14">
            <SectionBadge>Boshlash oson</SectionBadge>
            <h2 className="text-2xl md:text-4xl font-bold font-['Roboto_Slab',serif] tracking-tight">3 qadamda ishga tushiring</h2>
          </div>
          <div className="grid md:grid-cols-3 gap-8 relative">
            <div className="hidden md:block absolute top-7 left-[16.5%] right-[16.5%] h-px bg-gradient-to-r from-primary/40 via-accent/40 to-primary/40" />
            {STEPS.map((s, i) => (
              <motion.div key={s.title} initial={{ opacity: 0, y: 16 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: "-40px" }}
                transition={{ delay: i * 0.1 }} className="relative text-center">
                <div className="relative z-10 w-14 h-14 rounded-2xl bg-gradient-to-br from-primary to-accent flex items-center justify-center mx-auto mb-5 shadow-lg shadow-primary/25">
                  <s.icon className="w-6 h-6 text-white" />
                </div>
                <p className="text-[11px] font-bold text-accent mb-1.5" style={{ fontFamily: "'JetBrains Mono', ui-monospace, monospace" }}>QADAM {i + 1} / {STEPS.length}</p>
                <h3 className="font-bold text-sm mb-2">{s.title}</h3>
                <p className="text-xs text-muted-foreground leading-relaxed max-w-[240px] mx-auto">{s.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Kimlar uchun ────────────────────────────────────────────────── */}
      <section className="max-w-6xl mx-auto px-5 py-16 md:py-24">
        <div className="text-center max-w-xl mx-auto mb-12">
          <SectionBadge>Kimlar uchun</SectionBadge>
          <h2 className="text-2xl md:text-4xl font-bold font-['Roboto_Slab',serif] tracking-tight">Har qanday hajmdagi tashkilot uchun</h2>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {AUDIENCE.map((a, i) => (
            <motion.div key={a.title} initial={{ opacity: 0, y: 16 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: "-40px" }}
              transition={{ delay: i * 0.05, type: "spring", stiffness: 260, damping: 26 }}
              className="group relative surface rounded-3xl p-6 text-center hover:-translate-y-1 hover:shadow-xl hover:shadow-accent/10 liquid-transition overflow-hidden">
              <CornerMarks visible={false} />
              <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-accent to-accent/70 flex items-center justify-center mx-auto mb-4 shadow-md shadow-accent/25">
                <a.icon className="w-6 h-6 text-white" />
              </div>
              <h3 className="font-bold text-sm mb-1.5">{a.title}</h3>
              <p className="text-xs text-muted-foreground leading-relaxed">{a.desc}</p>
            </motion.div>
          ))}
        </div>
      </section>

      {/* ── Benefits strip ──────────────────────────────────────────────── */}
      <section className="bg-muted/30 py-16 md:py-20">
        <div className="max-w-6xl mx-auto px-5">
          <div className="grid md:grid-cols-3 gap-6">
            {BENEFITS.map(b => (
              <div key={b.text} className="flex items-start gap-3.5 surface rounded-2xl p-5">
                <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                  <b.icon className="w-4.5 h-4.5 text-primary" />
                </div>
                <p className="text-sm text-foreground/90 leading-relaxed pt-1">{b.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── FAQ ─────────────────────────────────────────────────────────── */}
      <section className="max-w-3xl mx-auto px-5 py-16 md:py-24">
        <div className="text-center mb-10">
          <SectionBadge>Savol-javob</SectionBadge>
          <h2 className="text-2xl md:text-4xl font-bold font-['Roboto_Slab',serif] tracking-tight">Ko'p beriladigan savollar</h2>
        </div>
        <div className="space-y-3">
          {FAQS.map((f, i) => (
            <div key={f.q} className={`surface rounded-2xl overflow-hidden liquid-transition ${openFaq === i ? "ring-1 ring-primary/30" : ""}`}>
              <button onClick={() => setOpenFaq(openFaq === i ? null : i)}
                className="w-full flex items-center justify-between gap-3 px-5 py-4 text-left">
                <span className="font-semibold text-sm">{f.q}</span>
                <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 liquid-transition ${openFaq === i ? "bg-primary text-white rotate-180" : "bg-muted text-muted-foreground"}`}>
                  <ChevronDown className="w-4 h-4" />
                </div>
              </button>
              {openFaq === i && (
                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}>
                  <p className="px-5 pb-4 text-sm text-muted-foreground leading-relaxed">{f.a}</p>
                </motion.div>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* ── Ilovani yuklab olish — mavjud bo'lsagina ko'rinadi (CI hali birorta
          ham APK/exe chiqarmagan bo'lsa, AppDownloadCards hech narsa
          render qilmaydi — bo'sh bo'lim ko'rsatilmaydi). ───────────────── */}
      <section className="max-w-3xl mx-auto px-5 pb-16">
        <div className="text-center mb-8">
          <h2 className="text-2xl md:text-4xl font-bold font-['Roboto_Slab',serif] tracking-tight">Ilovani yuklab oling</h2>
          <p className="text-muted-foreground text-sm md:text-base mt-3 max-w-xl mx-auto">Telefon yoki kompyuteringizga o'rnating — brauzerda ham to'liq ishlaydi, ilova ixtiyoriy qulaylik uchun.</p>
        </div>
        <AppDownloadCards />
      </section>

      {/* ── Final CTA ───────────────────────────────────────────────────── */}
      <section className="max-w-5xl mx-auto px-5 pb-20">
        <div className="relative overflow-hidden rounded-[2.5rem] bg-gradient-to-br from-primary via-primary to-blue-800 px-6 py-14 md:py-20 text-center">
          <div className="absolute inset-0 opacity-[0.15] pointer-events-none"
            style={{ backgroundImage: "radial-gradient(white 1px, transparent 1px)", backgroundSize: "24px 24px" }} />
          <div className="absolute top-[-30%] right-[-10%] w-[55%] h-[90%] bg-accent/30 rounded-full blur-[110px] pointer-events-none" />
          <div className="absolute bottom-[-30%] left-[-10%] w-[45%] h-[80%] bg-white/10 rounded-full blur-[110px] pointer-events-none" />
          <div className="relative z-10 w-14 h-14 rounded-2xl bg-white/15 backdrop-blur-sm flex items-center justify-center mx-auto mb-6 border border-white/20">
            <Globe2 className="w-7 h-7 text-white" />
          </div>
          <h2 className="relative z-10 text-3xl md:text-4xl font-bold font-['Roboto_Slab',serif] text-white max-w-lg mx-auto tracking-tight">
            Firmangizni bugun raqamlashtiring
          </h2>
          <p className="relative z-10 text-sm md:text-base text-white/80 mt-4 max-w-md mx-auto">
            Ro'yxatdan o'ting, birinchi oy bepul — kredit karta shart emas.
          </p>
          <button onClick={onRegister}
            className="relative z-10 mt-8 bg-white text-primary text-sm font-bold px-8 py-4 rounded-full shadow-2xl hover:-translate-y-0.5 hover:shadow-white/20 active:scale-[0.98] liquid-transition inline-flex items-center gap-2">
            Bepul boshlash <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </section>

      {/* ── Footer ──────────────────────────────────────────────────────── */}
      <HazardStripe />
      <footer className="border-t border-border/50 py-10" style={{ paddingBottom: "max(2.5rem, env(safe-area-inset-bottom))" }}>
        <div className="max-w-6xl mx-auto px-5 flex flex-col md:flex-row items-center justify-between gap-5">
          <div className="flex items-center gap-2.5">
            <img src="/favicon-48.png" alt="QurilishERP" className="w-7 h-7 rounded-lg" />
            <span className="font-bold text-sm">QurilishERP</span>
            <span className="text-xs text-muted-foreground">© {year}</span>
          </div>
          <div className="flex items-center gap-5 text-xs text-muted-foreground">
            <a href="https://t.me/qurilish_erp_bot" target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 hover:text-foreground liquid-transition">
              <Send className="w-3.5 h-3.5" /> @qurilish_erp_bot
            </a>
            <a href="https://t.me/Sadriddinov_Jahongir" target="_blank" rel="noopener noreferrer" className="hover:text-foreground liquid-transition">
              Aloqa
            </a>
          </div>
        </div>
      </footer>
    </main>
  );
}
