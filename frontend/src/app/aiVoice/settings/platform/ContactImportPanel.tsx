import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MorphIcon } from "morphicons/react";
import Search from "@hugeicons/core-free-icons/Search01Icon";
import Loader2 from "@hugeicons/core-free-icons/Loading03Icon";
import { API_BASE } from "../../../api";
import { toast } from "sonner";

// Kontaktlarni qo'lda qo'shish (owner 2026-10-30: "hamma userlar chiqadi,
// hohlasam bittalab, hohlasam qanchadir, hohlasam hammasini bittada,
// hohlasam aynan qaysidir firmani userlarini qiladigan qil").
//
// NEGA KERAK: Telegram notanish odamga qo'ng'iroq qilishni cheklaydi
// (PeerFloodError). Odam AI akkauntining kontaktida bo'lsa — cheklov tegmaydi.
// Avtomatik qo'shish soatiga bir nechta bilan cheklangan, shuning uchun yangi
// xodimlar uzoq navbatda turardi.
//
// Jarayon UZOQ (har biri orasida tanaffus — akkaunt bloklanmasligi uchun),
// shuning uchun fonda ketadi va holati shu yerda ko'rinib turadi.

type Cand = {
  id: string; name: string; role: string; companyId: string; companyName: string;
  linked: boolean; status: string;
  /** Nechta ulangan akkauntga qo'shilgan. */
  accounts: number; accountsTotal: number;
};
type Progress = {
  running: boolean; total: number; done: number; ok: number; failed: number;
  startedAt: string | null; finishedAt: string | null; current: string | null;
  results: { name: string; status: string }[];
};
type Limits = { maxPerRun: number; gapSeconds: number };

const BASE = `${API_BASE}/api/ai-voice/platform`;

const STATUS_UZ: Record<string, string> = {
  resolved: "qo'shildi",
  privacy_restricted: "maxfiylik sozlamasi to'sdi",
  not_found: "topilmadi",
  no_telegram: "Telegram ulanmagan",
  no_consent: "rozilik yo'q",
  no_phone: "telefon yo'q",
  flood_wait: "Telegram vaqtincha cheklovga qo'ydi",
  error: "xato",
};

async function api(path: string, init?: RequestInit): Promise<any> {
  const r = await fetch(`${BASE}${path}`, init);
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d?.error || "Server xatoligi");
  return d;
}

