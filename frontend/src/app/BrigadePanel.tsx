import { useCallback, useEffect, useState } from "react";
import { MorphIcon } from "morphicons/react";
import Search from "@hugeicons/core-free-icons/Search01Icon";
import X from "@hugeicons/core-free-icons/Cancel01Icon";
import ChevronLeft from "@hugeicons/core-free-icons/ArrowLeft01Icon";
import Plus from "@hugeicons/core-free-icons/PlusSignIcon";
import { API_BASE } from "./api";
import { fmtNumber } from "./lib/money";
import { toast } from "sonner";
import { promptDialog } from "./lib/confirmDialog";

// Brigada reytingi (owner 2026-10-29: "brigader reytingini qo'sh").
//
// Qoidalar (owner qarorlari):
//  1) Baho rahbar (direktor/o'rinbosar) tasdiqlaguncha hech kimga ko'rinmaydi va
//     reytingga qo'shilmaydi. Baho beruvchi ma'lumotni QAYERDAN olganini aytadi —
//     havola majburiy, tasdiqlovchi uni ochib tekshiradi.
//  2) Pul kelishuvi shu yerda qayd etiladi: birlik narxi (m², m³, dona, kun)
//     × hajm = kelishilgan summa; shtraf bo'lsa ayiriladi. Hisobni SERVER qiladi.
//  3) Nizo bo'lsa — rad etish sababi yoziladi va baho beruvchi shu yerda ko'radi.
//
// MA'LUMOTNOMA UMUMIY: barcha firmalar bir xil ro'yxatni ko'radi — reytingning
// foydasi shunda. Lekin KIM baho berganini hech kim ko'rmaydi, faqat "nechta
// firma baholagan" soni.

type Brigade = {
  id: string; name: string; leaderName: string; phone: string;
  region: string; specializations: string[];
  avgScore: number; reviewCount: number; firmCount: number; mine?: boolean;
};

type Review = {
  id: string; score: number; comment: string;
  workType: string; unit: string; volume: number | null; ratePerUnit: number | null;
  agreedTotal: number | null; penalty: number; penaltyReason: string; payable: number | null;
  sourceUrl: string; sourceVerified: boolean; at?: string;
  status?: string; rejectReason?: string;
  brigadeId?: string; brigadeName?: string; sourceNote?: string;
};

const UNITS = ["m2", "m3", "dona", "kun", "t", "m"];

function Stars({ score, size = "text-base" }: { score: number; size?: string }) {
  const full = Math.round(score);
  return (
    <span className={`${size} tracking-tight`} aria-label={`${score} / 5`}>
      <span className="text-amber-500">{"★".repeat(full)}</span>
      <span className="text-muted-foreground/35">{"★".repeat(Math.max(0, 5 - full))}</span>
    </span>
  );
}

async function api(path: string, init?: RequestInit): Promise<any> {
  const r = await fetch(`${API_BASE}/api/brigades${path}`, init);
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body?.error || "Server xatoligi");
  return body;
}

