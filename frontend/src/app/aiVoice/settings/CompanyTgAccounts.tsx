import "../../i18n/aiVoiceNs";
import { confirmDialog } from "../../lib/confirmDialog";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { MorphIcon } from "morphicons/react";
import Telegram from "@hugeicons/core-free-icons/TelegramIcon";
import Refresh from "@hugeicons/core-free-icons/Refresh01Icon";
import Logout from "@hugeicons/core-free-icons/Logout01Icon";
import Delete from "@hugeicons/core-free-icons/Delete02Icon";
import Add from "@hugeicons/core-free-icons/Add01Icon";
import Edit from "@hugeicons/core-free-icons/Edit02Icon";
import UserEdit from "@hugeicons/core-free-icons/UserEdit01Icon";
import TgProfileEditor from "./TgProfileEditor";
import { API_BASE } from "../../api";
import { Badge, Card, type Tone } from "./ui";

// Dasturchi paneli → AI → "AI akkauntlari" (owner 2026-10-19): UMUMIY hovuz — hohlagancha Telegram profil qo'shiladi,
// har biriga ism beriladi (AI shu akkauntdan gapirganda o'zini shu ism bilan tanishtiradi). Hamma firmalar uchun:
// qo'ng'iroq bo'sh akkaunt orqali ketadi; qo'ng'iroq qiluvchining firmasi ERP botdagi bog'lanishdan aniqlanadi.
// XAVFSIZLIK: telefon/kod/parol faqat komponent holatida, yuborilgach tozalanadi; hech qayerga saqlanmaydi.

interface Acc { id: string; label?: string; status: string; username?: string; displayName?: string; phoneMasked?: string; busy: boolean; lastError?: string; floodWaitUntil?: string }
interface Res<T> { ok: boolean; data: T; error: string; body: any }
type K = (s: string, o?: Record<string, unknown>) => string;

