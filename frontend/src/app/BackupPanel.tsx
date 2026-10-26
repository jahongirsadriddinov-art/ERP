import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { MorphIcon } from "morphicons/react";
import RefreshCw from "@hugeicons/core-free-icons/Refresh01Icon";
import { toast } from "sonner";
import { API_BASE } from "./api";
import { SkeletonList } from "./Skeleton";

// Dasturchi paneli → "Zaxira" (owner 2026-10-26: "serverda biror narsa bo'lsa ma'lumot boshqa joyda turishi kerak").
// Backend: services/offsiteBackup + routes/devBackup.ts. Ko'rsatiladi: har bir manzil (S3/R2 va Telegram) bo'yicha
// oxirgi muvaffaqiyatli zaxira vaqti/hajmi, keyingi avtomatik ish, xatolar, sozlash ro'yxati (env nomlari bilan),
// "Hozir zaxira olish", arxivlar ro'yxati va TIKLASH (sinov → tasdiq kodi → tiklash).

type TargetState = {
  configured: boolean; endpoint?: string | null; bucket?: string | null; prefix?: string; chatSource?: string | null; disabled?: boolean;
  lastSuccessAt: string | null; lastSuccessSize: number | null; lastSuccessReason: string | null; lastFailureAt: string | null; lastError: string | null;
};
type RunView = {
  id: string; kind: string; scope: string; companyId?: string; companyName?: string; reason: string; reasonLabel: string; scheduled: boolean;
  status: "running" | "ok" | "partial" | "failed"; startedAt: string; finishedAt?: string; sizeBytes?: number; totalDocs?: number; error?: string; by?: string;
  targets: { target: string; ok: boolean; error?: string; at: string; parts?: number }[];
  restore?: { mode: string; totals: Totals; preRunId?: string; source?: string };
};
type Status = {
  now: string;
  encryption: { configured: boolean; source: string | null; keyId: string | null; weak: boolean };
  targets: { s3: TargetState; telegram: TargetState };
  schedule: { hourTashkent: number; nextRunAt: string; retention: { daily: number; weekly: number; monthly: number } };
  lastSuccessAt: string | null; stale: boolean;
  recent: RunView[]; failures: RunView[];
  checklist: { key: string; ok: boolean; required: boolean; note?: string }[];
};
type Source = { type: "s3"; key: string } | { type: "telegram"; runId: string } | { type: "upload"; token: string };
type Archive = {
  id: string; source: Source; createdAt: string | null; sizeBytes: number; scope: "full" | "company"; companyId?: string; companyName?: string;
  reason: string; reasonLabel: string; totalDocs?: number; collections?: Record<string, number>; companies?: { id: string; name: string; docs: number }[];
};
type Diff = { archive: number; current: number; add: number; update: number; remove: number };
type Totals = Diff & { written: number; deleted: number; errors: number };
type Preview = { collections: Record<string, Diff>; totals: Totals; confirmCode: string; contentOk: boolean | null; manifest?: { createdAt?: string; appVersion?: string | null; companyName?: string } | null };

