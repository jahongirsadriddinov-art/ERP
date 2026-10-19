import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { MorphIcon } from "morphicons/react";
import Telegram from "@hugeicons/core-free-icons/TelegramIcon";
import Computer from "@hugeicons/core-free-icons/ComputerIcon";
import Refresh from "@hugeicons/core-free-icons/Refresh01Icon";
import Phone from "@hugeicons/core-free-icons/PhoneIcon";
import Logout from "@hugeicons/core-free-icons/Logout01Icon";
import Search from "@hugeicons/core-free-icons/Search01Icon";
import Check from "@hugeicons/core-free-icons/CheckmarkCircle02Icon";
import { API_BASE } from "../../api";
import { Badge, Card, Field, More, Notice, Skeleton, Toggle, type Tone } from "./ui";

// Dasturchi paneli → AI → Telegram: AI qo'ng'iroq qiladigan platforma Telegram akkaunti (P6).
// Worker holati, ulash (telefon → kod → 2FA), UDP tekshiruvi, sinov qo'ng'irog'i, chiqish.
// XAVFSIZLIK: telefon/kod/parol faqat shu komponent holatida, yuborilishi bilan maydon tozalanadi;
// localStorage/sessionStorage'ga HECH QACHON yozilmaydi. loginAttemptId — sir emas, faqat xotirada.

interface TgAccount {
  status?: string; username?: string; displayName?: string; phoneMasked?: string; workerConnected?: boolean; workerVersion?: string;
  lastHealthAt?: string; udpOk?: boolean; floodWaitUntil?: string; dailyCallCount?: number; dailyCap?: number;
}
interface TgView {
  aiVoiceEnabled?: boolean; account?: TgAccount | null; worker?: { connectedHere?: boolean; workerId?: string; leaseActive?: boolean };
  lastError?: string; udpCheckedAt?: string; connectedAt?: string; limits?: { loginPer10Min?: number; testCallsPerHour?: number };
  openConversation?: boolean; openConversationAt?: string;
}
interface TestTarget { userId: string; name: string; companyId: string; companyName: string; resolveStatus: string }
interface Res<T> { ok: boolean; status: number; data: T; error: string; body: any }
type K = (s: string, o?: Record<string, unknown>) => string;
type ErrText = (r: { error: string; body: any }) => string;

const BASE = "/api/ai-voice/platform/telegram-account";