export default function BrigadePanel({ onClose, canApprove }: { onClose: () => void; canApprove: boolean }) {
  const [view, setView] = useState<"list" | "card" | "add" | "pending">("list");
  const [q, setQ] = useState("");
  const [list, setList] = useState<Brigade[]>([]);
  const [busy, setBusy] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [card, setCard] = useState<{ brigade: Brigade; reviews: Review[]; myReview: Review | null } | null>(null);
  const [pending, setPending] = useState<Review[]>([]);

  // Ro'yxat — yozishdan keyin 400 ms kutib so'raladi (har harfga so'rov ketmasin)
  useEffect(() => {
    if (view !== "list") return;
    let alive = true;
    setBusy(true);
    const t = setTimeout(() => {
      api(`?q=${encodeURIComponent(q.trim())}`)
        .then((d) => { if (alive) setList(d.brigades || []); })
        .catch(() => { if (alive) setList([]); })
        .finally(() => { if (alive) setBusy(false); });
    }, q.trim() ? 400 : 0);
    return () => { alive = false; clearTimeout(t); };
  }, [q, view]);

  const loadCard = useCallback((id: string) => {
    setOpenId(id); setView("card"); setCard(null);
    api(`/${id}`).then(setCard).catch((e) => { toast.error(String(e.message)); setView("list"); });
  }, []);

  const loadPending = useCallback(() => {
    setView("pending");
    api("/reviews/pending").then((d) => setPending(d.reviews || [])).catch((e) => toast.error(String(e.message)));
  }, []);

  return (
    <div className="fixed inset-0 z-[90] bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-card rounded-2xl border border-border shadow-2xl w-full max-w-md max-h-[88vh] supports-[height:1dvh]:max-h-[88dvh] overflow-y-auto"
        data-testid="brigade-panel" onClick={(e) => e.stopPropagation()}>

        <div className="flex items-center justify-between px-4 py-3.5 border-b border-border sticky top-0 bg-card z-10">
          <div className="flex items-center gap-2 min-w-0">
            {view !== "list" && (
              <button aria-label="Orqaga" onClick={() => setView("list")} className="p-1.5 -ml-1.5 rounded-lg hover:bg-muted liquid-transition">
                <MorphIcon icon={ChevronLeft} className="w-4 h-4" />
              </button>
            )}
            <div className="min-w-0">
              <h3 className="font-bold text-sm truncate">
                {view === "add" ? "Yangi brigada" : view === "pending" ? "Tasdiq kutmoqda" : view === "card" ? (card?.brigade.name || "Brigada") : "Brigadalar"}
              </h3>
              <p className="text-[11px] text-muted-foreground">
                {view === "list" ? "Reyting — barcha firmalar tajribasidan" : view === "pending" ? "Rahbar tasdiqlaydi" : "Baho va kelishuv"}
              </p>
            </div>
          </div>
          <button aria-label="Yopish" onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted liquid-transition">
            <MorphIcon icon={X} className="w-4 h-4 text-muted-foreground" />
          </button>
        </div>

        {view === "list" && (
          <div className="p-4 space-y-3">
            <label className="flex items-center gap-2.5 rounded-xl bg-muted/50 px-3.5 h-12">
              <MorphIcon icon={Search} className="w-5 h-5 flex-shrink-0 opacity-60" />
              <input value={q} onChange={(e) => setQ(e.target.value)} data-testid="brigade-query"
                placeholder="Nom, brigadir yoki raqam" className="bg-transparent outline-none text-base w-full placeholder:text-muted-foreground/70" />
            </label>

            <div className="flex gap-2">
              <button type="button" onClick={() => setView("add")} data-testid="brigade-add-open"
                className="btn btn-outline flex-1 flex items-center justify-center gap-1.5 text-sm py-2 rounded-xl">
                <MorphIcon icon={Plus} className="w-4 h-4" /> Brigada qo'shish
              </button>
              {canApprove && (
                <button type="button" onClick={loadPending} data-testid="brigade-pending-open"
                  className="btn btn-outline text-sm py-2 px-3 rounded-xl">Tasdiqlash</button>
              )}
            </div>

            {busy && !list.length ? <p className="text-[12px] text-muted-foreground py-2">Yuklanmoqda…</p>
              : !list.length ? (
                <div className="rounded-xl bg-muted/40 px-3 py-3">
                  <p className="text-[12px] text-muted-foreground">
                    {q.trim() ? "Bunday brigada topilmadi." : "Hali brigada qo'shilmagan."}
                  </p>
                  <p className="text-[11px] text-muted-foreground mt-1">
                    Birinchi bo'lib qo'shsangiz — keyin ishlagan brigadalaringizga baho qoldirasiz,
                    boshqa firmalar ham o'z tajribasini yozadi.
                  </p>
                </div>
              ) : (
                <ul className="space-y-2">
                  {list.map((b) => (
                    <li key={b.id}>
                      <button type="button" onClick={() => loadCard(b.id)}
                        className="w-full text-left rounded-xl border border-border px-3 py-2.5 hover:bg-muted/50 liquid-transition">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-semibold text-sm truncate">{b.name}</span>
                          <Stars score={b.avgScore} size="text-sm" />
                        </div>
                        <p className="text-[11px] text-muted-foreground mt-0.5 truncate">
                          {[b.region, b.specializations.join(", ")].filter(Boolean).join(" · ") || b.phone}
                        </p>
                        <p className="text-[11px] text-muted-foreground mt-0.5">
                          {b.reviewCount ? `${b.firmCount} firma bahosi (${b.reviewCount} ta)` : "Hali baho yo'q"}
                        </p>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
          </div>
        )}

        {view === "card" && <BrigadeCard data={card} onSaved={() => openId && loadCard(openId)} />}
        {view === "add" && <AddBrigade onDone={(id) => { setQ(""); loadCard(id); }} />}
        {view === "pending" && <PendingList items={pending} onChanged={loadPending} />}
      </div>
    </div>
  );
}

// ───────────────────────── Brigada kartasi va baho ─────────────────────────

function BrigadeCard({ data, onSaved }: { data: { brigade: Brigade; reviews: Review[]; myReview: Review | null } | null; onSaved: () => void }) {
  const [form, setForm] = useState(false);
  if (!data) return <p className="p-4 text-[12px] text-muted-foreground">Yuklanmoqda…</p>;
  const { brigade: b, reviews, myReview } = data;

  return (
    <div className="p-4 space-y-3">
      <div className="rounded-xl bg-primary/5 border border-primary/15 px-3 py-3">
        <div className="flex items-center justify-between gap-2">
          <Stars score={b.avgScore} />
          <span className="text-2xl font-bold text-primary">{b.avgScore ? b.avgScore.toFixed(1) : "—"}</span>
        </div>
        <p className="text-[12px] text-muted-foreground mt-1">
          {b.reviewCount ? `${b.firmCount} firma baholagan · ${b.reviewCount} ta baho` : "Hali tasdiqlangan baho yo'q"}
        </p>
        <p className="text-[12px] text-muted-foreground mt-1">
          {[b.leaderName, b.phone, b.region].filter(Boolean).join(" · ")}
        </p>
        {!!b.specializations?.length && (
          <div className="flex gap-1.5 flex-wrap mt-2">
            {b.specializations.map((s) => (
              <span key={s} className="text-[11px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground">{s}</span>
            ))}
          </div>
        )}
      </div>

      {myReview && (
        <div className="rounded-xl border border-border px-3 py-2.5">
          <p className="text-[11px] font-semibold">Sizning firmangiz bahosi: {myReview.score}/5</p>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            {myReview.status === "pending" ? "Rahbar tasdiqlashini kutmoqda — hozircha boshqalarga ko'rinmaydi."
              : myReview.status === "rejected" ? `Rad etildi: ${myReview.rejectReason}`
              : "Tasdiqlangan — reytingda hisobga olingan."}
          </p>
        </div>
      )}

      {!form && (
        <button type="button" onClick={() => setForm(true)} data-testid="brigade-review-open"
          className="btn btn-primary w-full text-sm py-2.5 rounded-xl">
          {myReview ? "Bahoni o'zgartirish" : "Baho berish"}
        </button>
      )}
      {form && <ReviewForm brigadeId={b.id} initial={myReview} onDone={() => { setForm(false); onSaved(); }} />}

      <div className="space-y-2">
        <p className="text-[11px] font-semibold text-muted-foreground">Boshqa firmalar tajribasi</p>
        {!reviews.length && <p className="text-[12px] text-muted-foreground">Hali tasdiqlangan baho yo'q.</p>}
        {reviews.map((r) => <ReviewRow key={r.id} r={r} />)}
      </div>
    </div>
  );
}

function ReviewRow({ r }: { r: Review }) {
  return (
    <div className="rounded-xl border border-border px-3 py-2.5">
      <div className="flex items-center justify-between gap-2">
        <Stars score={r.score} size="text-sm" />
        {r.sourceVerified && <span className="text-[10px] px-2 py-0.5 rounded-full bg-green-500/15 text-green-700 dark:text-green-400">Manba tekshirilgan</span>}
      </div>
      {r.comment && <p className="text-[12px] mt-1">{r.comment}</p>}
      {(r.agreedTotal || r.ratePerUnit) && (
        <p className="text-[11px] text-muted-foreground mt-1">
          {r.workType ? `${r.workType}: ` : ""}
          {r.ratePerUnit ? `${fmtNumber(r.ratePerUnit)} so'm/${r.unit || "birlik"}` : ""}
          {r.volume ? ` × ${fmtNumber(r.volume)}` : ""}
          {r.agreedTotal ? ` = ${fmtNumber(r.agreedTotal)} so'm` : ""}
        </p>
      )}
      {!!r.penalty && (
        <p className="text-[11px] text-destructive mt-0.5">
          Shtraf {fmtNumber(r.penalty)} so'm{r.penaltyReason ? ` — ${r.penaltyReason}` : ""}
          {r.payable != null ? ` · to'langan ${fmtNumber(r.payable)} so'm` : ""}
        </p>
      )}
      <a href={r.sourceUrl} target="_blank" rel="noopener noreferrer"
        className="text-[11px] text-primary hover:underline mt-1 inline-block break-all">Manba</a>
    </div>
  );
}

function ReviewForm({ brigadeId, initial, onDone }: { brigadeId: string; initial: Review | null; onDone: () => void }) {
  const [score, setScore] = useState(initial?.score || 5);
  const [comment, setComment] = useState(initial?.comment || "");
  const [workType, setWorkType] = useState(initial?.workType || "");
  const [unit, setUnit] = useState(initial?.unit || "m2");
  const [volume, setVolume] = useState(initial?.volume ? String(initial.volume) : "");
  const [rate, setRate] = useState(initial?.ratePerUnit ? String(initial.ratePerUnit) : "");
  const [penalty, setPenalty] = useState(initial?.penalty ? String(initial.penalty) : "");
  const [penaltyReason, setPenaltyReason] = useState(initial?.penaltyReason || "");
  const [sourceUrl, setSourceUrl] = useState(initial?.sourceUrl || "");
  const [busy, setBusy] = useState(false);

  const num = (s: string) => Number(String(s).replace(/[^0-9.]/g, "")) || 0;
  const agreed = num(volume) > 0 && num(rate) > 0 ? Math.round(num(volume) * num(rate)) : 0;
  const payable = agreed ? Math.max(0, agreed - num(penalty)) : 0;

  const submit = async () => {
    if (!sourceUrl.trim()) { toast.error("Manba havolasini kiriting"); return; }
    setBusy(true);
    try {
      await api(`/${brigadeId}/reviews`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          score, comment, workType, unit,
          volume: num(volume) || undefined, ratePerUnit: num(rate) || undefined,
          penalty: num(penalty) || undefined, penaltyReason,
          sourceUrl: sourceUrl.trim(),
        }),
      });
      toast.success("Baho yuborildi — rahbar tasdiqlaydi");
      onDone();
    } catch (e: any) {
      toast.error(String(e.message));
    } finally {
      setBusy(false);
    }
  };

  const inp = "w-full rounded-xl bg-muted/50 px-3 h-11 text-base outline-none";

  return (
    <div className="rounded-xl border border-border px-3 py-3 space-y-2.5" data-testid="brigade-review-form">
      <div className="flex items-center gap-1.5">
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} type="button" onClick={() => setScore(n)} aria-label={`${n} ball`}
            className={`text-2xl leading-none ${n <= score ? "text-amber-500" : "text-muted-foreground/30"}`}>★</button>
        ))}
        <span className="text-sm text-muted-foreground ml-1">{score}/5</span>
      </div>

      <input className={inp} placeholder="Ish turi (masalan: suvoq)" value={workType} onChange={(e) => setWorkType(e.target.value)} />

      <div className="flex gap-2">
        <input className={inp} inputMode="decimal" placeholder="Hajm" value={volume} onChange={(e) => setVolume(e.target.value)} />
        <select className={`${inp} max-w-[96px]`} value={unit} onChange={(e) => setUnit(e.target.value)}>
          {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
        </select>
      </div>
      <input className={inp} inputMode="numeric" placeholder={`Kelishilgan narx (so'm/${unit})`} value={rate} onChange={(e) => setRate(e.target.value)} />

      {!!agreed && (
        <p className="text-[12px] text-muted-foreground">
          Kelishilgan summa: <b className="text-foreground">{fmtNumber(agreed)} so'm</b>
          {num(penalty) > 0 && <> · shtrafdan keyin <b className="text-foreground">{fmtNumber(payable)} so'm</b></>}
        </p>
      )}

      <input className={inp} inputMode="numeric" placeholder="Shtraf (bo'lsa)" value={penalty} onChange={(e) => setPenalty(e.target.value)} />
      {num(penalty) > 0 && (
        <input className={inp} placeholder="Shtraf sababi" value={penaltyReason} onChange={(e) => setPenaltyReason(e.target.value)} />
      )}

      <textarea className="w-full rounded-xl bg-muted/50 px-3 py-2 text-base outline-none min-h-[72px]"
        placeholder="Izoh — qanday ishladi?" value={comment} onChange={(e) => setComment(e.target.value)} />

      {/* Owner qarori: "qayerdan olganini aytadi, link beradi va tekshiriladi" */}
      <input className={inp} inputMode="url" placeholder="Manba havolasi (shartnoma, e'lon, kanal posti)"
        value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} data-testid="brigade-source" />
      <p className="text-[11px] text-muted-foreground">
        Havola majburiy: rahbar uni ochib tekshiradi, shundan keyingina baho reytingga qo'shiladi.
      </p>

      <button type="button" onClick={submit} disabled={busy}
        className="btn btn-primary w-full text-sm py-2.5 rounded-xl disabled:opacity-60">
        {busy ? "Yuborilmoqda…" : "Yuborish"}
      </button>
    </div>
  );
}