const fmtDate = (v?: string | null) => (v ? new Date(v).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—");
const fmtSize = (n?: number | null) => (!n ? "—" : n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const ago = (v?: string | null) => {
  if (!v) return null;
  const h = Math.floor((Date.now() - new Date(v).getTime()) / 3600_000);
  return h < 1 ? "hozir" : h < 24 ? `${h} soat oldin` : `${Math.floor(h / 24)} kun oldin`;
};
const STATUS_TONE: Record<string, string> = {
  ok: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/25",
  partial: "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/25",
  failed: "bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/25",
  running: "bg-sky-500/10 text-sky-700 dark:text-sky-300 border-sky-500/25",
};

const R2_STEPS = [
  "dash.cloudflare.com'ga kiring (bepul hisob yetarli) → chap menyuda R2.",
  "“Create bucket” — nom: erp-zaxira, joy: Automatic. Bu — BACKUP_S3_BUCKET.",
  "R2 → “Manage R2 API Tokens” → “Create API token”: ruxsat “Object Read & Write”, faqat shu bucket uchun.",
  "Token yaratilgach ko'rsatiladi: Access Key ID → BACKUP_S3_ACCESS_KEY_ID, Secret Access Key → BACKUP_S3_SECRET_ACCESS_KEY (bir marta ko'rinadi, saqlab qo'ying).",
  "O'sha oynada “S3 API” manzili bor: https://<hisob-id>.r2.cloudflarestorage.com → BACKUP_S3_ENDPOINT. BACKUP_S3_REGION = auto.",
  "Render → backend xizmati → Environment: shu 5 ta qiymatni va BACKUP_ENCRYPTION_KEY (uzun tasodifiy parol — SHU KALITSIZ arxivlar ochilmaydi, uni Telegram'da o'zingizga yuborib saqlang) qo'shing → Save (server qayta ishga tushadi).",
  "Shu sahifaga qaytib “Hozir zaxira olish” ni bosing — ikkala manzilda ham ✅ paydo bo'lishi kerak.",
];

export default function BackupPanel() {
  const { t } = useTranslation();
  const [st, setSt] = useState<Status | null>(null);
  const [busy, setBusy] = useState("");
  const [archives, setArchives] = useState<Archive[] | null>(null);
  const [s3Error, setS3Error] = useState<string | undefined>();
  const [sel, setSel] = useState<Archive | null>(null);
  const [scope, setScope] = useState<"full" | "company">("full");
  const [companyId, setCompanyId] = useState("");
  const [mode, setMode] = useState<"upsert" | "exact">("upsert");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [confirmText, setConfirmText] = useState("");
  const [showSetup, setShowSetup] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const loadStatus = useCallback(async () => {
    try {
      const r = await fetch(`${API_BASE}/api/dev/backup/status`, { cache: "no-store" });
      if (r.ok) setSt(await r.json());
    } catch { /* tarmoq — keyingi yangilashda */ }
  }, []);
  const loadArchives = useCallback(async () => {
    try {
      const r = await fetch(`${API_BASE}/api/dev/backup/archives`, { cache: "no-store" });
      const j = await r.json().catch(() => null);
      if (r.ok && j) { setArchives(Array.isArray(j.items) ? j.items : []); setS3Error(j.s3Error); }
      else setArchives([]);
    } catch { setArchives([]); }
  }, []);

  useEffect(() => { void loadStatus(); void loadArchives(); }, [loadStatus, loadArchives]);
  useEffect(() => {
    const iv = window.setInterval(() => void loadStatus(), 60_000);
    return () => window.clearInterval(iv);
  }, [loadStatus]);

  const resetRestore = () => { setSel(null); setPreview(null); setConfirmText(""); setScope("full"); setCompanyId(""); setMode("upsert"); };

  const runNow = async () => {
    setBusy("run");
    try {
      const r = await fetch(`${API_BASE}/api/dev/backup/run`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { toast.error(j.error || t("common.error")); return; }
      toast.success(t("backupPanel.started", "Zaxira olinmoqda — manzillarga yuborilgach ro'yxatda ko'rinadi"));
      window.setTimeout(() => { void loadStatus(); void loadArchives(); }, 6000);
    } finally { setBusy(""); }
  };

  const pick = (a: Archive) => {
    setSel(a); setPreview(null); setConfirmText("");
    setScope(a.scope === "company" ? "company" : "full");
    setCompanyId(a.scope === "company" ? String(a.companyId || "") : "");
    setMode("upsert");
  };

  const uploadFiles = async (files: FileList) => {
    setBusy("upload");
    try {
      const fd = new FormData();
      for (const f of Array.from(files)) fd.append("files", f);
      const r = await fetch(`${API_BASE}/api/dev/backup/upload`, { method: "POST", body: fd });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { toast.error(j.error || t("common.error")); return; }
      const m = j.manifest || {};
      pick({ id: `upload:${j.source.token}`, source: j.source, createdAt: m.createdAt || null, sizeBytes: j.sizeBytes, scope: m.scope === "company" ? "company" : "full",
        companyId: m.companyId, companyName: m.companyName, reason: m.reason || "upload", reasonLabel: t("backupPanel.uploaded", "Yuklangan fayl"), totalDocs: m.totalDocs, collections: m.collections, companies: m.companies });
      toast.success(t("backupPanel.fileReady", "Fayl o'qildi — endi sinov qiling"));
    } finally { setBusy(""); }
  };

  const doPreview = async () => {
    if (!sel) return;
    setBusy("preview");
    try {
      const r = await fetch(`${API_BASE}/api/dev/backup/preview`, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: sel.source, scope, companyId: scope === "company" ? companyId : undefined, mode }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { toast.error(j.error || t("common.error")); return; }
      setPreview(j); setConfirmText("");
    } finally { setBusy(""); }
  };

  const doRestore = async () => {
    if (!sel || !preview) return;
    setBusy("restore");
    try {
      const r = await fetch(`${API_BASE}/api/dev/backup/restore`, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: sel.source, scope, companyId: scope === "company" ? companyId : undefined, mode, confirmText }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { toast.error(j.error || t("common.error")); return; }
      toast.success(t("backupPanel.restored", "Tiklandi: {{w}} yozuv yozildi, {{d}} o'chirildi", { w: j.result?.totals?.written ?? 0, d: j.result?.totals?.deleted ?? 0 }));
      resetRestore(); void loadStatus(); void loadArchives();
    } finally { setBusy(""); }
  };

  if (!st) return <SkeletonList items={3} />;
  const diffRows = preview ? Object.entries(preview.collections).filter(([, c]) => c.add || c.update || c.remove || c.archive || c.current).sort((a, b) => b[1].archive - a[1].archive) : [];
  const canRestore = !!preview && confirmText.trim().toUpperCase() === preview.confirmCode && (scope === "full" || /^[a-f0-9]{24}$/i.test(companyId));

  return (
    <div className="space-y-3 max-w-3xl mx-auto w-full" data-testid="dev-backup">
      {/* ── Umumiy holat ─────────────────────────────────────────────── */}
      <div className="surface rounded-2xl p-4 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className={`text-sm font-bold ${st.stale ? "text-red-600 dark:text-red-400" : "text-emerald-700 dark:text-emerald-300"}`}>
              {st.lastSuccessAt
                ? st.stale
                  ? t("backupPanel.staleTitle", "Oxirgi zaxira juda eski: {{ago}}", { ago: ago(st.lastSuccessAt) })
                  : t("backupPanel.okTitle", "Oxirgi zaxira: {{ago}}", { ago: ago(st.lastSuccessAt) })
                : t("backupPanel.noneTitle", "Hali birorta tashqi zaxira olinmagan")}
            </p>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              {t("backupPanel.scheduleHint", "Avtomatik: har kuni Toshkent vaqti bilan {{h}}:00 · keyingisi {{next}} · saqlanadi: {{d}} kunlik, {{w}} haftalik, {{m}} oylik",
                { h: String(st.schedule.hourTashkent).padStart(2, "0"), next: fmtDate(st.schedule.nextRunAt), d: st.schedule.retention.daily, w: st.schedule.retention.weekly, m: st.schedule.retention.monthly })}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <button type="button" onClick={() => { void loadStatus(); void loadArchives(); }} aria-label={t("devPanel.refresh")}
              className="w-9 h-9 rounded-full flex items-center justify-center bg-muted/50 hover:bg-muted text-muted-foreground">
              <MorphIcon icon={RefreshCw} className="w-4 h-4" />
            </button>
            <button type="button" onClick={runNow} disabled={!!busy} data-testid="backup-run-now"
              className="h-9 px-4 rounded-xl bg-primary text-primary-foreground text-sm font-bold disabled:opacity-60">
              {busy === "run" ? "..." : t("backupPanel.runNow", "Hozir zaxira olish")}
            </button>
          </div>
        </div>

        {!st.encryption.configured ? (
          <p className="text-xs rounded-xl border border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300 p-2.5">
            {t("backupPanel.noKey", "BACKUP_ENCRYPTION_KEY yo'q — zaxira umuman olinmaydi. Render → Environment'ga uzun tasodifiy parol qo'shing.")}
          </p>
        ) : st.encryption.weak ? (
          <p className="text-xs rounded-xl border border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300 p-2.5">
            {t("backupPanel.weakKey", "Shifr kaliti JWT_SECRET'dan olinmoqda — alohida BACKUP_ENCRYPTION_KEY qo'ying (JWT_SECRET o'zgarsa eski arxivlar ochilmaydi).")}
          </p>
        ) : (
          <p className="text-[11px] text-muted-foreground">{t("backupPanel.keyOk", "Shifr: AES-256-GCM · kalit {{src}} ({{id}})", { src: st.encryption.source, id: st.encryption.keyId })}</p>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          {([["s3", "S3 / Cloudflare R2"], ["telegram", "Telegram (dasturchi)"]] as const).map(([k, label]) => {
            const tg = st.targets[k];
            return (
              <div key={k} className={`rounded-2xl border p-3 ${tg.configured ? (tg.lastError ? "border-amber-500/30 bg-amber-500/[0.05]" : "border-border bg-card/60") : "border-dashed border-border bg-card/40"}`} data-testid={`backup-target-${k}`}>
                <p className="text-xs font-bold flex items-center gap-1.5">
                  <span>{tg.configured ? (tg.lastSuccessAt && !tg.lastError ? "✅" : tg.lastError ? "⚠️" : "⏳") : "➖"}</span>{label}
                </p>
                <p className="text-[11px] text-muted-foreground mt-1 break-words">
                  {k === "s3"
                    ? tg.configured ? `${tg.bucket} · ${tg.endpoint}` : t("backupPanel.s3Off", "Sozlanmagan — pastdagi yo'riqnoma")
                    : tg.configured ? t("backupPanel.tgOn", "Chat: {{src}}", { src: tg.chatSource }) : t("backupPanel.tgOff", "Dasturchi hisobini Telegram'ga ulang")}
                </p>
                <p className="text-[11px] mt-1.5 tabular-nums">
                  {tg.lastSuccessAt
                    ? t("backupPanel.lastOk", "Oxirgi: {{d}} · {{s}}", { d: fmtDate(tg.lastSuccessAt), s: fmtSize(tg.lastSuccessSize) })
                    : t("backupPanel.never", "Hali yuborilmagan")}
                </p>
                {tg.lastError && <p className="text-[11px] text-amber-700 dark:text-amber-300 mt-1 break-words">{t("backupPanel.lastErr", "Xato ({{d}}): {{e}}", { d: fmtDate(tg.lastFailureAt), e: tg.lastError })}</p>}
              </div>
            );
          })}
        </div>

        <button type="button" onClick={() => setShowSetup((v) => !v)} className="text-xs font-semibold text-primary">
          {showSetup ? t("backupPanel.hideSetup", "Yo'riqnomani yopish") : t("backupPanel.showSetup", "Bepul R2 (Cloudflare) sozlash — 7 qadam")}
        </button>
        {showSetup && (
          <div className="rounded-2xl border border-border bg-card/60 p-3 space-y-2">
            <ol className="text-[11px] space-y-1.5 list-decimal pl-4">{R2_STEPS.map((s, i) => <li key={i} className="break-words">{s}</li>)}</ol>
            <div className="space-y-1">
              {st.checklist.map((c) => (
                <div key={c.key} className="flex items-start gap-2 text-[11px]">
                  <span className="flex-shrink-0">{c.ok ? "✅" : c.required ? "❌" : "➖"}</span>
                  <span className="font-mono break-all">{c.key}</span>
                  {c.note && <span className="text-muted-foreground break-words">— {c.note}</span>}
                </div>
              ))}
            </div>
            <p className="text-[11px] text-muted-foreground">{t("backupPanel.zeroConfig", "Hech narsa sozlanmasa ham: TELEGRAM_BOT_TOKEN bo'lsa va dasturchi Telegram'ga ulangan bo'lsa, shifrlangan arxiv har kuni shu chatga hujjat bo'lib tushadi.")}</p>
          </div>
        )}
      </div>

      {/* ── Tiklash ──────────────────────────────────────────────────── */}
      <div className="surface rounded-2xl p-4 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-bold">{t("backupPanel.restoreTitle", "Tiklash")}</p>
            <p className="text-[11px] text-muted-foreground">{t("backupPanel.restoreHint", "Arxivni tanlang → sinov (hech narsa yozilmaydi) → kodni yozib tasdiqlang. Tiklashdan oldin hozirgi holat ham avtomatik tashqariga saqlanadi.")}</p>
          </div>
          <div className="flex-shrink-0">
            <input ref={fileRef} type="file" multiple className="hidden" onChange={(e) => { const f = e.target.files; e.currentTarget.value = ""; if (f?.length) void uploadFiles(f); }} />
            <button type="button" onClick={() => fileRef.current?.click()} disabled={!!busy} className="h-9 px-3 rounded-xl border border-border text-xs font-semibold">
              {busy === "upload" ? "..." : t("backupPanel.fromFile", "Fayldan tiklash")}
            </button>
          </div>
        </div>

        {s3Error && <p className="text-[11px] text-amber-700 dark:text-amber-300">{t("backupPanel.s3ListErr", "S3 ro'yxati olinmadi: {{e}}", { e: s3Error })}</p>}

        {archives === null ? <div className="h-20 rounded-xl bg-muted/40 animate-pulse" /> : archives.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-5">{t("backupPanel.noArchives", "Arxiv yo'q — “Hozir zaxira olish” ni bosing")}</p>
        ) : (
          <ul className="space-y-2 max-h-[300px] overflow-y-auto overscroll-contain pr-1" data-testid="backup-archives">
            {archives.slice(0, 60).map((a) => (
              <li key={a.id}>
                <button type="button" onClick={() => pick(a)}
                  className={`w-full text-left rounded-xl border p-2.5 ${sel?.id === a.id ? "border-primary bg-primary/[0.07]" : "border-border bg-card/60 hover:bg-muted/40"}`}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-bold tabular-nums">{fmtDate(a.createdAt)}</span>
                    <span className="text-[10px] px-2 py-0.5 rounded-full border border-border">{a.source.type === "s3" ? "S3/R2" : a.source.type === "telegram" ? "Telegram" : t("backupPanel.file", "Fayl")}</span>
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-0.5 break-words">
                    {a.scope === "full" ? t("backupPanel.scopeFull", "Butun baza") : t("backupPanel.scopeCompany", "Firma: {{n}}", { n: a.companyName || a.companyId })}
                    {" · "}{fmtSize(a.sizeBytes)}{a.totalDocs ? ` · ${a.totalDocs} ${t("backupPanel.records", "yozuv")}` : ""} · {a.reasonLabel}
                  </p>
                </button>
              </li>
            ))}
          </ul>
        )}

        {sel && (
          <div className="rounded-2xl border border-primary/30 bg-primary/[0.04] p-3 space-y-2.5">
            <p className="text-xs font-bold">{t("backupPanel.selected", "Tanlangan arxiv: {{d}}", { d: fmtDate(sel.createdAt) })}</p>
            <div className="flex flex-wrap gap-2">
              {sel.scope === "full" && (
                <select value={scope} onChange={(e) => { setScope(e.target.value as any); setPreview(null); }} className="h-9 rounded-xl border border-border bg-background text-xs px-2">
                  <option value="full">{t("backupPanel.scopeFull", "Butun baza")}</option>
                  <option value="company">{t("backupPanel.scopeOne", "Bitta firma")}</option>
                </select>
              )}
              {scope === "company" && (
                sel.companies?.length ? (
                  <select value={companyId} onChange={(e) => { setCompanyId(e.target.value); setPreview(null); }} className="h-9 rounded-xl border border-border bg-background text-xs px-2 max-w-[220px]">
                    <option value="">{t("backupPanel.pickCompany", "Firmani tanlang")}</option>
                    {sel.companies.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.docs})</option>)}
                  </select>
                ) : (
                  <input value={companyId} onChange={(e) => { setCompanyId(e.target.value.trim()); setPreview(null); }} placeholder="companyId" className="h-9 rounded-xl border border-border bg-background text-xs px-2 font-mono" />
                )
              )}
              <select value={mode} onChange={(e) => { setMode(e.target.value as any); setPreview(null); }} className="h-9 rounded-xl border border-border bg-background text-xs px-2">
                <option value="upsert">{t("backupPanel.modeUpsert", "Qo'shish/qaytarish (keyingi yozuvlar qoladi)")}</option>
                <option value="exact">{t("backupPanel.modeExact", "Aynan arxiv holati (keyin qo'shilganlari o'chadi)")}</option>
              </select>
              <button type="button" onClick={doPreview} disabled={!!busy || (scope === "company" && !/^[a-f0-9]{24}$/i.test(companyId))}
                data-testid="backup-preview" className="h-9 px-4 rounded-xl bg-muted text-foreground text-xs font-bold disabled:opacity-50">
                {busy === "preview" ? "..." : t("backupPanel.dryRun", "Sinov (dry-run)")}
              </button>
              <button type="button" onClick={resetRestore} className="h-9 px-3 rounded-xl border border-border text-xs">{t("common.cancel")}</button>
            </div>

            {preview && (
              <div className="space-y-2" data-testid="backup-preview-result">
                {preview.contentOk === false && <p className="text-[11px] text-red-600 dark:text-red-400">{t("backupPanel.contentBad", "DIQQAT: arxiv ichidagi xesh mos kelmadi — fayl to'liq bo'lmasligi mumkin.")}</p>}
                <p className="text-xs">
                  {t("backupPanel.diffTotals", "Jami: {{add}} qo'shiladi · {{upd}} qaytariladi · {{rem}} o'chadi (arxivda {{arc}}, hozir {{cur}})",
                    { add: preview.totals.add, upd: preview.totals.update, rem: mode === "exact" ? preview.totals.remove : 0, arc: preview.totals.archive, cur: preview.totals.current })}
                </p>
                <div className="max-h-44 overflow-y-auto rounded-xl border border-border">
                  <table className="w-full text-[11px]">
                    <thead className="bg-muted/50 sticky top-0"><tr>
                      <th className="text-left px-2 py-1">{t("backupPanel.collection", "Bo'lim")}</th>
                      <th className="px-2 py-1">{t("backupPanel.inArchive", "Arxivda")}</th>
                      <th className="px-2 py-1">{t("backupPanel.inDb", "Hozir")}</th>
                      <th className="px-2 py-1">+</th><th className="px-2 py-1">↻</th><th className="px-2 py-1">−</th>
                    </tr></thead>
                    <tbody>
                      {diffRows.map(([name, c]) => (
                        <tr key={name} className="border-t border-border/60">
                          <td className="px-2 py-1 font-mono break-all">{name}</td>
                          <td className="px-2 py-1 text-center tabular-nums">{c.archive}</td>
                          <td className="px-2 py-1 text-center tabular-nums">{c.current}</td>
                          <td className="px-2 py-1 text-center tabular-nums text-emerald-700 dark:text-emerald-300">{c.add || ""}</td>
                          <td className="px-2 py-1 text-center tabular-nums">{c.update || ""}</td>
                          <td className="px-2 py-1 text-center tabular-nums text-red-600 dark:text-red-400">{mode === "exact" ? c.remove || "" : ""}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="text-[11px]">{t("backupPanel.typeCode", "Tasdiqlash uchun aynan shuni yozing:")} <b className="font-mono">{preview.confirmCode}</b></p>
                <input value={confirmText} onChange={(e) => setConfirmText(e.target.value)} data-testid="backup-confirm"
                  className="w-full h-10 text-sm font-mono border border-red-500/40 rounded-xl px-3 bg-background focus:outline-none focus:ring-2 focus:ring-red-500/40" />
                <button type="button" onClick={doRestore} disabled={!canRestore || !!busy} data-testid="backup-restore"
                  className="w-full h-11 rounded-xl bg-red-600 text-white text-sm font-bold disabled:opacity-40 hover:bg-red-700">
                  {busy === "restore" ? "..." : scope === "full" ? t("backupPanel.restoreAll", "BUTUN BAZANI tiklash") : t("backupPanel.restoreOne", "Firmani tiklash")}
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Tarix ────────────────────────────────────────────────────── */}
      <div className="surface rounded-2xl p-4 space-y-2">
        <p className="text-sm font-bold">{t("backupPanel.history", "Oxirgi ishlar")}</p>
        {st.recent.length === 0 ? <p className="text-xs text-muted-foreground py-2">{t("backupPanel.noRuns", "Hali ish yo'q")}</p> : st.recent.map((r) => (
          <div key={r.id} className="rounded-xl border border-border bg-card/60 p-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-bold tabular-nums">{fmtDate(r.startedAt)}</span>
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${STATUS_TONE[r.status] || "border-border"}`}>
                {r.kind === "restore" ? t("backupPanel.kindRestore", "tiklash") : r.scheduled ? t("backupPanel.kindAuto", "avtomatik") : t("backupPanel.kindManual", "qo'lda")} · {r.status}
              </span>
            </div>
            <p className="text-[11px] text-muted-foreground mt-0.5 break-words">
              {r.scope === "full" ? t("backupPanel.scopeFull", "Butun baza") : t("backupPanel.scopeCompany", "Firma: {{n}}", { n: r.companyName || r.companyId })}
              {r.sizeBytes ? ` · ${fmtSize(r.sizeBytes)}` : ""}{r.totalDocs ? ` · ${r.totalDocs} ${t("backupPanel.records", "yozuv")}` : ""} · {r.reasonLabel}{r.by ? ` · ${r.by}` : ""}
              {r.targets.length ? ` · ${r.targets.map((x) => `${x.target === "s3" ? "S3" : "TG"}${x.ok ? "✅" : "❌"}`).join(" ")}` : ""}
              {r.restore ? ` · +${r.restore.totals.written}/−${r.restore.totals.deleted}` : ""}
            </p>
            {r.error && <p className="text-[11px] text-red-600 dark:text-red-400 mt-0.5 break-words">{r.error}</p>}
          </div>
        ))}
      </div>
    </div>
  );
}
