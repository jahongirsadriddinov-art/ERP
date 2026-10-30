import { useCallback, useEffect, useState } from "react";
import { MorphIcon } from "morphicons/react";
import Search from "@hugeicons/core-free-icons/Search01Icon";
import Plus from "@hugeicons/core-free-icons/PlusSignIcon";
import Trash from "@hugeicons/core-free-icons/Delete02Icon";
import Loader2 from "@hugeicons/core-free-icons/Loading03Icon";
import { API_BASE } from "./api";
import { toast } from "sonner";
import { confirmDialog } from "./lib/confirmDialog";

// Narx manbalari (owner 2026-10-30: "qayerdan qidirishi belgilash uchun bo'lim
// och, qo'lda yoki AI qidiradi... hozir umuman qidirsa hech nima chiqmayapti").
//
// Bo'lim ikki savolga javob beradi:
//   1) NEGA qidiruvda hech nima chiqmayapti — indeksda nechta narx bor, qaysi
//      manbadan, oxirgisi qachon kelgan. Taxmin qilish shart emas.
//   2) QAYERDAN yig'ilsin — kanallarni qo'lda qo'shish yoki AI'ga topdirish.
//
// AI faqat NOMZOD taklif qiladi: har bir kanal serverda SINAB KO'RILADI
// (sahifasi o'qiladi, narx chiqadimi sanaladi) va natija shu yerda ko'rinadi.
// Qo'shish qarori — har doim odamniki.

type Status = {
  total: number; last7days: number;
  bySource: Record<string, number>;
  newestAt: string | null;
  channels: string[];
  needs: { minPoints: number; minCompanies: number; windowDays: number };
};

type Candidate = { channel: string; prices: number; posts: number; sample?: string; already: boolean };

const SOURCE_LABEL: Record<string, string> = {
  receipt: "Xaridlar va kataloglar",
  telegram: "Telegram kanallari",
  olx: "OLX e'lonlari",
  manual: "Qo'lda kiritilgan",
};

async function api(path: string, init?: RequestInit): Promise<any> {
  const r = await fetch(`${API_BASE}/api/market-price${path}`, init);
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d?.error || "Server xatoligi");
  return d;
}