// ───────────────────────── Yangi brigada ─────────────────────────

function AddBrigade({ onDone }: { onDone: (id: string) => void }) {
  const [name, setName] = useState("");
  const [leaderName, setLeaderName] = useState("");
  const [phone, setPhone] = useState("");
  const [region, setRegion] = useState("");
  const [specs, setSpecs] = useState("");
  const [busy, setBusy] = useState(false);
  const inp = "w-full rounded-xl bg-muted/50 px-3 h-11 text-base outline-none";

  const submit = async () => {
    setBusy(true);
    try {
      const d = await api("", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name, leaderName, phone, region,
          specializations: specs.split(",").map((s) => s.trim()).filter(Boolean),
        }),
      });
      toast.success(d.existed ? "Bu brigada ro'yxatda bor edi" : "Brigada qo'shildi");
      onDone(d.id);
    } catch (e: any) {
      toast.error(String(e.message));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="p-4 space-y-2.5" data-testid="brigade-add-form">
      <input className={inp} placeholder="Brigada nomi" value={name} onChange={(e) => setName(e.target.value)} />
      <input className={inp} placeholder="Brigadir ismi" value={leaderName} onChange={(e) => setLeaderName(e.target.value)} />
      <input className={inp} inputMode="tel" placeholder="+998 90 123 45 67" value={phone} onChange={(e) => setPhone(e.target.value)} />
      <input className={inp} placeholder="Viloyat / shahar" value={region} onChange={(e) => setRegion(e.target.value)} />
      <input className={inp} placeholder="Mutaxassisligi (vergul bilan)" value={specs} onChange={(e) => setSpecs(e.target.value)} />
      <p className="text-[11px] text-muted-foreground">
        Telefon raqami yagona belgi — bir brigada ikki marta kiritilmaydi. Ro'yxatda bo'lsa, borini ochadi.
      </p>
      <button type="button" onClick={submit} disabled={busy || name.trim().length < 2 || phone.trim().length < 7}
        className="btn btn-primary w-full text-sm py-2.5 rounded-xl disabled:opacity-60">
        {busy ? "Saqlanmoqda…" : "Qo'shish"}
      </button>
    </div>
  );
}