// Token api.ts'dagi fetch interceptor orqali qo'shiladi; xatolar tashlanmaydi — {ok:false,error}
async function api<T>(method: "GET" | "POST", path = "", body?: unknown): Promise<Res<T>> {
  try {
    const r = await fetch(`${API_BASE}${BASE}${path}`, {
      method, cache: "no-store",
      headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const data = await r.json().catch(() => null);
    return { ok: r.ok, status: r.status, data: data as T, error: r.ok ? "" : String(data?.error || `http_${r.status}`), body: data };
  } catch {
    return { ok: false, status: 0, data: undefined as T, error: "network", body: null };
  }
}

const STATUS_TONE: Record<string, Tone> = { connected: "green", awaiting_code: "amber", awaiting_password: "amber", error: "red", disconnected: "gray" };
const POLL_MS = 15_000;

type Step = "phone" | "code" | "password";

export default function TelegramAccountPanel() {
  const { t, i18n } = useTranslation();
  const k: K = useCallback((s, o) => t(`aiVoice.telegram.${s}`, o as any) as string, [t]);
  const [v, setV] = useState<TgView | null | false>(null);
  const [busy, setBusy] = useState("");
  const busyRef = useRef("");
  busyRef.current = busy;

  const load = useCallback(async () => {
    const r = await api<TgView>("GET");
    setV(r.ok && r.data ? r.data : false);
  }, []);

  useEffect(() => {
    load();
    // Faqat sahifa ko'rinib turganda va hech narsa yuborilmayotganda yangilanadi
    const id = window.setInterval(() => { if (!document.hidden && !busyRef.current) load(); }, POLL_MS);
    return () => window.clearInterval(id);
  }, [load]);

  /** Xato kodi → tushunarli matn (kiritilgan qiymatlar hech qachon ko'rsatilmaydi). */
  const errText: ErrText = useCallback((r) => {
    const code = String(r.body?.errorCode || r.error || "error");
    const mins = r.body?.retryAfterSec ? Math.max(1, Math.ceil(Number(r.body.retryAfterSec) / 60)) : 1;
    const key = `aiVoice.telegram.errors.${code}`;
    return i18n.exists(key) ? (t(key, { mins }) as string) : k("errors.generic", { code });
  }, [i18n, k, t]);

  if (v === null) return <Skeleton />;
  if (v === false) return (
    <div className="space-y-2">
      <Notice tone="warn">{t("aiVoice.common.error")}</Notice>
      <button type="button" onClick={load} className="h-10 px-4 rounded-xl border border-border text-sm font-semibold">{t("aiVoice.common.retry")}</button>
    </div>
  );

  const acc = v.account || {};
  const status = acc.status || "disconnected";
  const workerOn = !!acc.workerConnected;
  const workerHere = !!v.worker?.connectedHere;
  const connected = status === "connected";

  const udp = async () => {
    setBusy("udp");
    const r = await api<{ ok: boolean; details?: string }>("POST", "/udp-probe", {});
    setBusy("");
    if (!r.ok) { toast.error(errText(r)); return; }
    if (r.data?.ok) toast.success(k("udp.okToast")); else toast.error(k("udp.badToast"));
    load();
  };
  // "Ochiq muloqot": bog'langan xodimlarning kiruvchi qo'ng'iroqlarini AI qabul qiladi (standart o'chiq)
  const toggleOpen = async (enabled: boolean) => {
    setBusy("open");
    const r = await api<{ ok: boolean; openConversation: boolean; workerSynced?: boolean }>("POST", "/open-conversation", { enabled });
    setBusy("");
    if (!r.ok) { toast.error(errText(r)); return; }
    setV((p) => (p ? { ...p, openConversation: !!r.data?.openConversation } : p));
    toast.success(k(enabled ? "open.onToast" : "open.offToast"));
    if (r.data?.workerSynced === false) toast.message(k("open.notSynced"));
  };
  const logout = async () => {
    if (!window.confirm(k("logout.confirm"))) return;
    setBusy("logout");
    const r = await api("POST", "/logout", {});
    setBusy("");
    if (!r.ok) { toast.error(errText(r)); return; }
    toast.success(k("logout.done"));
    load();
  };

  return (
    <div className="space-y-4" data-testid="ai-telegram-panel">
      {v.aiVoiceEnabled === false && <Notice tone="warn" testId="ai-tg-ai-off">{k("aiOff")}</Notice>}

      <StatusCard v={v} k={k} busy={busy === "refresh"} onRefresh={async () => { setBusy("refresh"); await load(); setBusy(""); }} />

      {!workerOn && (
        <Notice tone="warn" testId="ai-tg-worker-off">
          <b>{k("worker.offline")}.</b> {k("worker.offlineHelp")}
        </Notice>
      )}

      {!connected && (
        <LoginCard k={k} errText={errText} canLogin={workerHere} pendingOnServer={status === "awaiting_code" || status === "awaiting_password"}
          busy={busy} setBusy={setBusy} onDone={load} />
      )}

      {connected && (
        <>
          <TestCallCard k={k} errText={errText} canCall={workerOn} />
          <GuestCallCard k={k} errText={errText} canCall={workerOn} />
          <Card icon={Telegram} title={k("open.title")} testId="ai-tg-open">
            <Toggle checked={!!v.openConversation} disabled={!!busy} onChange={toggleOpen} testId="ai-tg-open-toggle"
              label={k("open.label")} hint={k("open.hint")} />
            <p className="text-[11px] text-muted-foreground mt-1">{k("open.rules")}</p>
          </Card>
          <Card icon={Computer} title={k("actions.title")}>
            <div className="flex flex-wrap gap-2">
              <button type="button" disabled={!workerHere || !!busy} data-testid="ai-tg-udp" onClick={udp}
                className="h-10 px-4 rounded-xl border border-border text-sm font-semibold inline-flex items-center gap-2 disabled:opacity-50">
                <MorphIcon icon={Refresh} className={`w-4 h-4 ${busy === "udp" ? "animate-spin" : ""}`} />{k("udp.check")}
              </button>
              <button type="button" disabled={!workerHere || !!busy} data-testid="ai-tg-logout" onClick={logout}
                className="h-10 px-4 rounded-xl border border-red-500/40 text-red-700 dark:text-red-300 text-sm font-semibold inline-flex items-center gap-2 disabled:opacity-50">
                <MorphIcon icon={Logout} className="w-4 h-4" />{k("logout.button")}
              </button>
            </div>
            {!workerHere && workerOn && <p className="text-[11px] text-muted-foreground mt-2">{k("worker.otherInstance")}</p>}
          </Card>
        </>
      )}

      <More title={k("help.title")} hint={k("help.hint")} testId="ai-tg-help" defaultOpen={!workerOn && !connected}>
        <ol className="list-decimal pl-5 space-y-1.5 text-xs text-muted-foreground">
          {["s1", "s2", "s3", "s4", "s5", "s6", "s7"].map((s) => <li key={s}>{k(`help.${s}`)}</li>)}
        </ol>
        <p className="text-[11px] text-muted-foreground mt-3">{k("help.safety")}</p>
      </More>
    </div>
  );
}

function fmtTime(iso?: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString([], { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" });
}

function StatusCard({ v, k, busy, onRefresh }: { v: TgView; k: K; busy: boolean; onRefresh: () => void }) {
  const acc = v.account || {};
  const status = STATUS_TONE[acc.status || ""] ? (acc.status as string) : "disconnected";
  const flood = acc.floodWaitUntil && new Date(acc.floodWaitUntil).getTime() > Date.now() ? acc.floodWaitUntil : undefined;
  const rows: [string, ReactNode][] = [
    [k("fields.account"), acc.username ? `@${acc.username}` : acc.displayName || acc.phoneMasked || "—"],
    [k("fields.worker"), (
      <span className="inline-flex flex-wrap items-center gap-1.5">
        <Badge tone={acc.workerConnected ? "green" : "red"}>{acc.workerConnected ? k("worker.online") : k("worker.offline")}</Badge>
        {acc.workerVersion && <span className="text-[11px] text-muted-foreground">v{acc.workerVersion}</span>}
      </span>
    )],
    [k("fields.lastSeen"), fmtTime(acc.lastHealthAt)],
    [k("fields.udp"), <Badge tone={acc.udpOk === true ? "green" : acc.udpOk === false ? "red" : "gray"}>{acc.udpOk === true ? k("udp.ok") : acc.udpOk === false ? k("udp.bad") : k("udp.unknown")}</Badge>],
    [k("fields.today"), <span className="tabular-nums">{acc.dailyCallCount ?? 0} / {acc.dailyCap ?? "—"}</span>],
  ];
  return (
    <Card icon={Telegram} title={k("title")} hint={k("subtitle")} testId="ai-tg-status"
      right={
        <button type="button" onClick={onRefresh} aria-label={k("refresh")} title={k("refresh")} disabled={busy}
          className="w-9 h-9 rounded-xl border border-border inline-flex items-center justify-center text-muted-foreground hover:text-foreground disabled:opacity-50">
          <MorphIcon icon={Refresh} className={`w-4 h-4 ${busy ? "animate-spin" : ""}`} />
        </button>
      }>
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <Badge tone={STATUS_TONE[status]}>{k(`status.${status}`)}</Badge>
        {flood && <Badge tone="amber">{k("floodUntil", { time: fmtTime(flood) })}</Badge>}
      </div>
      <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2">
        {rows.map(([label, val]) => (
          <div key={label} className="flex items-center justify-between gap-3 min-w-0 text-sm">
            <dt className="text-xs text-muted-foreground flex-shrink-0">{label}</dt>
            <dd className="font-medium truncate text-right min-w-0">{val}</dd>
          </div>
        ))}
      </dl>
      {v.lastError && status !== "connected" && (
        <p className="text-[11px] text-muted-foreground mt-3">{k("fields.lastError")}: {k(`lastErrors.${v.lastError}`, { defaultValue: v.lastError })}</p>
      )}
    </Card>
  );
}

const inputCls = "h-11 w-full rounded-xl border border-border bg-card/70 px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:opacity-60";
const primaryBtn = "h-11 px-5 rounded-xl bg-primary text-primary-foreground text-sm font-semibold disabled:opacity-50 inline-flex items-center justify-center gap-2";

function LoginCard({ k, errText, canLogin, pendingOnServer, busy, setBusy, onDone }: {
  k: K; errText: ErrText; canLogin: boolean; pendingOnServer: boolean; busy: string; setBusy: (s: string) => void; onDone: () => void;
}) {
  const [step, setStep] = useState<Step>("phone");
  const [attemptId, setAttemptId] = useState("");
  const [phoneMasked, setPhoneMasked] = useState("");
  const [value, setValue] = useState("");
  const [err, setErr] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (step !== "phone") inputRef.current?.focus(); }, [step]);

  const reset = () => { setStep("phone"); setAttemptId(""); setValue(""); setErr(""); };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!value.trim() || busy) return;
    setErr("");
    setBusy("login");
    const secret = value;
    setValue("");          // maydon darhol tozalanadi (B8)
    const r = step === "phone"
      ? await api<any>("POST", "/login/start", { phone: secret })
      : step === "code"
        ? await api<any>("POST", "/login/code", { loginAttemptId: attemptId, code: secret })
        : await api<any>("POST", "/login/password", { loginAttemptId: attemptId, password: secret });
    setBusy("");
    if (!r.ok) {
      setErr(errText(r));
      if (["attempt_expired", "code_expired", "phone_banned"].includes(r.error)) { setStep("phone"); setAttemptId(""); }
      return;
    }
    if (r.data?.status === "connected") {
      toast.success(k("connectedOk"));
      reset();
      onDone();
      return;
    }
    if (r.data?.loginAttemptId) setAttemptId(r.data.loginAttemptId);
    if (r.data?.phoneMasked) setPhoneMasked(r.data.phoneMasked);
    setStep(r.data?.status === "awaiting_password" ? "password" : "code");
    onDone();
  };

  const cancel = async () => {
    const id = attemptId;
    reset();
    await api("POST", "/login/cancel", id ? { loginAttemptId: id } : {});
    onDone();
  };

  const steps: Step[] = ["phone", "code", "password"];
  const idx = steps.indexOf(step);

  return (
    <Card icon={Phone} title={k("login.title")} hint={k("login.hint")} testId="ai-tg-login">
      <ol className="flex flex-wrap items-center gap-2 mb-4">
        {steps.map((s, i) => (
          <li key={s} className="flex items-center gap-2 min-w-0" aria-current={i === idx ? "step" : undefined}>
            <span className={`w-6 h-6 rounded-full text-[11px] font-bold inline-flex items-center justify-center flex-shrink-0 ${i < idx ? "bg-emerald-500 text-white" : i === idx ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
              {i < idx ? <MorphIcon icon={Check} className="w-3.5 h-3.5" /> : i + 1}
            </span>
            <span className={`text-xs ${i === idx ? "font-semibold" : "text-muted-foreground"}`}>{k(`steps.${s}`)}</span>
            {i < steps.length - 1 && <span aria-hidden className="w-4 sm:w-8 h-px bg-border flex-shrink-0" />}
          </li>
        ))}
      </ol>

      {!canLogin && <div className="mb-3"><Notice tone="lock">{k("login.needWorker")}</Notice></div>}
      {pendingOnServer && step === "phone" && <div className="mb-3"><Notice>{k("login.restart")}</Notice></div>}

      <form onSubmit={submit} className="space-y-3" autoComplete="off">
        {step === "phone" && (
          <Field label={k("phone.label")} hint={k("phone.hint")}>
            <input ref={inputRef} type="tel" inputMode="tel" autoComplete="off" name="aiv-tg-phone" value={value} maxLength={20}
              onChange={(e) => setValue(e.target.value)} placeholder="+998901234567" disabled={!canLogin || busy === "login"}
              data-testid="ai-tg-phone" className={inputCls} />
          </Field>
        )}
        {step === "code" && (
          <Field label={k("code.label")} hint={k("code.hint", { phone: phoneMasked || "—" })}>
            <input ref={inputRef} type="text" inputMode="numeric" autoComplete="one-time-code" name="aiv-tg-code" value={value} maxLength={8}
              onChange={(e) => setValue(e.target.value.replace(/\D/g, ""))} disabled={busy === "login"}
              data-testid="ai-tg-code" className={`${inputCls} tracking-[0.3em] tabular-nums`} />
          </Field>
        )}
        {step === "password" && (
          <Field label={k("password.label")} hint={k("password.hint")}>
            <input ref={inputRef} type="password" autoComplete="off" name="aiv-tg-2fa" value={value} maxLength={256}
              onChange={(e) => setValue(e.target.value)} disabled={busy === "login"}
              data-testid="ai-tg-password" className={inputCls} />
          </Field>
        )}
        {err && <p role="alert" className="text-xs text-red-600 dark:text-red-400" data-testid="ai-tg-login-error">{err}</p>}
        <div className="flex flex-wrap gap-2">
          <button type="submit" disabled={!value.trim() || !!busy || (step === "phone" && !canLogin)} className={primaryBtn} data-testid="ai-tg-submit">
            {busy === "login" && <MorphIcon icon={Refresh} className="w-4 h-4 animate-spin" />}
            {k(`${step}.submit`)}
          </button>
          {(step !== "phone" || pendingOnServer) && (
            <button type="button" onClick={cancel} disabled={busy === "login"} className="h-11 px-4 rounded-xl border border-border text-sm font-semibold">
              {k("cancel")}
            </button>
          )}
        </div>
        <p className="text-[11px] text-muted-foreground">{k("secretNote")}</p>
      </form>
    </Card>
  );
}

function TestCallCard({ k, errText, canCall }: { k: K; errText: ErrText; canCall: boolean }) {
  const [q, setQ] = useState("");
  const [list, setList] = useState<TestTarget[] | null>(null);
  const [sel, setSel] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    let alive = true;
    const h = window.setTimeout(async () => {
      const r = await api<{ targets: TestTarget[] }>("GET", `/test-targets${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ""}`);
      if (alive) setList(r.ok && Array.isArray(r.data?.targets) ? r.data.targets : []);
    }, q ? 300 : 0);
    return () => { alive = false; window.clearTimeout(h); };
  }, [q]);

  const callNow = async () => {
    if (!sel || busy) return;
    setBusy(true);
    setResult(null);
    const r = await api<{ placed: boolean; errorCode?: string; outcome?: string }>("POST", "/test-call", { userId: sel });
    setBusy(false);
    if (r.ok && r.data?.placed) {
      setResult({ ok: true, text: k("test.placed") });
      toast.success(k("test.placed"));
    } else {
      setResult({ ok: false, text: k("test.failed", { reason: errText(r) }) });
    }
  };

  return (
    <Card icon={Phone} title={k("test.title")} hint={k("test.hint")} testId="ai-tg-test">
      <div className="relative mb-3">
        <MorphIcon icon={Search} className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={k("test.search")} aria-label={k("test.search")}
          className="h-10 w-full rounded-xl border border-border bg-card/70 pl-9 pr-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20" />
      </div>
      {list === null ? <Skeleton h="h-16" /> : list.length === 0 ? (
        <p className="text-xs text-muted-foreground py-3" data-testid="ai-tg-test-empty">{k("test.empty")}</p>
      ) : (
        <ul className="space-y-1.5 max-h-64 overflow-y-auto overscroll-contain -mx-1 px-1" role="radiogroup" aria-label={k("test.title")}>
          {list.map((x) => (
            <li key={x.userId}>
              <button type="button" role="radio" aria-checked={sel === x.userId} onClick={() => setSel(x.userId)}
                className={`w-full text-left rounded-xl border px-3 py-2 flex items-center gap-3 liquid-transition ${sel === x.userId ? "border-primary bg-primary/[0.06]" : "border-border bg-card/60 hover:border-primary/40"}`}>
                <span className="flex-1 min-w-0">
                  <span className="block text-sm font-semibold truncate">{x.name}</span>
                  <span className="block text-[11px] text-muted-foreground truncate">{x.companyName || "—"}</span>
                </span>
                <Badge tone={x.resolveStatus === "resolved" ? "green" : x.resolveStatus === "privacy_restricted" || x.resolveStatus === "blocked" ? "red" : "amber"}>
                  {k(`resolve.${["resolved", "privacy_restricted", "not_found", "blocked"].includes(x.resolveStatus) ? x.resolveStatus : "unknown"}`)}
                </Badge>
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-center gap-3 mt-3">
        <button type="button" onClick={callNow} disabled={!sel || busy || !canCall} className={primaryBtn} data-testid="ai-tg-test-call">
          <MorphIcon icon={busy ? Refresh : Phone} className={`w-4 h-4 ${busy ? "animate-spin" : ""}`} />
          {k("test.call")}
        </button>
        {result && <p role="status" className={`text-xs ${result.ok ? "text-emerald-700 dark:text-emerald-300" : "text-red-600 dark:text-red-400"}`}>{result.text}</p>}
      </div>
    </Card>
  );
}

/** Mehmon sinov qo'ng'irog'i (owner 2026-10-19): istalgan Telegram raqami/@username — firmasiz oddiy AI suhbati. */
function GuestCallCard({ k, errText, canCall }: { k: K; errText: ErrText; canCall: boolean }) {
  const { i18n } = useTranslation();
  const i18nHas = (key: string) => i18n.exists(`aiVoice.telegram.${key}`);
  const [target, setTarget] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const valid = /^(@?[A-Za-z][A-Za-z0-9_]{3,31}|(https?:\/\/)?t\.me\/[A-Za-z][A-Za-z0-9_]{3,31}|\+?[\d\s()-]{9,20})$/.test(target.trim());

  // Qo'ng'iroq natijasini kuzatish (owner 2026-10-19: "terildi, lekin jiringlamadi" — sababi ko'rinsin)
  const watchRef = useRef(0);
  useEffect(() => () => { watchRef.current++; }, []);
  const watch = async (sessionId: string) => {
    const my = ++watchRef.current;
    for (let i = 0; i < 60 && watchRef.current === my; i++) {
      await new Promise((ok) => window.setTimeout(ok, 3000));
      if (watchRef.current !== my) return;
      const r = await api<{ status: string; active: boolean; answered: boolean; errorCode: string }>("GET", `/guest-call/${sessionId}`);
      if (!r.ok || !r.data) continue;
      const d = r.data;
      if (d.active) { setResult({ ok: true, text: k(d.status === "connected" ? "guest.live" : "guest.ringing") }); continue; }
      const why = d.errorCode && i18nHas(`guest.why.${d.errorCode}`) ? k(`guest.why.${d.errorCode}`) : (d.errorCode || d.status);
      setResult({ ok: d.answered, text: d.answered ? k("guest.done") : k("guest.notConnected", { reason: why }) });
      return;
    }
  };

  const callNow = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (!valid) { setResult({ ok: false, text: k("guest.invalid") }); return; }
    setBusy(true);
    setResult(null);
    const r = await api<{ placed: boolean; errorCode?: string; sessionId?: string }>("POST", "/guest-call", { target: target.trim(), name: name.trim() || undefined });
    setBusy(false);
    if (r.ok && r.data?.placed) {
      setResult({ ok: true, text: k("guest.placed") });
      if (r.data.sessionId) void watch(r.data.sessionId);
    } else {
      const code = String(r.body?.errorCode || "");
      setResult({ ok: false, text: code === "not_found" ? k("guest.notFound") : k("test.failed", { reason: errText(r) }) });
    }
  };

  return (
    <Card icon={Phone} title={k("guest.title")} hint={k("guest.hint")} testId="ai-tg-guest">
      <form onSubmit={callNow} className="space-y-2.5">
        <input value={target} onChange={(e) => setTarget(e.target.value)} placeholder={k("guest.target")} aria-label={k("guest.target")}
          inputMode="text" autoComplete="off" spellCheck={false} maxLength={40} data-testid="ai-tg-guest-target" className={inputCls} />
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder={k("guest.name")} aria-label={k("guest.name")}
          autoComplete="off" maxLength={40} data-testid="ai-tg-guest-name" className={inputCls} />
        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" disabled={!target.trim() || busy || !canCall} className={primaryBtn} data-testid="ai-tg-guest-call">
            <MorphIcon icon={busy ? Refresh : Phone} className={`w-4 h-4 ${busy ? "animate-spin" : ""}`} />
            {k("guest.call")}
          </button>
          {result && <p role="status" className={`text-xs ${result.ok ? "text-emerald-700 dark:text-emerald-300" : "text-red-600 dark:text-red-400"}`}>{result.text}</p>}
        </div>
      </form>
    </Card>
  );
}
