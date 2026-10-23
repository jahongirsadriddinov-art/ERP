import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { API_BASE } from "./api";
import { SkeletonList } from "./Skeleton";

// Bot dizayni (owner 2026-10-22): har bir bot tugmasining matni (uz/ru), premium emoji ikonkasi, rangi;
// xabarlardagi premium emoji; buyruqlar; emoji paketlari; "AI bilan bezash" qoralamasi. Backend: /api/dev/bot-ui.
type Style = "" | "primary" | "success" | "danger";
type Override = { text?: { uz?: string; ru?: string }; iconCustomEmojiId?: string; style?: Exclude<Style, ""> };
type CatalogItem = { key: string; group: string; kind: "reply" | "inline"; meaning: string; defaults: { uz: string; ru: string } };
type CommandItem = { command: string; meaning: string; defaults: { uz: string; ru: string }; aiOnly?: boolean };
type Sticker = { id: string; emoji: string; animated?: boolean; video?: boolean };
type Pack = { name: string; title: string; count: number; stickers: Sticker[] };
type Draft = { source: "ai" | "keywords"; createdAt: string; buttons: Record<string, { iconCustomEmojiId?: string; style?: Style }>; messageEmoji: Record<string, string>; prefix?: Record<string, string>; note?: string };
type Cmd = { command: string; enabled: boolean; description: { uz?: string; ru?: string } };
type Data = {
  catalog: CatalogItem[]; commandsCatalog: CommandItem[]; messageEmojiCandidates: string[];
  config: { buttons: Record<string, Override>; messageEmoji: { emoji: string; id: string }[]; messageEmojiEnabled: boolean; messagePrefixEnabled?: boolean; stripEmojiWhenIcon: boolean; commands: Cmd[] };
  packs: Pack[]; draft: Draft | null; commandsError?: string | null; decorating?: boolean; decorateError?: string | null;
};

const URL_BASE = `${API_BASE}/api/dev/bot-ui`;
const stickerUrl = (id: string) => `${API_BASE}/api/bot-ui-sticker/${id}`;
const GROUPS = ["main", "admin", "worker", "dev", "system", "inline"] as const;
const LEAD = /^[\p{Extended_Pictographic}\p{Regional_Indicator}‍️⃣]+\s*/u;