export default function ContactImportPanel() {
  const [users, setUsers] = useState<Cand[]>([]);
  const [limits, setLimits] = useState<Limits>({ maxPerRun: 60, gapSeconds: 20 });
  // Ulangan AI Telegram akkauntlari — kontakt HAMMASIGA bittada qo'shiladi
  const [accounts, setAccounts] = useState<string[]>([]);
  // Allaqachon qo'shilganlar odatda ro'yxatda ko'rinmaydi (owner 2026-10-30);
  // tekshirish kerak bo'lsa shu bilan ko'rsatiladi.
  const [showDone, setShowDone] = useState(false);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [q, setQ] = useState("");
  const [company, setCompany] = useState("");
  const [busy, setBusy] = useState(false);
  const [prog, setProg] = useState<Progress | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(() => {
    api(`/contacts/candidates${showDone ? "?all=1" : ""}`)
      .then((d) => { setUsers(d.users || []); if (d.limits) setLimits(d.limits); setAccounts(d.accounts || []); })
      .catch((e) => toast.error(String(e.message)));
  }, [showDone]);

  const pollStatus = useCallback(() => {
    api("/contacts/import/status").then((p: Progress) => {
      setProg(p);
      if (!p.running && timer.current) { clearInterval(timer.current); timer.current = null; load(); }
    }).catch(() => undefined);
  }, [load]);

  useEffect(() => {
    load();
    pollStatus();
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [load, pollStatus]);

  const companies = useMemo(() => {
    const m = new Map<string, string>();
    for (const u of users) if (u.companyId) m.set(u.companyId, u.companyName);
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [users]);

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return users.filter((u) =>
      (!company || u.companyId === company) &&
      (!s || u.name.toLowerCase().includes(s) || u.companyName.toLowerCase().includes(s)));
  }, [users, q, company]);

  const toggle = (id: string) => setSel((prev) => {
    const n = new Set(prev);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });

  /** Ko'rinib turgan ro'yxatni to'liq tanlash/bekor qilish — firma filtri bilan birga ishlaydi. */
  const toggleAllShown = () => setSel((prev) => {
    const ids = shown.map((u) => u.id);
    const allIn = ids.every((id) => prev.has(id));
    const n = new Set(prev);
    for (const id of ids) { if (allIn) n.delete(id); else n.add(id); }
    return n;
  });

  const start = async () => {
    if (!sel.size) { toast.error("Hech kim tanlanmadi"); return; }
    setBusy(true);
    try {
      const d = await api("/contacts/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userIds: [...sel] }),
      });
      toast.success(`${d.total} ta kontakt qo'shilmoqda`);
      setSel(new Set());
      pollStatus();
      if (!timer.current) timer.current = setInterval(pollStatus, 4000);
    } catch (e: any) {
      toast.error(String(e.message));
    } finally {
      setBusy(false);
    }
  };

  const stop = async () => {
    try { setProg(await api("/contacts/import/stop", { method: "POST" })); toast.success("To'xtatilmoqda"); }
    catch (e: any) { toast.error(String(e.message)); }
  };

  const selectedShown = shown.filter((u) => sel.has(u.id)).length;
  const minutes = Math.ceil((sel.size * limits.gapSeconds) / 60);

  return (
    <div className="p-3 space-y-3 max-w-2xl" data-testid="contact-import-panel">
      <div className="surface rounded-xl p-4 space-y-2">
        <h3 className="text-sm font-bold">Kontaktga qo'shish</h3>
        <p className="text-[12px] text-muted-foreground leading-relaxed">
          Telegram notanish odamga qo'ng'iroq qilishni cheklaydi. Xodim AI akkauntining
          kontaktida bo'lsa — cheklov unga tegmaydi va qo'ng'iroq o'tadi.
          Kontakt <b>ulangan barcha akkauntlarga bittada</b> qo'shiladi
          {accounts.length ? ` (hozir ${accounts.length} ta)` : ""} — asosiysiga ham, qolganlariga ham.
          Bitta yurishda {limits.maxPerRun} tagacha, orasida {limits.gapSeconds} soniya tanaffus
          bilan — tez qo'shish akkauntni bloklanishga olib keladi.
        </p>
        <label className="flex items-center gap-2 text-[12px] text-muted-foreground cursor-pointer">
          <input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)}
            data-testid="contact-import-show-done" className="w-4 h-4 accent-[var(--primary)]" />
          Allaqachon qo'shilganlarni ham ko'rsatish
        </label>
      </div>

      {prog?.running && (
        <div className="surface rounded-xl p-4 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-semibold flex items-center gap-2">
              <MorphIcon icon={Loader2} className="w-4 h-4 animate-spin" />
              {prog.done}/{prog.total} — {prog.current || "..."}
            </p>
            <button type="button" onClick={stop} className="btn btn-outline text-xs px-3 py-1.5 rounded-full text-destructive border-destructive/40">
              To'xtatish
            </button>
          </div>
          <div className="h-1.5 rounded-full bg-muted overflow-hidden">
            <div className="h-full bg-primary transition-all" style={{ width: `${prog.total ? (prog.done / prog.total) * 100 : 0}%` }} />
          </div>
          <p className="text-[11px] text-muted-foreground">Qo'shildi: {prog.ok} · bo'lmadi: {prog.failed}</p>
        </div>
      )}

      {!prog?.running && !!prog?.results?.length && (
        <div className="surface rounded-xl p-4 space-y-1.5">
          <p className="text-sm font-semibold">Oxirgi natija: {prog.ok} qo'shildi, {prog.failed} bo'lmadi</p>
          <div className="max-h-40 overflow-y-auto scrollbar-hide space-y-0.5">
            {prog.results.map((r, i) => (
              <p key={`${r.name}-${i}`} className="text-[11px] text-muted-foreground flex justify-between gap-2">
                <span className="truncate">{r.name}</span>
                <span className={r.status === "resolved" ? "text-green-600 dark:text-green-400 flex-shrink-0" : "flex-shrink-0"}>
                  {STATUS_UZ[r.status] || r.status}
                </span>
              </p>
            ))}
          </div>
        </div>
      )}

      <div className="surface rounded-xl p-4 space-y-3">
        <div className="flex gap-2">
          <label className="flex items-center gap-2 rounded-xl bg-muted/50 px-3 h-11 flex-1 min-w-0">
            <MorphIcon icon={Search} className="w-4 h-4 flex-shrink-0 opacity-60" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ism yoki firma"
              data-testid="contact-import-search"
              className="bg-transparent outline-none text-base w-full min-w-0" />
          </label>
          <select value={company} onChange={(e) => setCompany(e.target.value)}
            data-testid="contact-import-company"
            className="rounded-xl bg-muted/50 px-3 h-11 text-sm max-w-[42%]">
            <option value="">Barcha firmalar</option>
            {companies.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
        </div>

        <div className="flex items-center justify-between gap-2">
          <button type="button" onClick={toggleAllShown} data-testid="contact-import-all"
            className="btn btn-outline text-xs px-3 py-1.5 rounded-full">
            {shown.length && selectedShown === shown.length ? "Belgilashni bekor qilish" : `Ko'rinayotganini tanlash (${shown.length})`}
          </button>
          <span className="text-[11px] text-muted-foreground">
            Tanlandi: {sel.size}{sel.size ? ` · ~${minutes} daq` : ""}
          </span>
        </div>

        <div className="max-h-[46vh] overflow-y-auto scrollbar-hide space-y-1">
          {!shown.length && (
            <p className="text-[12px] text-muted-foreground">
              {showDone ? "Hech kim topilmadi." : "Hammasi qo'shilgan — qo'shiladigan odam qolmadi."}
            </p>
          )}
          {shown.map((u) => (
            <label key={u.id} className={`flex items-center gap-2.5 px-3 py-2 rounded-xl border liquid-transition cursor-pointer ${
              sel.has(u.id) ? "border-primary bg-primary/10" : "border-border hover:bg-muted/50"
            }`}>
              <input type="checkbox" checked={sel.has(u.id)} onChange={() => toggle(u.id)}
                className="w-4 h-4 flex-shrink-0 accent-[var(--primary)]" />
              <span className="min-w-0 flex-1">
                <span className="text-sm font-medium block truncate">{u.name}</span>
                <span className="text-[11px] text-muted-foreground truncate block">
                  {u.companyName} · {u.role}
                  {!u.linked && " · Telegram ulanmagan"}
                  {u.accountsTotal > 0 && u.accounts > 0 && ` · ${u.accounts}/${u.accountsTotal} akkauntda bor`}
                </span>
              </span>
            </label>
          ))}
        </div>

        <button type="button" onClick={start} disabled={busy || !sel.size || !!prog?.running}
          data-testid="contact-import-start"
          className="btn btn-primary w-full text-sm py-2.5 rounded-xl disabled:opacity-60">
          {prog?.running ? "Jarayon ketyapti…" : busy ? "Boshlanmoqda…" : `Kontaktga qo'shish (${sel.size})`}
        </button>
      </div>
    </div>
  );
}