// ───────────────────────── Tasdiqlash (rahbar) ─────────────────────────

function PendingList({ items, onChanged }: { items: Review[]; onChanged: () => void }) {
  const [busyId, setBusyId] = useState<string | null>(null);

  const act = async (id: string, kind: "approve" | "reject") => {
    let reason = "";
    if (kind === "reject") {
      // Ilovaning o'z oynasi: Tauri'da brauzer dialoglari ishlamaydi (lib/confirmDialog)
      reason = ((await promptDialog("Rad etish sababi:")) || "").trim();
      if (reason.length < 3) return;
    }
    setBusyId(id);
    try {
      await api(`/reviews/${id}/${kind}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(kind === "reject" ? { reason } : { sourceVerified: true }),
      });
      toast.success(kind === "approve" ? "Tasdiqlandi" : "Rad etildi");
      onChanged();
    } catch (e: any) {
      toast.error(String(e.message));
    } finally {
      setBusyId(null);
    }
  };

  if (!items.length) return <p className="p-4 text-[12px] text-muted-foreground">Tasdiq kutayotgan baho yo'q.</p>;

  return (
    <div className="p-4 space-y-2">
      {items.map((r) => (
        <div key={r.id} className="rounded-xl border border-border px-3 py-2.5 space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <span className="font-semibold text-sm truncate">{r.brigadeName}</span>
            <Stars score={r.score} size="text-sm" />
          </div>
          {r.comment && <p className="text-[12px]">{r.comment}</p>}
          {!!r.agreedTotal && (
            <p className="text-[11px] text-muted-foreground">
              {r.workType ? `${r.workType}: ` : ""}{fmtNumber(r.ratePerUnit || 0)} so'm/{r.unit || "birlik"} × {fmtNumber(r.volume || 0)} = {fmtNumber(r.agreedTotal)} so'm
              {!!r.penalty && ` · shtraf ${fmtNumber(r.penalty)} so'm`}
            </p>
          )}
          {r.sourceNote && <p className="text-[11px] text-muted-foreground">Izoh: {r.sourceNote}</p>}
          {/* Tasdiqlashdan oldin havolani ochib ko'rish — qarorning asosiy sharti */}
          <a href={r.sourceUrl} target="_blank" rel="noopener noreferrer"
            className="text-[11px] text-primary hover:underline break-all inline-block">Manbani ochib tekshirish</a>
          <div className="flex gap-2 pt-1">
            <button type="button" disabled={busyId === r.id} onClick={() => act(r.id, "approve")}
              className="btn btn-primary flex-1 text-sm py-2 rounded-xl disabled:opacity-60">Tasdiqlash</button>
            <button type="button" disabled={busyId === r.id} onClick={() => act(r.id, "reject")}
              className="btn btn-outline text-sm py-2 px-3 rounded-xl text-destructive border-destructive/40 disabled:opacity-60">Rad etish</button>
          </div>
        </div>
      ))}
    </div>
  );
}