const TXT = {
  uz: {
    title: "Bot dizayni", hint: "Tugmalarga premium emoji va rang (Telegram Bot API: icon_custom_emoji_id, style), xabarlarga premium emoji. Ishlashi uchun bot EGASINING Telegram akkauntida Premium bo'lishi kerak. Bo'sh maydon — standart matn.",
    packs: "Emoji paketlari", packPh: "https://t.me/addemoji/PaketNomi", add: "Qo'shish", ai: "✨ AI bilan bezash", reset: "Standartga qaytarish", save: "Saqlash", saved: "Saqlandi — bot 1 daqiqa ichida yangilanadi",
    resetAsk: "Barcha tugma matnlari, emoji, rang va buyruqlar standartga qaytsinmi? (Paketlar qoladi)", draft: "Qoralama", apply: "Qo'llash", discard: "Bekor qilish",
    draftInfo: (b: number, m: number) => `${b} ta tugma, ${m} ta xabar emojisi taklif qilindi`, buttons: "Tugmalar", preview: "Ko'rinishi", none: "Yo'q", pick: "Emoji tanlash",
    style: { "": "Standart", primary: "Ko'k", success: "Yashil", danger: "Qizil" } as Record<Style, string>,
    groups: { main: "Asosiy", admin: "Direktor", worker: "Ishchi", dev: "Dasturchi", system: "Tizim", inline: "Xabar ostida" } as Record<string, string>,
    strip: "Ikonka qo'yilsa matndagi oddiy emoji olib tashlansin", msgs: "Xabarlardagi emoji", msgsOn: "Xabarlarda premium emoji ishlatilsin", prefixOn: "Emojisiz xabar boshiga mazmuniga mos emoji qo'yilsin", decorating: "AI bezamoqda… (1 daqiqagacha, sahifani yopsangiz ham davom etadi)", decorateFail: "AI bezay olmadi", cmds: "Buyruqlar", noPacks: "Avval emoji paketini qo'shing (t.me/addemoji/... havolasi).", search: "Emoji bo'yicha qidirish", aiOnly: "AI yoqilganda", visible: "Menyuda",
  },
  ru: {
    title: "Дизайн бота", hint: "Премиум-эмодзи и цвет на кнопках (Telegram Bot API: icon_custom_emoji_id, style), премиум-эмодзи в сообщениях. Работает, если у ВЛАДЕЛЬЦА бота есть Telegram Premium. Пустое поле — стандартный текст.",
    packs: "Наборы эмодзи", packPh: "https://t.me/addemoji/ИмяНабора", add: "Добавить", ai: "✨ Оформить с ИИ", reset: "Сбросить", save: "Сохранить", saved: "Сохранено — бот обновится в течение минуты",
    resetAsk: "Сбросить все тексты кнопок, эмодзи, цвета и команды? (Наборы останутся)", draft: "Черновик", apply: "Применить", discard: "Отменить",
    draftInfo: (b: number, m: number) => `Предложено: ${b} кнопок, ${m} эмодзи сообщений`, buttons: "Кнопки", preview: "Предпросмотр", none: "Нет", pick: "Выбрать эмодзи",
    style: { "": "Обычный", primary: "Синий", success: "Зелёный", danger: "Красный" } as Record<Style, string>,
    groups: { main: "Основные", admin: "Директор", worker: "Работник", dev: "Разработчик", system: "Системные", inline: "Под сообщением" } as Record<string, string>,
    strip: "Убирать обычный эмодзи из текста, если есть иконка", msgs: "Эмодзи в сообщениях", msgsOn: "Использовать премиум-эмодзи в сообщениях", prefixOn: "Ставить подходящий эмодзи в начало сообщений без эмодзи", decorating: "ИИ оформляет… (до минуты, можно закрыть страницу)", decorateFail: "ИИ не смог оформить", cmds: "Команды", noPacks: "Сначала добавьте набор эмодзи (ссылка t.me/addemoji/...).", search: "Поиск по эмодзи", aiOnly: "при включённом ИИ", visible: "В меню",
  },
};

const STYLE_CLS: Record<Style, string> = {
  "": "bg-muted text-foreground", primary: "bg-sky-500 text-white", success: "bg-emerald-500 text-white", danger: "bg-red-500 text-white",
};

