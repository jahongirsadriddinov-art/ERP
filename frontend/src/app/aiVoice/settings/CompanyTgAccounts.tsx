import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { MorphIcon } from "morphicons/react";
import Telegram from "@hugeicons/core-free-icons/TelegramIcon";
import Refresh from "@hugeicons/core-free-icons/Refresh01Icon";
import Logout from "@hugeicons/core-free-icons/Logout01Icon";
import Delete from "@hugeicons/core-free-icons/Delete02Icon";
import Add from "@hugeicons/core-free-icons/Add01Icon";
import { API_BASE } from "../../api";
import { Badge, Card, type Tone } from "./ui";

// Dasturchi paneli → AI → Telegram → "Firma Telegram akkauntlari" (owner 2026-10-19): firmani tanlab hohlagancha
// Telegram profil qo'shiladi; qo'ng'iroq shu firmaning bo'sh akkaunti orqali ketadi (biri band bo'lsa — keyingisi).
// XAVFSIZLIK: telefon/kod/parol faqat komponent holatida, yuborilgach tozalanadi; hech qayerga saqlanmaydi.

interface Company { id: string; name: string; accounts: number; connected: number }
interface Acc { id: string; label?: string; status: string; username?: string; displayName?: string; phoneMasked?: string; busy: boolean; lastError?: string; floodWaitUntil?: string }
interface Res<T> { ok: boolean; data: T; error: string; body: any }
type K = (s: string, o?: Record<string, unknown>) => string;

