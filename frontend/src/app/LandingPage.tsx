import { useState } from "react";
import {
  Building2, DollarSign, Users, MessageCircle, MapPin, Send,
  ChevronDown, CheckCircle, Smartphone, Laptop,
  FileSpreadsheet, ShieldCheck, Sparkles, ArrowRight,
} from "lucide-react";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";
import LanguageSwitcher from "./i18n/LanguageSwitcher";
import { setSiteLanguage, SiteLang } from "./i18n";

// ─── Marketing/reklama sahifasi — funksionallikka ega emas, faqat login/
// register'ga olib boradigan kirish nuqtasi. GoogleBot uchun ham, haqiqiy
// tashrif buyuruvchi uchun ham asosiy mazmun shu yerda (login formasi endi
// bunga aralashmaydi — LoginScreen o'zi alohida, toza qoladi). ────────────

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
  // Date.now()/new Date() build-vaqtida emas, faqat render paytida — bu
  // oddiy client komponent, workflow cheklovi bunga taalluqli emas.
  return new Date().getFullYear();
}

export default function LandingPage({ onLogin, onRegister }: { onLogin: () => void; onRegister: () => void }) {
  const { t, i18n } = useTranslation();
  const [openFaq, setOpenFaq] = useState<number | null>(0);
  const year = useYear();

  return (
    <main className="min-h-[100dvh] bg-background overflow-x-hidden">
      {/* ── Sticky top nav ─────────────────────────────────────────────── */}
      <header className="sticky top-0 z-40 backdrop-blur-xl bg-background/70 border-b border-border/50"
        style={{ paddingTop: "env(safe-area-inset-top)" }}>
        <div className="max-w-6xl mx-auto px-5 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-primary to-primary/80 flex items-center justify-center shadow-md shadow-primary/20">
              <Building2 className="w-5 h-5 text-white" />
            </div>
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
      <section className="relative max-w-6xl mx-auto px-5 pt-16 pb-20 md:pt-24 md:pb-28 text-center">
        <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] bg-primary/15 rounded-full blur-[140px] blob-anim pointer-events-none" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] bg-accent/15 rounded-full blur-[140px] blob-anim-slow pointer-events-none" />

        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ type: "spring", stiffness: 260, damping: 26 }} className="relative z-10">
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary bg-primary/10 px-3 py-1.5 rounded-full mb-5">
            <Sparkles className="w-3.5 h-3.5" /> Qurilish firmalari uchun boshqaruv tizimi
          </span>
          <h1 className="text-4xl md:text-6xl font-bold font-['Roboto_Slab',serif] leading-[1.1] max-w-3xl mx-auto bg-clip-text text-transparent bg-gradient-to-r from-foreground to-foreground/70">
            Qurilish firmangizni bitta joydan boshqaring
          </h1>
          <p className="text-base md:text-lg text-muted-foreground mt-5 max-w-xl mx-auto leading-relaxed">
            Loyihalar, smeta, moliya, xodimlar va GPS nazorati, real-time chat, AI yordamchi va Telegram bot —
            firmangizni raqamlashtirish uchun kerakli hammasi bitta tizimda.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 mt-8">
            <button onClick={onRegister}
              className="w-full sm:w-auto bg-gradient-to-r from-primary via-primary to-blue-700 text-white text-sm font-bold px-7 py-3.5 rounded-full shadow-lg shadow-primary/30 hover:shadow-xl hover:shadow-primary/35 hover:-translate-y-0.5 active:scale-[0.98] liquid-transition flex items-center justify-center gap-2">
              Bepul boshlash <ArrowRight className="w-4 h-4" />
            </button>
            <button onClick={onLogin}
              className="w-full sm:w-auto btn btn-outline text-sm font-semibold px-7 py-3.5 rounded-full">
              Hisobga kirish
            </button>
          </div>
          <p className="text-xs text-muted-foreground mt-4">
            Kredit karta talab qilinmaydi · Birinchi oy bepul · Bir necha daqiqada sozlanadi
          </p>
        </motion.div>

        {/* Stilizatsiyalangan dashboard ko'rinishi (real skrinshot emas — namunaviy illyustratsiya) */}
        <motion.div initial={{ opacity: 0, y: 28 }} animate={{ opacity: 1, y: 0 }} transition={{ type: "spring", stiffness: 240, damping: 28, delay: 0.15 }}
          className="relative z-10 mt-14 max-w-3xl mx-auto surface rounded-[2rem] p-5 md:p-7 text-left shadow-2xl shadow-primary/10">
          <div className="flex items-center justify-between mb-5">
            <div>
              <p className="text-xs text-muted-foreground">Obyekt</p>
              <p className="font-bold text-sm">"Do'stlik" turar-joy majmuasi</p>
            </div>
            <span className="text-[10px] font-bold px-2.5 py-1 rounded-full bg-green-500/15 text-green-700 dark:text-green-400">Bajarilmoqda</span>
          </div>
          <div className="grid grid-cols-3 gap-3 mb-5">
            {[["Byudjet", "32.0 mlrd"], ["Ishlatilgan", "4.36 mlrd"], ["Bajarildi", "33%"]].map(([label, val]) => (
              <div key={label} className="bg-muted/40 rounded-2xl p-3 text-center">
                <p className="text-[10px] text-muted-foreground mb-1">{label}</p>
                <p className="font-bold text-sm md:text-base font-mono">{val}</p>
              </div>
            ))}
          </div>
          <div className="w-full h-2.5 rounded-full bg-muted overflow-hidden">
            <motion.div initial={{ width: 0 }} animate={{ width: "33%" }} transition={{ duration: 1.2, delay: 0.4, ease: "easeOut" }}
              className="h-full rounded-full bg-gradient-to-r from-accent to-accent/70" />
          </div>
          <div className="flex items-center gap-3 mt-5 pt-4 border-t border-border/50">
            <div className="flex -space-x-2">
              {[0,1,2].map(i => <div key={i} className="w-7 h-7 rounded-full bg-gradient-to-br from-primary to-accent border-2 border-background" />)}
            </div>
            <p className="text-xs text-muted-foreground">Jamoa loyihada birga ishlamoqda</p>
          </div>
        </motion.div>
      </section>

      {/* ── Features ────────────────────────────────────────────────────── */}
      <section className="max-w-6xl mx-auto px-5 py-16 md:py-20">
        <div className="text-center max-w-xl mx-auto mb-12">
          <h2 className="text-2xl md:text-3xl font-bold font-['Roboto_Slab',serif]">Bitta tizim, hamma narsa nazoratda</h2>
          <p className="text-sm text-muted-foreground mt-2.5">Qurilish firmasini boshqarish uchun kerakli barcha vositalar</p>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {FEATURES.map((f, i) => (
            <motion.div key={f.title} initial={{ opacity: 0, y: 16 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: "-40px" }}
              transition={{ delay: i * 0.05, type: "spring", stiffness: 260, damping: 26 }}
              className="surface rounded-3xl p-6">
              <div className="w-11 h-11 rounded-2xl bg-primary/10 flex items-center justify-center mb-4">
                <f.icon className="w-5 h-5 text-primary" />
              </div>
              <h3 className="font-bold text-sm mb-1.5">{f.title}</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">{f.desc}</p>
            </motion.div>
          ))}
        </div>
      </section>

      {/* ── Kimlar uchun ────────────────────────────────────────────────── */}
      <section className="bg-muted/30 py-16 md:py-20">
        <div className="max-w-6xl mx-auto px-5">
          <div className="text-center max-w-xl mx-auto mb-12">
            <h2 className="text-2xl md:text-3xl font-bold font-['Roboto_Slab',serif]">Kimlar uchun mo'ljallangan</h2>
            <p className="text-sm text-muted-foreground mt-2.5">Har qanday hajmdagi qurilish tashkiloti uchun</p>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {AUDIENCE.map((a, i) => (
              <motion.div key={a.title} initial={{ opacity: 0, y: 16 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: "-40px" }}
                transition={{ delay: i * 0.05, type: "spring", stiffness: 260, damping: 26 }}
                className="bg-background rounded-3xl p-6 text-center border border-border/50">
                <div className="w-12 h-12 rounded-2xl bg-accent/10 flex items-center justify-center mx-auto mb-4">
                  <a.icon className="w-6 h-6 text-accent" />
                </div>
                <h3 className="font-bold text-sm mb-1.5">{a.title}</h3>
                <p className="text-xs text-muted-foreground leading-relaxed">{a.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Benefits strip ──────────────────────────────────────────────── */}
      <section className="max-w-6xl mx-auto px-5 py-16 md:py-20">
        <div className="grid md:grid-cols-3 gap-6">
          {BENEFITS.map(b => (
            <div key={b.text} className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                <b.icon className="w-4.5 h-4.5 text-primary" />
              </div>
              <p className="text-sm text-foreground/90 leading-relaxed pt-1.5">{b.text}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── FAQ ─────────────────────────────────────────────────────────── */}
      <section className="max-w-3xl mx-auto px-5 py-16 md:py-20">
        <h2 className="text-2xl md:text-3xl font-bold font-['Roboto_Slab',serif] text-center mb-10">Ko'p beriladigan savollar</h2>
        <div className="space-y-3">
          {FAQS.map((f, i) => (
            <div key={f.q} className="surface rounded-2xl overflow-hidden">
              <button onClick={() => setOpenFaq(openFaq === i ? null : i)}
                className="w-full flex items-center justify-between gap-3 px-5 py-4 text-left">
                <span className="font-semibold text-sm">{f.q}</span>
                <ChevronDown className={`w-4 h-4 text-muted-foreground flex-shrink-0 liquid-transition ${openFaq === i ? "rotate-180" : ""}`} />
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

      {/* ── Final CTA ───────────────────────────────────────────────────── */}
      <section className="max-w-5xl mx-auto px-5 pb-20">
        <div className="relative overflow-hidden rounded-[2.5rem] bg-gradient-to-br from-primary to-primary/80 px-6 py-14 md:py-16 text-center">
          <div className="absolute top-[-20%] right-[-10%] w-[50%] h-[80%] bg-accent/20 rounded-full blur-[100px] pointer-events-none" />
          <Laptop className="w-8 h-8 text-white/70 mx-auto mb-5 relative z-10" />
          <h2 className="relative z-10 text-2xl md:text-3xl font-bold font-['Roboto_Slab',serif] text-white max-w-lg mx-auto">
            Firmangizni bugun raqamlashtiring
          </h2>
          <p className="relative z-10 text-sm text-white/80 mt-3 max-w-md mx-auto">
            Ro'yxatdan o'ting, birinchi oy bepul — kredit karta shart emas.
          </p>
          <button onClick={onRegister}
            className="relative z-10 mt-7 bg-white text-primary text-sm font-bold px-7 py-3.5 rounded-full shadow-xl hover:-translate-y-0.5 active:scale-[0.98] liquid-transition inline-flex items-center gap-2">
            Bepul boshlash <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </section>

      {/* ── Footer ──────────────────────────────────────────────────────── */}
      <footer className="border-t border-border/50 py-10">
        <div className="max-w-6xl mx-auto px-5 flex flex-col md:flex-row items-center justify-between gap-5">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-primary to-primary/80 flex items-center justify-center">
              <Building2 className="w-3.5 h-3.5 text-white" />
            </div>
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