async function call(path: string, init?: RequestInit): Promise<Data> {
  const r = await fetch(`${URL_BASE}${path}`, { cache: "no-store", ...init, headers: { "Content-Type": "application/json", ...(init?.headers || {}) } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
  return j as Data;
}

function StickerImg({ id, emoji, size = 22 }: { id: string; emoji?: string; size?: number }) {
  const [bad, setBad] = useState(false);
  if (bad) return <span style={{ fontSize: size * 0.8, lineHeight: 1 }}>{emoji || "★"}</span>;
  return <img src={stickerUrl(id)} alt={emoji || ""} width={size} height={size} loading="lazy" onError={() => setBad(true)} className="inline-block object-contain" style={{ width: size, height: size }} />;
}

function EmojiPicker({ stickers, value, onPick, onClose, labels }: { stickers: Sticker[]; value?: string; onPick: (id: string) => void; onClose: () => void; labels: typeof TXT.uz }) {
  const [q, setQ] = useState("");
  const list = useMemo(() => (q ? stickers.filter((s) => s.emoji.includes(q)) : stickers).slice(0, 400), [q, stickers]);
  return (
    <div className="mt-2 rounded-xl border border-border bg-background p-2 shadow-lg" data-testid="botui-picker">
      <div className="flex gap-2 mb-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={labels.search} className="flex-1 min-w-0 rounded-lg border border-border bg-background px-2 py-1 text-sm" />
        <button type="button" onClick={() => onPick("")} className="px-2 text-xs rounded-lg bg-muted">{labels.none}</button>
        <button type="button" onClick={onClose} aria-label="close" className="px-2 text-xs rounded-lg bg-muted">✕</button>
      </div>
      <div className="grid grid-cols-8 sm:grid-cols-12 gap-1 max-h-56 overflow-y-auto">
        {list.map((s) => (
          <button key={s.id} type="button" title={s.emoji} onClick={() => onPick(s.id)} data-testid={`botui-sticker-${s.id}`}
            className={`aspect-square rounded-lg flex items-center justify-center hover:bg-muted ${value === s.id ? "ring-2 ring-primary" : ""}`}>
            <StickerImg id={s.id} emoji={s.emoji} size={24} />
          </button>
        ))}
      </div>
    </div>
  );
}

export default function BotUiPanel() {
  const { i18n } = useTranslation();
  const lang: "uz" | "ru" = i18n.language === "ru" ? "ru" : "uz";
  const L = TXT[lang];
  const [data, setData] = useState<Data | null>(null);
  const [buttons, setButtons] = useState<Record<string, Override>>({});
  const [msgEmoji, setMsgEmoji] = useState<Record<string, string>>({});
  const [cmds, setCmds] = useState<Cmd[]>([]);
  const [flags, setFlags] = useState({ messageEmojiEnabled: true, messagePrefixEnabled: true, stripEmojiWhenIcon: true });
  const [group, setGroup] = useState<string>("main");
  const [picker, setPicker] = useState<string | null>(null);
  const [packLink, setPackLink] = useState("");
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);

  const adopt = useCallback((d: Data, keepEdits = false) => {
    // Javobda ro'yxatlar bo'lmasa — avvalgilari saqlanadi (sahifa yiqilmasin)
    setData((prev) => ({ ...(prev || {}), ...d, catalog: d.catalog || prev?.catalog || [], commandsCatalog: d.commandsCatalog || prev?.commandsCatalog || [] } as Data));
    if (!d.commandsCatalog) return;
    if (keepEdits) return;
    setButtons(d.config.buttons || {});
    setMsgEmoji(Object.fromEntries((d.config.messageEmoji || []).map((e) => [e.emoji, e.id])));
    setCmds(d.commandsCatalog.map((c) => d.config.commands.find((x) => x.command === c.command) || { command: c.command, enabled: true, description: {} }));
    setFlags({ messageEmojiEnabled: d.config.messageEmojiEnabled, messagePrefixEnabled: d.config.messagePrefixEnabled !== false, stripEmojiWhenIcon: d.config.stripEmojiWhenIcon });
    setDirty(false);
  }, []);

  useEffect(() => { call("").then((d) => adopt(d)).catch((e) => toast.error(e.message)); }, [adopt]);

  // AI bezash fonda ishlaydi (owner 2026-10-23: so'rov uzilib "xato" chiqardi) — tayyor bo'lguncha har 2.5 s so'raladi
  const decorating = !!data?.decorating;
  useEffect(() => {
    if (!decorating) return;
    let stop = false;
    const started = Date.now();
    const tick = async () => {
      if (stop) return;
      try {
        const d = await call("");
        if (stop) return;
        adopt(d, true);
        if (!d.decorating) { if (d.decorateError) toast.error(`${L.decorateFail}: ${d.decorateError}`); return; }
      } catch { /* tarmoq uzilsa — keyingi urinish */ }
      if (Date.now() - started < 3 * 60_000) setTimeout(tick, 2500);
    };
    const t = setTimeout(tick, 2500);
    return () => { stop = true; clearTimeout(t); };
  }, [decorating, adopt, L.decorateFail]);

  const stickers = useMemo(() => (data?.packs || []).flatMap((p) => p.stickers), [data]);
  const emojiOf = useCallback((id?: string) => stickers.find((s) => s.id === id)?.emoji, [stickers]);

  const run = async (fn: () => Promise<void>) => { setBusy(true); try { await fn(); } catch (e: any) { toast.error(e?.message || "Error"); } finally { setBusy(false); } };

  const patch = (key: string, p: Partial<Override> & { textLang?: "uz" | "ru"; text?: any }) => {
    setDirty(true);
    setButtons((prev) => {
      const cur: Override = { ...(prev[key] || {}) };
      if (p.textLang) cur.text = { ...(cur.text || {}), [p.textLang]: p.text };
      if ("iconCustomEmojiId" in p) cur.iconCustomEmojiId = p.iconCustomEmojiId || undefined;
      if ("style" in p) cur.style = (p.style || undefined) as Override["style"];
      return { ...prev, [key]: cur };
    });
  };

  const label = (it: CatalogItem, l: "uz" | "ru") => {
    const o = buttons[it.key];
    let t = (o?.text?.[l] || "").trim() || it.defaults[l];
    if (o?.iconCustomEmojiId && flags.stripEmojiWhenIcon) t = t.replace(LEAD, "") || t;
    return t;
  };

  const putAll = async (): Promise<Data> => {
    const clean: Record<string, Override> = {};
    for (const [k, v] of Object.entries(buttons)) {
      const o: Override = {};
      const uz = v.text?.uz?.trim(); const ru = v.text?.ru?.trim();
      if (uz || ru) o.text = { ...(uz ? { uz } : {}), ...(ru ? { ru } : {}) };
      if (v.iconCustomEmojiId) o.iconCustomEmojiId = v.iconCustomEmojiId;
      if (v.style) o.style = v.style;
      if (Object.keys(o).length) clean[k] = o;
    }
    const d = await call("", { method: "PUT", body: JSON.stringify({
      buttons: clean, ...flags,
      messageEmoji: Object.entries(msgEmoji).filter(([, id]) => id).map(([emoji, id]) => ({ emoji, id })),
      commands: cmds,
    }) });
    adopt(d);
    return d;
  };
  const save = () => run(async () => {
    const d = await putAll();
    if (d.commandsError) toast.error(d.commandsError); else toast.success(L.saved);
  });
  // Qoralama saqlangan sozlama ustiga qo'shiladi — saqlanmagan tahrirlar yo'qolmasin, avval saqlanadi
  const applyDraft = () => run(async () => { if (dirty) await putAll(); adopt(await call("/draft/apply", { method: "POST", body: "{}" })); });

  if (!data) return <SkeletonList items={4} />;
  const items = data.catalog.filter((i) => i.group === group);
  const draftCount = data.draft ? [Object.keys(data.draft.buttons).length, Object.keys(data.draft.messageEmoji).length] : [0, 0];
  const previewRows: CatalogItem[][] = [];
  items.forEach((it, i) => { if (i % 2 === 0) previewRows.push([it]); else previewRows[previewRows.length - 1].push(it); });

  return (
    <div className="space-y-3 max-w-4xl mx-auto w-full pb-24" data-testid="botui-panel">
      <div className="surface rounded-2xl p-4">
        <h2 className="text-base font-bold">{L.title}</h2>
        <p className="text-xs text-muted-foreground mt-1">{L.hint}</p>
        <div className="flex flex-wrap gap-2 mt-3">
          <button type="button" disabled={busy || decorating || !data.packs.length} data-testid="botui-ai" onClick={() => run(async () => adopt(await call("/auto-decorate", { method: "POST", body: "{}" }), true))}
            className="px-3.5 py-2 rounded-full bg-primary text-white text-sm font-semibold disabled:opacity-50">{L.ai}</button>
          <button type="button" disabled={busy} data-testid="botui-reset" onClick={() => { if (window.confirm(L.resetAsk)) void run(async () => adopt(await call("/reset", { method: "POST", body: "{}" }))); }}
            className="px-3.5 py-2 rounded-full bg-muted text-sm font-semibold">{L.reset}</button>
        </div>
      </div>

      {decorating && (
        <div className="rounded-2xl border border-primary/30 bg-primary/10 p-3 text-sm font-medium flex items-center gap-2" data-testid="botui-decorating">
          <span className="w-4 h-4 rounded-full border-2 border-primary border-t-transparent animate-spin" />{L.decorating}
        </div>
      )}
      {data.draft && (
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-3" data-testid="botui-draft">
          <p className="text-sm font-semibold">{L.draft} ({data.draft.source === "ai" ? "AI" : "keywords"}): {L.draftInfo(draftCount[0], draftCount[1])}</p>
          {data.draft.note && <p className="text-xs text-muted-foreground mt-1">{data.draft.note}</p>}
          <div className="flex flex-wrap gap-1.5 mt-2">
            {Object.entries(data.draft.buttons).slice(0, 40).map(([k, v]) => {
              const it = data.catalog.find((c) => c.key === k);
              return it ? (
                <span key={k} className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs ${STYLE_CLS[(v.style || "") as Style]}`}>
                  {v.iconCustomEmojiId && <StickerImg id={v.iconCustomEmojiId} emoji={emojiOf(v.iconCustomEmojiId)} size={16} />}{it.defaults[lang].replace(LEAD, "")}
                </span>
              ) : null;
            })}
          </div>
          <div className="flex gap-2 mt-3">
            <button type="button" disabled={busy} data-testid="botui-draft-apply" onClick={() => void applyDraft()} className="px-3.5 py-1.5 rounded-full bg-emerald-600 text-white text-sm font-semibold">{L.apply}</button>
            <button type="button" disabled={busy} onClick={() => run(async () => adopt(await call("/draft", { method: "DELETE" }), true))} className="px-3.5 py-1.5 rounded-full bg-muted text-sm">{L.discard}</button>
          </div>
        </div>
      )}

      <div className="surface rounded-2xl p-4" data-testid="botui-packs">
        <h3 className="text-sm font-bold mb-2">{L.packs}</h3>
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (packLink.trim()) void run(async () => { adopt(await call("/packs", { method: "POST", body: JSON.stringify({ link: packLink.trim() }) }), true); setPackLink(""); }); }}>
          <input value={packLink} onChange={(e) => setPackLink(e.target.value)} placeholder={L.packPh} data-testid="botui-pack-input" className="flex-1 min-w-0 rounded-xl border border-border bg-background px-3 py-2 text-sm" />
          <button type="submit" disabled={busy} className="px-3.5 rounded-xl bg-primary text-white text-sm font-semibold">{L.add}</button>
        </form>
        {data.packs.length === 0 ? <p className="text-xs text-muted-foreground mt-2">{L.noPacks}</p> : (
          <div className="flex flex-wrap gap-2 mt-2">
            {data.packs.map((p) => (
              <span key={p.name} className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-xs" data-testid={`botui-pack-${p.name}`}>
                {p.stickers[0] && <StickerImg id={p.stickers[0].id} emoji={p.stickers[0].emoji} size={16} />}
                {p.title} · {p.count}
                <button type="button" aria-label="delete" onClick={() => run(async () => adopt(await call(`/packs/${encodeURIComponent(p.name)}`, { method: "DELETE" }), true))} className="text-muted-foreground hover:text-red-600">✕</button>
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="surface rounded-2xl p-4">
        <div className="flex items-center justify-between gap-2 mb-2">
          <h3 className="text-sm font-bold">{L.buttons}</h3>
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <input type="checkbox" checked={flags.stripEmojiWhenIcon} onChange={(e) => { setDirty(true); setFlags((f) => ({ ...f, stripEmojiWhenIcon: e.target.checked })); }} />{L.strip}
          </label>
        </div>
        <div className="flex gap-1 overflow-x-auto scrollbar-hide mb-3" role="tablist">
          {GROUPS.map((g) => (
            <button key={g} type="button" role="tab" aria-selected={group === g} data-testid={`botui-group-${g}`} onClick={() => setGroup(g)}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap ${group === g ? "bg-primary text-white" : "bg-muted text-muted-foreground"}`}>{L.groups[g]}</button>
          ))}
        </div>

        <div className="rounded-xl bg-[#e7ebf0] dark:bg-[#17212b] p-2 mb-3" data-testid="botui-preview" aria-label={L.preview}>
          {previewRows.map((row, i) => (
            <div key={i} className="flex gap-1 mb-1 last:mb-0">
              {row.map((it) => {
                const o = buttons[it.key];
                return (
                  <div key={it.key} className={`flex-1 min-w-0 rounded-lg px-2 py-2 text-xs text-center truncate flex items-center justify-center gap-1 ${o?.style ? STYLE_CLS[o.style] : "bg-white/90 dark:bg-[#2b5278] text-foreground dark:text-white"}`}>
                    {o?.iconCustomEmojiId && <StickerImg id={o.iconCustomEmojiId} emoji={emojiOf(o.iconCustomEmojiId)} size={16} />}
                    <span className="truncate">{label(it, lang)}</span>
                  </div>
                );
              })}
            </div>
          ))}
        </div>

        <div className="space-y-2">
          {items.map((it) => {
            const o = buttons[it.key] || {};
            return (
              <div key={it.key} className="rounded-xl border border-border p-2.5" data-testid={`botui-btn-${it.key}`}>
                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => setPicker(picker === it.key ? null : it.key)} title={L.pick} aria-label={L.pick} data-testid={`botui-pick-${it.key}`}
                    className="w-9 h-9 shrink-0 rounded-lg bg-muted flex items-center justify-center">
                    {o.iconCustomEmojiId ? <StickerImg id={o.iconCustomEmojiId} emoji={emojiOf(o.iconCustomEmojiId)} /> : <span className="text-base">{(it.defaults.uz.match(LEAD)?.[0] || "＋").trim()}</span>}
                  </button>
                  <div className="flex-1 min-w-0 grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                    <input aria-label={`${it.key} uz`} data-testid={`botui-text-uz-${it.key}`} value={o.text?.uz ?? ""} placeholder={it.defaults.uz} maxLength={64}
                      onChange={(e) => patch(it.key, { textLang: "uz", text: e.target.value })} className="min-w-0 rounded-lg border border-border bg-background px-2 py-1.5 text-sm" />
                    <input aria-label={`${it.key} ru`} data-testid={`botui-text-ru-${it.key}`} value={o.text?.ru ?? ""} placeholder={it.defaults.ru} maxLength={64}
                      onChange={(e) => patch(it.key, { textLang: "ru", text: e.target.value })} className="min-w-0 rounded-lg border border-border bg-background px-2 py-1.5 text-sm" />
                  </div>
                  <select aria-label={`${it.key} style`} data-testid={`botui-style-${it.key}`} value={o.style || ""} onChange={(e) => patch(it.key, { style: e.target.value as any })}
                    className="shrink-0 rounded-lg border border-border bg-background px-1.5 py-1.5 text-xs">
                    {(["", "primary", "success", "danger"] as Style[]).map((s) => <option key={s} value={s}>{L.style[s]}</option>)}
                  </select>
                </div>
                {picker === it.key && (stickers.length
                  ? <EmojiPicker stickers={stickers} value={o.iconCustomEmojiId} labels={L} onClose={() => setPicker(null)} onPick={(id) => { patch(it.key, { iconCustomEmojiId: id }); setPicker(null); }} />
                  : <p className="text-xs text-muted-foreground mt-2">{L.noPacks}</p>)}
              </div>
            );
          })}
        </div>
      </div>

      <div className="surface rounded-2xl p-4" data-testid="botui-msgs">
        <div className="flex items-center justify-between gap-2 mb-2">
          <h3 className="text-sm font-bold">{L.msgs}</h3>
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <input type="checkbox" checked={flags.messageEmojiEnabled} onChange={(e) => { setDirty(true); setFlags((f) => ({ ...f, messageEmojiEnabled: e.target.checked })); }} />{L.msgsOn}
          </label>
        </div>
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground mb-2" data-testid="botui-prefix">
          <input type="checkbox" checked={flags.messagePrefixEnabled} onChange={(e) => { setDirty(true); setFlags((f) => ({ ...f, messagePrefixEnabled: e.target.checked })); }} />{L.prefixOn}
        </label>
        <div className="flex flex-wrap gap-1.5">
          {data.messageEmojiCandidates.map((e) => (
            <button key={e} type="button" onClick={() => setPicker(picker === `msg:${e}` ? null : `msg:${e}`)} data-testid={`botui-msg-${e}`}
              className={`h-9 min-w-9 px-1.5 rounded-lg flex items-center justify-center gap-1 ${msgEmoji[e] ? "bg-primary/15 ring-1 ring-primary/40" : "bg-muted"}`}>
              <span>{e}</span>{msgEmoji[e] && <><span className="text-[10px] text-muted-foreground">→</span><StickerImg id={msgEmoji[e]} emoji={e} size={18} /></>}
            </button>
          ))}
        </div>
        {picker?.startsWith("msg:") && stickers.length > 0 && (
          <EmojiPicker stickers={stickers} value={msgEmoji[picker.slice(4)]} labels={L} onClose={() => setPicker(null)}
            onPick={(id) => { const e = picker.slice(4); setDirty(true); setMsgEmoji((m) => ({ ...m, [e]: id })); setPicker(null); }} />
        )}
      </div>

      <div className="surface rounded-2xl p-4" data-testid="botui-cmds">
        <h3 className="text-sm font-bold mb-2">{L.cmds}</h3>
        <div className="space-y-2">
          {cmds.map((c, idx) => {
            const def = data.commandsCatalog.find((x) => x.command === c.command)!;
            const set = (p: Partial<Cmd>) => { setDirty(true); setCmds((all) => all.map((x, i) => (i === idx ? { ...x, ...p } : x))); };
            return (
              <div key={c.command} className="flex flex-wrap sm:flex-nowrap items-center gap-2" data-testid={`botui-cmd-${c.command}`}>
                <code className="text-sm font-semibold w-20 shrink-0">/{c.command}</code>
                <input aria-label={`/${c.command} uz`} value={c.description.uz ?? ""} placeholder={def.defaults.uz} maxLength={256} onChange={(e) => set({ description: { ...c.description, uz: e.target.value } })} className="flex-1 min-w-0 rounded-lg border border-border bg-background px-2 py-1.5 text-sm" />
                <input aria-label={`/${c.command} ru`} value={c.description.ru ?? ""} placeholder={def.defaults.ru} maxLength={256} onChange={(e) => set({ description: { ...c.description, ru: e.target.value } })} className="flex-1 min-w-0 rounded-lg border border-border bg-background px-2 py-1.5 text-sm" />
                <label className="flex items-center gap-1 text-xs text-muted-foreground shrink-0" title={def.aiOnly ? L.aiOnly : ""}>
                  <input type="checkbox" checked={c.enabled} onChange={(e) => set({ enabled: e.target.checked })} />{L.visible}{def.aiOnly ? "*" : ""}
                </label>
              </div>
            );
          })}
        </div>
      </div>

      <div className="fixed bottom-4 inset-x-0 flex justify-center pointer-events-none z-20" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
        <button type="button" disabled={busy || !dirty} onClick={() => void save()} data-testid="botui-save"
          className="pointer-events-auto px-6 py-2.5 rounded-full bg-primary text-white font-semibold shadow-lg disabled:opacity-50">{L.save}</button>
      </div>
    </div>
  );
}