export default function PriceSourcesPanel() {
  const [status, setStatus] = useState<Status | null>(null);
  const [channels, setChannels] = useState<string[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState<"" | "save" | "suggest" | "collect" | "probe">("");
  const [cands, setCands] = useState<Candidate[] | null>(null);
  const [aiUsed, setAiUsed] = useState(false);

  const load = useCallback(() => {
    api("/status")
      .then((d: Status) => { setStatus(d); setChannels(d.channels || []); })
      .catch((e) => toast.error(String(e.message)));
  }, []);

  useEffect(load, [load]);

  const save = async (next: string[]) => {
    setBusy("save");
    try {
      const d = await api("/channels", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channels: next }),
      });
      setChannels(d.channels || next);
      toast.success("Saqlandi");
    } catch (e: any) {
      toast.error(String(e.message));
    } finally {
      setBusy("");
    }
  };

  const add = async (name: string) => {
    const c = name.trim().replace(/^@/, "").replace(/^https?:\/\/t\.me\//i, "").split(/[/?#]/)[0];
    if (!/^[A-Za-z0-9_]{4,32}$/.test(c)) { toast.error("Kanal nomi noto'g'ri"); return; }
    if (channels.some((x) => x.toLowerCase() === c.toLowerCase())) { toast.error("Bu kanal allaqachon bor"); return; }
    await save([...channels, c]);
    setInput("");
  };

  const remove = async (c: string) => {
    if (!(await confirmDialog(`"${c}" kanali olib tashlansinmi?`))) return;
    await save(channels.filter((x) => x !== c));
  };

  const suggest = async () => {
    setBusy("suggest"); setCands(null);
    try {
      const d = await api("/channels/suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: input.trim() || undefined }),
      });
      setCands(d.candidates || []);
      setAiUsed(!!d.aiUsed);
      const working = (d.candidates || []).filter((c: Candidate) => c.prices > 0).length;
      toast.success(working ? `${working} ta ishlaydigan kanal topildi` : "Ishlaydigan kanal topilmadi");
    } catch (e: any) {
      toast.error(String(e.message));
    } finally {
      setBusy("");
    }
  };

  const probe = async () => {
    const c = input.trim();
    if (!c) return;
    setBusy("probe");
    try {
      const r: Candidate = await api("/channels/probe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel: c }),
      });
      setCands([r]);
      toast[r.prices > 0 ? "success" : "error"](
        r.prices > 0 ? `${r.prices} ta narx topildi` : "Bu kanaldan narx chiqmadi",
      );
    } catch (e: any) {
      toast.error(String(e.message));
    } finally {
      setBusy("");
    }
  };

  const collect = async () => {
    setBusy("collect");
    try {
      const d = await api("/collect", { method: "POST" });
      toast.success(`Telegram: ${d.prices || 0} narx · OLX: ${d.olx?.prices ?? 0}`);
      load();
    } catch (e: any) {
      toast.error(String(e.message));
    } finally {
      setBusy("");
    }
  };

  const enough = !!status && status.total >= status.needs.minPoints;

  return (
    <div className="p-3 space-y-3 max-w-2xl" data-testid="price-sources-panel">

      {/* 1-savol: nega qidiruvda hech nima chiqmayapti */}
      <div className="surface rounded-xl p-4 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-bold">Narx indeksi</h3>
          <button type="button" onClick={collect} disabled={busy !== ""}
            data-testid="price-collect-now"
            className="btn btn-outline text-xs px-3 py-1.5 rounded-full disabled:opacity-60">
            {busy === "collect" ? "Yig'ilmoqda…" : "Hozir yig'ish"}
          </button>
        </div>

        {!status ? <p className="text-[12px] text-muted-foreground">Yuklanmoqda…</p> : (
          <>
            <p className="text-2xl font-bold">
              {status.total.toLocaleString("uz-UZ")}
              <span className="text-sm font-semibold text-muted-foreground"> ta narx</span>
            </p>
            <p className="text-[12px] text-muted-foreground">
              Oxirgi 7 kunda: {status.last7days.toLocaleString("uz-UZ")} ta
              {status.newestAt ? ` · eng yangisi ${new Date(status.newestAt).toLocaleDateString("uz-UZ")}` : ""}
            </p>
            <div className="flex flex-wrap gap-1.5 pt-1">
              {Object.entries(status.bySource).map(([k, n]) => (
                <span key={k} className="text-[11px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                  {SOURCE_LABEL[k] || k}: {n.toLocaleString("uz-UZ")}
                </span>
              ))}
              {!Object.keys(status.bySource).length && (
                <span className="text-[11px] text-muted-foreground">Hali hech qanday manba yo'q</span>
              )}
            </div>
            {!enough && (
              <p className="text-[12px] text-amber-600 dark:text-amber-400 pt-1 leading-relaxed">
                Qidiruv bo'sh qaytishining sababi shu: xulosa chiqishi uchun bitta material bo'yicha
                kamida {status.needs.minPoints} ta kuzatuv va {status.needs.minCompanies} ta turli manba
                kerak (oxirgi {status.needs.windowDays} kun ichida). Quyida kanal qo'shing yoki
                "Hozir yig'ish" ni bosing.
              </p>
            )}
          </>
        )}
      </div>

      {/* 2-savol: qayerdan yig'ilsin */}
      <div className="surface rounded-xl p-4 space-y-3">
        <h3 className="text-sm font-bold">Qayerdan qidiriladi</h3>
        <p className="text-[12px] text-muted-foreground leading-relaxed">
          Ochiq Telegram kanallari o'qiladi (t.me sahifasi orqali — akkaunt ham, kanalga a'zo bo'lish
          ham shart emas, shuning uchun AI akkauntlariga xavf yo'q).
        </p>

        <div className="flex gap-2">
          <label className="flex items-center gap-2 rounded-xl bg-muted/50 px-3 h-11 flex-1 min-w-0">
            <span className="text-muted-foreground text-sm">@</span>
            <input value={input} onChange={(e) => setInput(e.target.value)}
              data-testid="price-channel-input"
              placeholder="kanal nomi yoki qidiruv so'zi"
              className="bg-transparent outline-none text-base w-full min-w-0" />
          </label>
          <button type="button" onClick={() => add(input)} disabled={busy !== "" || !input.trim()}
            data-testid="price-channel-add"
            className="btn btn-primary px-3 rounded-xl disabled:opacity-60" title="Qo'shish">
            <MorphIcon icon={Plus} className="w-4 h-4" />
          </button>
        </div>

        <div className="flex gap-2">
          <button type="button" onClick={probe} disabled={busy !== "" || !input.trim()}
            className="btn btn-outline flex-1 text-xs py-2 rounded-xl disabled:opacity-60">
            {busy === "probe" ? "Sinalmoqda…" : "Sinab ko'rish"}
          </button>
          <button type="button" onClick={suggest} disabled={busy !== ""}
            data-testid="price-channel-suggest"
            className="btn btn-outline flex-1 text-xs py-2 rounded-xl flex items-center justify-center gap-1.5 disabled:opacity-60">
            {busy === "suggest"
              ? <><MorphIcon icon={Loader2} className="w-3.5 h-3.5 animate-spin" /> Qidirilmoqda…</>
              : <><MorphIcon icon={Search} className="w-3.5 h-3.5" /> AI topsin</>}
          </button>
        </div>

        {/* Ulangan kanallar */}
        <div className="space-y-1.5">
          <p className="text-[11px] font-semibold text-muted-foreground">
            Ulangan kanallar ({channels.length})
          </p>
          {!channels.length && (
            <p className="text-[12px] text-muted-foreground">
              Hali kanal ulanmagan — narx faqat firmalarning o'z xaridlaridan yig'ilmoqda.
            </p>
          )}
          {channels.map((c) => (
            <div key={c} className="flex items-center justify-between gap-2 rounded-xl border border-border px-3 py-2">
              <a href={`https://t.me/${c}`} target="_blank" rel="noopener noreferrer"
                className="text-sm font-medium truncate hover:underline">@{c}</a>
              <button type="button" onClick={() => remove(c)} disabled={busy !== ""}
                aria-label={`${c} ni olib tashlash`}
                className="p-1.5 rounded-lg text-destructive hover:bg-destructive/10 disabled:opacity-60">
                <MorphIcon icon={Trash} className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Nomzodlar — har biri serverda sinab ko'rilgan */}
      {cands && (
        <div className="surface rounded-xl p-4 space-y-2">
          <h3 className="text-sm font-bold">Topilgan nomzodlar</h3>
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            {aiUsed ? "AI Google orqali qidirdi" : "AI javob bermadi — zaxira ro'yxat ishlatildi"}.
            Har bir kanal serverda sinab ko'rildi: sahifasi o'qildi va narx chiqadimi sanaldi.
            Narx chiqmaganini qo'shishdan foyda yo'q.
          </p>
          {!cands.length && <p className="text-[12px] text-muted-foreground">Hech narsa topilmadi.</p>}
          {cands.map((c) => (
            <div key={c.channel} className="rounded-xl border border-border px-3 py-2.5 space-y-1">
              <div className="flex items-center justify-between gap-2">
                <a href={`https://t.me/${c.channel}`} target="_blank" rel="noopener noreferrer"
                  className="text-sm font-medium truncate hover:underline">@{c.channel}</a>
                {c.already ? (
                  <span className="text-[11px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground flex-shrink-0">ulangan</span>
                ) : (
                  <button type="button" onClick={() => add(c.channel)} disabled={busy !== "" || c.prices === 0}
                    className="btn btn-primary text-xs px-3 py-1 rounded-full flex-shrink-0 disabled:opacity-40">
                    Qo'shish
                  </button>
                )}
              </div>
              <p className={`text-[11px] ${c.prices > 0 ? "text-green-600 dark:text-green-400" : "text-muted-foreground"}`}>
                {c.posts} ta post · {c.prices} ta narx
              </p>
              {c.sample && <p className="text-[11px] text-muted-foreground truncate">Masalan: {c.sample}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
