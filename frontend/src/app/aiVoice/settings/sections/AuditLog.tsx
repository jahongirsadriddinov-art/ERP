import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import History from "@hugeicons/core-free-icons/File01Icon";
import { adminApi, type AiAuditItem, type AiAuditPage, type ApiResult, isNotReady } from "../api";
import { Badge, Card, Chip, Notice, Skeleton, type Tone } from "../ui";

// Audit jurnali: AI bajargan har bir amal (sahifalangan, holat bo'yicha filtr). Argumentlar va tasdiq
// tokenlari serverdan umuman kelmaydi. Dasturchi paneli ham ishlatadi (fetcher + firma nomi ko'rinadi).
type Item = AiAuditItem & { companyName?: string };
type Fetcher = (p: { page: number; limit: number; status?: string }) => Promise<ApiResult<AiAuditPage & { items: Item[] }>>;
const STATUS_TONE: Record<string, Tone> = {
  ok: "green", confirmed: "green", denied: "red", error: "red", needs_confirmation: "amber", cancelled: "gray", expired: "gray", not_found: "gray",
};
const FILTERS = ["", "ok", "needs_confirmation", "denied", "error"];
const LIMIT = 20;

// ── Audit yozuvini oddiy tilga o'girish (avval "bot.schedule" va xom JSON ko'rinardi) ──
const TOOL_L: Record<string, [string, string]> = {
  "bot.schedule": ["Ish jadvali o'zgartirildi", "Изменён график работы"],
  "admin.settings": ["AI sozlamalari o'zgartirildi", "Изменены настройки AI"],
  createReminder: ["Eslatma yaratildi", "Создано напоминание"],
  updateReminder: ["Eslatma o'zgartirildi", "Напоминание изменено"],
  cancelReminder: ["Eslatma bekor qilindi", "Напоминание отменено"],
  listReminders: ["Eslatmalar ko'rildi", "Просмотр напоминаний"],
  getMyTasks: ["Vazifalar so'raldi", "Запрошены задачи"],
  getMySchedule: ["Ish jadvali so'raldi", "Запрошен график"],
  getProjectSummary: ["Obyektlar holati so'raldi", "Запрошен статус объектов"],
  getInventoryBalance: ["Material ehtiyoji so'raldi", "Запрошена потребность в материалах"],
  getAttendanceSummary: ["Davomat so'raldi", "Запрошена посещаемость"],
  getAllowedFinancialReport: ["Moliyaviy hisobot so'raldi", "Запрошен финансовый отчёт"],
  notifyManager: ["Rahbarga xabar yuborildi", "Сообщение руководителю"],
  getEmployeeProfile: ["Xodim ma'lumoti so'raldi", "Запрошены данные сотрудника"],
};
const CHANNEL_L: Record<string, [string, string]> = {
  bot: ["Telegram bot", "Telegram-бот"], bot_message: ["Telegram bot", "Telegram-бот"], telegram_call: ["Telegram qo'ng'iroq", "Звонок Telegram"],
  inapp: ["Ilova", "Приложение"], inapp_call: ["Ilova qo'ng'iroq", "Звонок в приложении"], chat: ["Ilova chati", "Чат приложения"], web: ["Sayt", "Сайт"], voice: ["Ovozli", "Голос"],
};
const MONTHS: [string[], string[]] = [
  ["yanvar", "fevral", "mart", "aprel", "may", "iyun", "iyul", "avgust", "sentabr", "oktabr", "noyabr", "dekabr"],
  ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"],
];
const DAYS: [string[], string[]] = [["Du", "Se", "Ch", "Pa", "Ju", "Sh", "Ya"], ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"]];
const niceDate = (s: string, ru: boolean) => s.replace(/(\d{4})-(\d{2})-(\d{2})/g, (_m, _y, mo, d) => ru ? `${+d} ${MONTHS[1][+mo - 1]}` : `${+d}-${MONTHS[0][+mo - 1]}`);

function describePatch(obj: any, ru: boolean): string {
  const { patch, shiftId: _s, ...rest } = obj || {};
  const p = { ...(patch && typeof patch === "object" ? patch : {}), ...rest };
  const out: string[] = [];
  const yesNo = (v: any, on: [string, string], off: [string, string]) => (v ? on : off)[ru ? 1 : 0];
  for (const [key, v] of Object.entries(p || {})) {
    if (key === "workStart") out.push(ru ? `начало работы ${v}` : `ish boshlanishi ${v}`);
    else if (key === "weekdays" && Array.isArray(v)) out.push((ru ? "рабочие дни: " : "ish kunlari: ") + (v as number[]).map((d) => DAYS[ru ? 1 : 0][d - 1]).join(", "));
    else if (key === "attendance") out.push(yesNo(v, ["ertalabki so'rov yoqildi", "утренний опрос включён"], ["ertalabki so'rov o'chirildi", "утренний опрос выключен"]));
    else if (key === "enabled" || key === "aiEnabled") out.push(yesNo(v, ["AI yoqildi", "AI включён"], ["AI o'chirildi", "AI выключен"]));
    else if (key === "skipDates" && Array.isArray(v)) out.push((ru ? "выходные даты: " : "dam olish kunlari: ") + niceDate((v as string[]).join(", "), ru));
    else if (key === "extraWorkDates" && Array.isArray(v)) out.push((ru ? "доп. рабочие даты: " : "qo'shimcha ish kunlari: ") + niceDate((v as string[]).join(", "), ru));
  }
  return out.join(" · ");
}

export function humanizeAudit(it: { tool: string; channel?: string; resultSummary?: string }, ru: boolean) {
  const title = TOOL_L[it.tool]?.[ru ? 1 : 0] || it.tool.replace(/[._]/g, " ");
  const channel = (it.channel && CHANNEL_L[it.channel]?.[ru ? 1 : 0]) || it.channel || "";
  let detail = it.resultSummary || "";
  const j = detail.indexOf("{");
  if (j >= 0) {
    try { const d = describePatch(JSON.parse(detail.slice(j)), ru); if (d) detail = d; } catch { /* JSON emas — matn qoladi */ }
  }
  detail = niceDate(detail.replace(/^(Eslatma yaratildi|Ish jadvali \(bot\)):\s*/i, ""), ru);
  return { title, channel, detail };
}

export default function AuditLog({ fetcher = adminApi.getAudit as Fetcher, title, hint, testId = "ai-audit" }: { fetcher?: Fetcher; title?: string; hint?: string; testId?: string } = {}) {
  const { t, i18n } = useTranslation();
  const k = (s: string, o?: Record<string, unknown>) => t(`aiVoice.admin.audit.${s}`, o as any) as string;
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<(AiAuditPage & { items: Item[] }) | null | false | "nr">(null);
  useEffect(() => {
    setData(null);
    fetcher({ page, limit: LIMIT, status: status || undefined }).then((r) => setData(r.ok && r.data && Array.isArray(r.data.items) ? r.data : isNotReady(r) ? "nr" : false));
  }, [page, status, fetcher]);
  const fmt = new Intl.DateTimeFormat(i18n.language === "ru" ? "ru-RU" : "uz-UZ", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Tashkent" });
  const pages = data && data !== "nr" ? Math.max(1, Math.ceil(data.total / LIMIT)) : 1;

  return (
    <Card icon={History} title={title || t("aiVoice.ui.history.auditTitle")} hint={hint || t("aiVoice.ui.history.auditHint")} testId={testId}>
      <div className="flex gap-2 overflow-x-auto overscroll-x-contain scrollbar-hide pb-1 -mx-1 px-1 mb-3">
        {FILTERS.map((f) => (
          <Chip key={f || "all"} active={status === f} onClick={() => { setStatus(f); setPage(1); }}>{f ? k(`status.${f}`) : k("all")}</Chip>
        ))}
      </div>
      {data === null ? <Skeleton h="h-32" /> : data === "nr" ? <Notice>{t("aiVoice.common.notReady")}</Notice> : data === false ? <Notice tone="warn">{t("aiVoice.common.error")}</Notice> : data.items.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-6">{k("empty")}</p>
      ) : (
        <>
          <ul className="space-y-2">
            {data.items.map((it) => { const h = humanizeAudit(it, i18n.language === "ru"); return (
              <li key={it.id} className="rounded-xl border border-border bg-card/60 px-3 py-2.5">
                <div className="flex items-start gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold truncate">{h.title}</p>
                    <p className="text-[11px] text-muted-foreground truncate">
                      {it.companyName ? `${it.companyName} · ` : ""}{fmt.format(new Date(it.at))} · {it.actorName || it.actorRole} · {h.channel}{it.targetName ? ` → ${it.targetName}` : ""}
                    </p>
                    {h.detail && <p className="text-xs mt-1 break-words line-clamp-2">{h.detail}</p>}
                  </div>
                  <Badge tone={STATUS_TONE[it.status] || "gray"}>{k(`status.${it.status}`)}</Badge>
                </div>
              </li>
            ); })}
          </ul>
          <div className="flex items-center justify-between gap-2 mt-3">
            <button type="button" className="h-9 px-3 rounded-xl border border-border text-xs font-semibold disabled:opacity-40" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>{k("prev")}</button>
            <span className="text-xs text-muted-foreground tabular-nums">{k("page", { page, pages })}</span>
            <button type="button" className="h-9 px-3 rounded-xl border border-border text-xs font-semibold disabled:opacity-40" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>{k("next")}</button>
          </div>
        </>
      )}
    </Card>
  );
}