const BASE = "/api/ai-voice/platform";
async function api<T>(method: "GET" | "POST" | "DELETE", path: string, body?: unknown): Promise<Res<T>> {
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

export default function CompanyTgAccounts({ errText }: { errText: (r: { error: string; body: any }) => string }) {
  const { t } = useTranslation();
  const k: K = useCallback((s, o) => t(`aiVoice.telegram.company.${s}`, o as any) as string, [t]);
  const [companies, setCompanies] = useState<Company[] | null>(null);
  const [companyId, setCompanyId] = useState("");
  const [accounts, setAccounts] = useState<Acc[] | null>(null);
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState("");
  const [login, setLogin] = useState<{ id: string; step: "phone" | "code" | "password"; attempt?: string } | null>(null);
  const [value, setValue] = useState("");

  const loadCompanies = useCallback(async () => {
    const r = await api<{ companies: Company[] }>("GET", "/companies-lite");
    setCompanies(r.ok ? r.data?.companies || [] : []);
  }, []);
  const loadAccounts = useCallback(async (id: string) => {
    if (!id) { setAccounts(null); return; }
    const r = await api<{ accounts: Acc[] }>("GET", `/companies/${id}/tg-accounts`);
    setAccounts(r.ok ? r.data?.accounts || [] : []);
  }, []);

  useEffect(() => { loadCompanies(); }, [loadCompanies]);
  useEffect(() => { setLogin(null); setValue(""); loadAccounts(companyId); }, [companyId, loadAccounts]);
  useEffect(() => {
    if (!companyId) return;
    const id = window.setInterval(() => { if (!document.hidden && !busy && !login) loadAccounts(companyId); }, 15_000);
    return () => window.clearInterval(id);
  }, [companyId, busy, login, loadAccounts]);

  const add = async () => {
    setBusy("add");
    const r = await api<{ id: string; accounts: Acc[] }>("POST", `/companies/${companyId}/tg-accounts`, { label: label.trim() || undefined });
    setBusy("");
    if (!r.ok) { toast.error(r.error === "too_many" ? k("tooMany") : errText(r)); return; }
    setLabel("");
    setAccounts(r.data.accounts);
    setLogin({ id: r.data.id, step: "phone" });
    loadCompanies();
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!login || !value.trim()) return;
    const path = `/companies/${companyId}/tg-accounts/${login.id}/login/${login.step === "phone" ? "start" : login.step}`;
    const body = login.step === "phone" ? { phone: value.trim() } : login.step === "code" ? { code: value.trim(), loginAttemptId: login.attempt } : { password: value, loginAttemptId: login.attempt };
    setBusy("login");
    const r = await api<{ status: string; loginAttemptId?: string; accounts?: Acc[] }>("POST", path, body);
    setBusy("");
    setValue("");
    if (!r.ok) { toast.error(errText(r)); if (r.error === "attempt_expired") setLogin({ id: login.id, step: "phone" }); return; }
    if (r.data.status === "connected") {
      toast.success(k("connected"));
      setLogin(null);
      if (r.data.accounts) setAccounts(r.data.accounts); else loadAccounts(companyId);
      loadCompanies();
      return;
    }
    setLogin({ id: login.id, step: r.data.status === "awaiting_password" ? "password" : "code", attempt: r.data.loginAttemptId || login.attempt });
  };

  const logout = async (a: Acc) => {
    if (!window.confirm(k("logoutConfirm"))) return;
    setBusy(`out:${a.id}`);
    const r = await api<{ accounts: Acc[] }>("POST", `/companies/${companyId}/tg-accounts/${a.id}/logout`, {});
    setBusy("");
    if (!r.ok) { toast.error(errText(r)); return; }
    setAccounts(r.data.accounts);
    loadCompanies();
  };
  const remove = async (a: Acc) => {
    if (!window.confirm(k("removeConfirm"))) return;
    setBusy(`rm:${a.id}`);
    const r = await api<{ accounts: Acc[] }>("DELETE", `/companies/${companyId}/tg-accounts/${a.id}`);
    setBusy("");
    if (!r.ok) { toast.error(r.error === "busy" ? k("removeBusy") : errText(r)); return; }
    setAccounts(r.data.accounts);
    if (login?.id === a.id) setLogin(null);
    loadCompanies();
  };

  return (
    <Card icon={Telegram} title={k("title")} hint={k("hint")} testId="ai-tg-company-accounts">
      <div className="space-y-3">
        <select value={companyId} onChange={(e) => setCompanyId(e.target.value)} className={inputCls} aria-label={k("pickCompany")} data-testid="ai-tg-company-select">
          <option value="">{companies === null ? k("loading") : k("pickCompany")}</option>
          {(companies || []).map((c) => (
            <option key={c.id} value={c.id}>{c.name}{c.accounts ? ` — ${k("countShort", { connected: c.connected, total: c.accounts })}` : ""}</option>
          ))}
        </select>

        {companyId && accounts === null && <p className="text-xs text-muted-foreground">{k("loading")}</p>}

        {companyId && accounts && (
          <>
            {accounts.length === 0 && <p className="text-xs text-muted-foreground">{k("empty")}</p>}
            <ul className="space-y-2">
              {accounts.map((a) => (
                <li key={a.id} className="rounded-xl border border-border p-3 flex flex-wrap items-center gap-2 justify-between" data-testid="ai-tg-company-account">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold truncate">{a.label || a.displayName || (a.username ? `@${a.username}` : k("unnamed"))}</span>
                      <Badge tone={TONE[a.status] || "gray"}>{k(`status.${a.status}`)}</Badge>
                      {a.busy && <Badge tone="amber">{k("busy")}</Badge>}
                      {a.floodWaitUntil && <Badge tone="red">{k("flood")}</Badge>}
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      {[a.username ? `@${a.username}` : "", a.phoneMasked || ""].filter(Boolean).join(" · ")}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {a.status !== "connected" && (
                      <button type="button" className={smallBtn} disabled={!!busy} onClick={() => { setValue(""); setLogin({ id: a.id, step: "phone" }); }}>
                        <MorphIcon icon={Telegram} className="w-3.5 h-3.5" />{k("connect")}
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
            <div className="flex flex-wrap gap-2">
              <input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={60} placeholder={k("labelPh")} aria-label={k("labelPh")} className={`${inputCls} flex-1 min-w-[12rem]`} />
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