const BASE = "/api/ai-voice/platform/tg-accounts";
async function api<T>(method: "GET" | "POST" | "PATCH" | "DELETE", path: string, body?: unknown): Promise<Res<T>> {
  try {
    const r = await fetch(`${API_BASE}${BASE}${path}`, {
      method, cache: "no-store",
      headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const data = await r.json().catch(() => null);
    return { ok: r.ok, data: data as T, error: r.ok ? "" : String(data?.error || `http_${r.status}`), body: data };
  } catch {
    return { ok: false, data: undefined as T, error: "network", body: null };
  }
}

const TONE: Record<string, Tone> = { connected: "green", awaiting_code: "amber", awaiting_password: "amber", error: "red", disconnected: "gray" };
const inputCls = "h-11 w-full rounded-xl border border-border bg-card/70 px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:opacity-60";
const primaryBtn = "h-11 px-5 rounded-xl bg-primary text-primary-foreground text-sm font-semibold disabled:opacity-50 inline-flex items-center justify-center gap-2";
const smallBtn = "h-9 px-3 rounded-lg border border-border text-xs font-semibold inline-flex items-center gap-1.5 disabled:opacity-50";

export default function CompanyTgAccounts() {
  const { t, i18n } = useTranslation();
  const k: K = useCallback((s, o) => t(`aiVoice.telegram.company.${s}`, o as any) as string, [t]);
  const errText = (r: { error: string; body: any }) => {
    const code = String(r.body?.errorCode || r.error || "error");
    const key = `aiVoice.telegram.errors.${code}`;
    return i18n.exists(key) ? (t(key, { mins: 1 }) as string) : (t("aiVoice.telegram.errors.generic", { code }) as string);
  };
  const [accounts, setAccounts] = useState<Acc[] | null | false>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState("");
  const [login, setLogin] = useState<{ id: string; step: "phone" | "code" | "password"; attempt?: string } | null>(null);
  const [value, setValue] = useState("");
  const [rename, setRename] = useState<{ id: string; v: string } | null>(null);
  // Profil: bitta akkaunt (profileFor) yoki tanlanganlarga birdan (sel + bulk)
  const [profileFor, setProfileFor] = useState<string | null>(null);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [bulk, setBulk] = useState(false);
  const toggleSel = (id: string) => setSel((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const profileDone = (list?: unknown) => {
    setProfileFor(null); setBulk(false);
    if (Array.isArray(list)) setAccounts(list as Acc[]); else load();
  };

  const load = useCallback(async () => {
    const r = await api<{ accounts: Acc[] }>("GET", "");
    setAccounts(r.ok ? r.data?.accounts || [] : false);
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const id = window.setInterval(() => { if (!document.hidden && !busy && !login && !rename && !profileFor && !bulk) load(); }, 15_000);
    return () => window.clearInterval(id);
  }, [busy, login, rename, profileFor, bulk, load]);

  const add = async () => {
    setBusy("add");
    const r = await api<{ id: string; accounts: Acc[] }>("POST", "", { name: name.trim() || undefined });
    setBusy("");
    if (!r.ok) { toast.error(r.error === "too_many" ? k("tooMany") : errText(r)); return; }
    setName("");
    setAccounts(r.data.accounts);
    setLogin({ id: r.data.id, step: "phone" });
  };

  const saveName = async (e: FormEvent) => {
    e.preventDefault();
    if (!rename) return;
    setBusy(`nm:${rename.id}`);
    const r = await api<{ accounts: Acc[] }>("PATCH", `/${rename.id}`, { name: rename.v.trim() });
    setBusy("");
    if (!r.ok) { toast.error(errText(r)); return; }
    setAccounts(r.data.accounts);
    setRename(null);
    toast.success(k("nameSaved"));
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!login || !value.trim()) return;
    const path = `/${login.id}/login/${login.step === "phone" ? "start" : login.step}`;
    const body = login.step === "phone" ? { phone: value.trim() } : login.step === "code" ? { code: value.trim(), loginAttemptId: login.attempt } : { password: value, loginAttemptId: login.attempt };
    setBusy("login");
    const r = await api<{ status: string; loginAttemptId?: string; accounts?: Acc[] }>("POST", path, body);
    setBusy("");
    setValue("");
    if (!r.ok) { toast.error(errText(r)); if (r.error === "attempt_expired") setLogin({ id: login.id, step: "phone" }); return; }
    if (r.data.status === "connected") {
      toast.success(k("connected"));
      setLogin(null);
      if (r.data.accounts) setAccounts(r.data.accounts); else load();
      return;
    }
    setLogin({ id: login.id, step: r.data.status === "awaiting_password" ? "password" : "code", attempt: r.data.loginAttemptId || login.attempt });
  };

  const logout = async (a: Acc) => {
    if (!(await confirmDialog(k("logoutConfirm"), { danger: true }))) return;
    setBusy(`out:${a.id}`);
    const r = await api<{ accounts: Acc[] }>("POST", `/${a.id}/logout`, {});
    setBusy("");
    if (!r.ok) { toast.error(errText(r)); return; }
    setAccounts(r.data.accounts);
  };
  const remove = async (a: Acc) => {
    if (!(await confirmDialog(k("removeConfirm"), { danger: true }))) return;
    setBusy(`rm:${a.id}`);
    const r = await api<{ accounts: Acc[] }>("DELETE", `/${a.id}`);
    setBusy("");
    if (!r.ok) { toast.error(r.error === "busy" ? k("removeBusy") : errText(r)); return; }
    setAccounts(r.data.accounts);
    if (login?.id === a.id) setLogin(null);
  };

  return (
    <Card icon={Telegram} title={k("title")} hint={k("hint")} testId="ai-tg-company-accounts">
      <div className="space-y-3">
        {accounts === null && <p className="text-xs text-muted-foreground">{k("loading")}</p>}
        {accounts === false && (
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-xs text-red-600 dark:text-red-400">{k("loadError")}</p>
            <button type="button" className={smallBtn} onClick={() => { setAccounts(null); load(); }}>
              <MorphIcon icon={Refresh} className="w-3.5 h-3.5" />{k("retry")}
            </button>
          </div>
        )}
        {accounts && (
          <>
            {accounts.length === 0 && <p className="text-xs text-muted-foreground">{k("empty")}</p>}
            <ul className="space-y-2">
              {accounts.map((a) => (
                <li key={a.id} className="rounded-xl border border-border p-3 flex flex-wrap items-center gap-2 justify-between" data-testid="ai-tg-company-account">
                  <div className="min-w-0 flex items-start gap-2.5">
                    {a.status === "connected" && (
                      <input type="checkbox" checked={sel.has(a.id)} onChange={() => toggleSel(a.id)} aria-label={k("select")}
                        className="mt-1 w-4 h-4 accent-[var(--primary)]" data-testid="ai-tg-account-select" />
                    )}
                    <div className="min-w-0">
                    {rename?.id === a.id ? (
                      <form onSubmit={saveName} className="flex flex-wrap items-center gap-2">
                        <input autoFocus value={rename.v} onChange={(e) => setRename({ id: a.id, v: e.target.value })} maxLength={30}
                          placeholder={k("namePh")} aria-label={k("namePh")} className="h-9 rounded-lg border border-border bg-card/70 px-2 text-sm outline-none focus:border-primary" />
                        <button type="submit" className={smallBtn} disabled={busy === `nm:${a.id}`}>{k("save")}</button>
                        <button type="button" className={smallBtn} onClick={() => setRename(null)}>{k("cancel")}</button>
                      </form>
                    ) : (
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-semibold truncate">{a.label || <span className="text-muted-foreground">{k("noName")}</span>}</span>
                        <button type="button" className="text-muted-foreground hover:text-foreground" aria-label={k("rename")} title={k("rename")}
                          onClick={() => setRename({ id: a.id, v: a.label || "" })} data-testid="ai-tg-account-rename">
                          <MorphIcon icon={Edit} className="w-3.5 h-3.5" />
                        </button>
                        <Badge tone={TONE[a.status] || "gray"}>{k(`status.${a.status}`)}</Badge>
                        {a.busy && <Badge tone="amber">{k("busy")}</Badge>}
                        {a.floodWaitUntil && <Badge tone="red">{k("flood")}</Badge>}
                      </div>
                    )}
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      {[a.displayName || "", a.username ? `@${a.username}` : "", a.phoneMasked || ""].filter(Boolean).join(" · ")}
                    </p>
                    {a.lastError && (
                      <p className="text-[11px] text-red-600 dark:text-red-400 mt-0.5">
                        {i18n.exists(`aiVoice.telegram.company.err.${a.lastError}`) ? k(`err.${a.lastError}`) : a.lastError}
                      </p>
                    )}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {a.status !== "connected" && (
                      <button type="button" className={smallBtn} disabled={!!busy} onClick={() => { setValue(""); setLogin({ id: a.id, step: "phone" }); }}>
                        <MorphIcon icon={Telegram} className="w-3.5 h-3.5" />{k("connect")}
                      </button>
                    )}
                    {a.status === "connected" && (
                      <button type="button" className={smallBtn} disabled={!!busy} onClick={() => { setBulk(false); setProfileFor(profileFor === a.id ? null : a.id); }} data-testid="ai-tg-account-profile">
                        <MorphIcon icon={UserEdit} className="w-3.5 h-3.5" />{k("profile")}
                      </button>
                    )}
                    {a.status === "connected" && (
                      <button type="button" className={smallBtn} disabled={!!busy} onClick={() => logout(a)}>
                        <MorphIcon icon={busy === `out:${a.id}` ? Refresh : Logout} className={`w-3.5 h-3.5 ${busy === `out:${a.id}` ? "animate-spin" : ""}`} />{k("logout")}
                      </button>
                    )}
                    <button type="button" className={`${smallBtn} border-red-500/40 text-red-700 dark:text-red-300`} disabled={!!busy} onClick={() => remove(a)}>
                      <MorphIcon icon={busy === `rm:${a.id}` ? Refresh : Delete} className={`w-3.5 h-3.5 ${busy === `rm:${a.id}` ? "animate-spin" : ""}`} />{k("remove")}
                    </button>
                  </div>
                  {profileFor === a.id && <TgProfileEditor mode="one" ids={[a.id]} onDone={profileDone} onCancel={() => setProfileFor(null)} />}
                  {login?.id === a.id && (
                    <form onSubmit={submit} className="w-full flex flex-wrap gap-2 pt-2">
                      <input
                        key={login.step} autoFocus value={value} onChange={(e) => setValue(e.target.value)}
                        type={login.step === "password" ? "password" : "text"} inputMode={login.step === "password" ? "text" : "tel"}
                        autoComplete={login.step === "password" ? "current-password" : "off"} spellCheck={false} maxLength={login.step === "password" ? 256 : 20}
                        placeholder={k(`step.${login.step}`)} aria-label={k(`step.${login.step}`)} className={`${inputCls} flex-1 min-w-[12rem]`}
                        data-testid="ai-tg-company-login-input"
                      />
                      <button type="submit" className={primaryBtn} disabled={!value.trim() || busy === "login"}>
                        {busy === "login" && <MorphIcon icon={Refresh} className="w-4 h-4 animate-spin" />}{k("next")}
                      </button>
                      <button type="button" className="h-11 px-4 rounded-xl border border-border text-sm" onClick={() => { setLogin(null); setValue(""); }}>{k("cancel")}</button>
                      <p className="w-full text-[11px] text-muted-foreground">{k(`stepHint.${login.step}`)}</p>
                    </form>
                  )}
                </li>
              ))}
            </ul>
            {accounts.some((a) => a.status === "connected") && (
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" className={smallBtn} onClick={() => {
                  const ids = accounts.filter((a) => a.status === "connected").map((a) => a.id);
                  setSel(sel.size === ids.length ? new Set() : new Set(ids));
                }} data-testid="ai-tg-select-all">{k("selectAll")}</button>
                <button type="button" className={smallBtn} disabled={!sel.size} onClick={() => { setProfileFor(null); setBulk(!bulk); }} data-testid="ai-tg-bulk-open">
                  <MorphIcon icon={UserEdit} className="w-3.5 h-3.5" />{k("bulkEdit", { n: sel.size })}
                </button>
              </div>
            )}
            {bulk && sel.size > 0 && <TgProfileEditor mode="bulk" ids={[...sel]} onDone={profileDone} onCancel={() => setBulk(false)} />}
            <div className="flex flex-wrap gap-2">
              <input value={name} onChange={(e) => setName(e.target.value)} maxLength={30} placeholder={k("namePh")} aria-label={k("namePh")} className={`${inputCls} flex-1 min-w-[12rem]`} data-testid="ai-tg-account-name" />
              <button type="button" className={primaryBtn} disabled={!!busy} onClick={add} data-testid="ai-tg-company-add">
                <MorphIcon icon={busy === "add" ? Refresh : Add} className={`w-4 h-4 ${busy === "add" ? "animate-spin" : ""}`} />{k("add")}
              </button>
            </div>
            <p className="text-[11px] text-muted-foreground">{k("rules")}</p>
          </>
        )}
      </div>
    </Card>
  );
}
