import { useEffect, useRef, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { MorphIcon } from "morphicons/react";
import Refresh from "@hugeicons/core-free-icons/Refresh01Icon";
import ImageIcon from "@hugeicons/core-free-icons/Image01Icon";
import { API_BASE } from "../../api";

// AI Telegram akkaunti profili (owner 2026-10-19): rasm, ism, familiya, bio, username — bittalab (mode "one") yoki
// tanlangan akkauntlarga birdan (mode "bulk": username yo'q — har akkauntda noyob bo'lishi shart).
// Rasm brauzerda 640×640 JPEG'ga kichraytiriladi (≈100 KB) — keyin yuboriladi.

const BASE = "/api/ai-voice/platform/tg-accounts";
const inputCls = "h-10 w-full rounded-lg border border-border bg-card/70 px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20";
const smallBtn = "h-9 px-3 rounded-lg border border-border text-xs font-semibold inline-flex items-center gap-1.5 disabled:opacity-50";

async function call<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<{ ok: boolean; data: T; error: string }> {
  try {
    const r = await fetch(`${API_BASE}${BASE}${path}`, {
      method, cache: "no-store",
      headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const data = await r.json().catch(() => null);
    return { ok: r.ok, data: data as T, error: r.ok ? "" : String(data?.error || `http_${r.status}`) };
  } catch {
    return { ok: false, data: undefined as T, error: "network" };
  }
}

/** Rasmni kvadrat qilib kesib 640×640 JPEG'ga aylantiradi (data URL). */
async function toSquareJpeg(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((ok, bad) => { const i = new Image(); i.onload = () => ok(i); i.onerror = bad; i.src = url; });
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    if (side < 160) throw new Error("small");
    const c = document.createElement("canvas");
    c.width = c.height = 640;
    const ctx = c.getContext("2d")!;
    ctx.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, 640, 640);
    return c.toDataURL("image/jpeg", 0.88);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export default function TgProfileEditor({ mode, ids, onDone, onCancel }: {
  mode: "one" | "bulk"; ids: string[]; onDone: (accounts?: unknown) => void; onCancel: () => void;
}) {
  const { t, i18n } = useTranslation();
  const k = (s: string, o?: Record<string, unknown>) => t(`aiVoice.telegram.profile.${s}`, o as any) as string;
  const errOf = (code: string) => (i18n.exists(`aiVoice.telegram.profile.err.${code}`) ? k(`err.${code}`) : (t("aiVoice.telegram.errors.generic", { code }) as string));
  const [loading, setLoading] = useState(mode === "one");
  const [cur, setCur] = useState<{ firstName: string; lastName: string; username: string; about: string; photo?: string } | null>(null);
  const [first, setFirst] = useState("");
  const [last, setLast] = useState("");
  const [about, setAbout] = useState("");
  const [username, setUsername] = useState("");
  const [photo, setPhoto] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (mode !== "one") return;
    let alive = true;
    (async () => {
      const r = await call<{ firstName: string; lastName: string; username: string; about: string; photo?: string }>("GET", `/${ids[0]}/profile`);
      if (!alive) return;
      setLoading(false);
      if (!r.ok) { toast.error(errOf(r.error)); return; }
      setCur(r.data);
      setFirst(r.data.firstName); setLast(r.data.lastName); setAbout(r.data.about); setUsername(r.data.username);
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, ids.join(",")]);

  const pick = async (f: File | undefined) => {
    if (!f) return;
    try { setPhoto(await toSquareJpeg(f)); } catch { toast.error(k("err.photo_invalid")); }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const patch: Record<string, string> = {};
    if (mode === "one") {
      if (first.trim() !== (cur?.firstName || "")) patch.firstName = first.trim();
      if (last.trim() !== (cur?.lastName || "")) patch.lastName = last.trim();
      if (about.trim() !== (cur?.about || "")) patch.about = about.trim();
      if (username.trim().replace(/^@/, "") !== (cur?.username || "")) patch.username = username.trim();
    } else {
      if (first.trim()) patch.firstName = first.trim();
      if (last.trim()) patch.lastName = last.trim();
      if (about.trim()) patch.about = about.trim();
    }
    if (photo) patch.photo = photo;
    if (!Object.keys(patch).length) { onCancel(); return; }
    setBusy(true);
    if (mode === "one") {
      const r = await call<{ accounts: unknown }>("POST", `/${ids[0]}/profile`, patch);
      setBusy(false);
      if (!r.ok) { toast.error(errOf(r.error)); return; }
      toast.success(k("saved"));
      onDone(r.data.accounts);
    } else {
      const r = await call<{ results: { id: string; ok: boolean; error?: string }[]; accounts: unknown }>("POST", "/profile-bulk", { ids, ...patch });
      setBusy(false);
      if (!r.ok) { toast.error(errOf(r.error)); return; }
      const okN = r.data.results.filter((x) => x.ok).length;
      const bad = r.data.results.filter((x) => !x.ok);
      if (bad.length) toast.error(k("bulkPartial", { ok: okN, total: ids.length, reason: errOf(bad[0].error || "error") }));
      else toast.success(k("bulkDone", { n: okN }));
      onDone(r.data.accounts);
    }
  };

  const shown = photo || (cur?.photo ? `data:image/jpeg;base64,${cur.photo}` : "");
  return (
    <form onSubmit={submit} className="w-full rounded-xl border border-primary/30 bg-primary/[0.04] p-3 space-y-2.5" data-testid={`ai-tg-profile-${mode}`}>
      <p className="text-xs font-semibold">{mode === "one" ? k("titleOne") : k("titleBulk", { n: ids.length })}</p>
      {loading ? <p className="text-xs text-muted-foreground">{k("loading")}</p> : (
        <>
          <div className="flex items-center gap-3">
            <div className="w-16 h-16 rounded-full bg-muted overflow-hidden flex items-center justify-center flex-shrink-0">
              {shown ? <img src={shown} alt="" className="w-full h-full object-cover" /> : <MorphIcon icon={ImageIcon} className="w-6 h-6 text-muted-foreground" />}
            </div>
            <div className="space-y-1">
              <button type="button" className={smallBtn} onClick={() => fileRef.current?.click()}>
                <MorphIcon icon={ImageIcon} className="w-3.5 h-3.5" />{k("photo")}
              </button>
              <p className="text-[11px] text-muted-foreground">{k("photoHint")}</p>
            </div>
            <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = ""; }} />
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <input value={first} onChange={(e) => setFirst(e.target.value)} maxLength={64} placeholder={mode === "bulk" ? k("firstBulk") : k("first")} aria-label={k("first")} className={inputCls} />
            <input value={last} onChange={(e) => setLast(e.target.value)} maxLength={64} placeholder={k("last")} aria-label={k("last")} className={inputCls} />
            <input value={about} onChange={(e) => setAbout(e.target.value)} maxLength={70} placeholder={k("about")} aria-label={k("about")} className={`${inputCls} sm:col-span-2`} />
            {mode === "one" && (
              <input value={username} onChange={(e) => setUsername(e.target.value)} maxLength={33} placeholder={k("username")} aria-label={k("username")}
                autoComplete="off" spellCheck={false} className={`${inputCls} sm:col-span-2`} />
            )}
          </div>
          <p className="text-[11px] text-muted-foreground">{mode === "one" ? k("hintOne") : k("hintBulk")}</p>
          <div className="flex flex-wrap gap-2">
            <button type="submit" disabled={busy} className="h-10 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-semibold inline-flex items-center gap-2 disabled:opacity-50" data-testid="ai-tg-profile-save">
              {busy && <MorphIcon icon={Refresh} className="w-4 h-4 animate-spin" />}{k("save")}
            </button>
            <button type="button" className="h-10 px-4 rounded-lg border border-border text-sm" onClick={onCancel}>{k("cancel")}</button>
          </div>
        </>
      )}
    </form>
  );
}
