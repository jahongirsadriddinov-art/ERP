import "../../../i18n/aiVoiceNs";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import Shield from "@hugeicons/core-free-icons/Shield01Icon";
import type { SectionProps } from "../sectionProps";
import { adminApi, AI_ROLES, type AiRole, type AiToolEntry } from "../api";
import { Badge, Card, Chip, Notice, Skeleton, Toggle } from "../ui";

// Rollar matritsasi: qator — AI imkoniyati, ustun — lavozim. Katakcha faqat kod chegarasi (maxRoles) ichida
// yoqiladi; direktor/o'rinbosar ustunlarini faqat egasi/direktor o'zgartiradi (server ham tekshiradi — B1).
const BOSS: AiRole[] = ["direktor", "orinbosar"];

export function effectiveRow(tools: AiToolEntry[], byRole: Partial<Record<AiRole, string[]>>, role: AiRole): string[] {
  const row = byRole[role];
  return Array.isArray(row) ? row : tools.filter((x) => x.defaultRoles.includes(role)).map((x) => x.name);
}

export default function ToolsMatrix({ view, draft, update }: SectionProps) {
  const { t, i18n } = useTranslation();
  const k = (s: string) => t(`aiVoice.admin.tools.${s}`);
  const [tools, setTools] = useState<AiToolEntry[] | null>(null);
  useEffect(() => { adminApi.getTools().then((r) => setTools(r.ok && Array.isArray(r.data?.tools) ? r.data.tools : [])); }, []);
  const lang = i18n.language === "ru" ? "ru" : "uz";
  const canBoss = view.editor.canEditBossRows;

  const toggle = (role: AiRole, name: string) => {
    if (!tools) return;
    update((d) => {
      // Koddan olib tashlangan eski tool nomlari yuborilmaydi (server ularni rad etadi)
      const known = new Set(tools.map((x) => x.name));
      const cur = effectiveRow(tools, d.tools.byRole, role).filter((x) => known.has(x));
      const next = cur.includes(name) ? cur.filter((x) => x !== name) : [...cur, name];
      return { ...d, tools: { ...d.tools, byRole: { ...d.tools.byRole, [role]: next } } };
    });
  };

  return (
    <div className="space-y-4">
      <Card icon={Shield} title={t("aiVoice.ui.tabs.tools")} hint={k("hint")} testId="ai-tools">
        {!canBoss && <div className="mb-3"><Notice tone="lock">{k("bossLocked")}</Notice></div>}
        {tools === null ? <Skeleton h="h-32" /> : tools.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6">{k("empty")}</p>
        ) : (
          <>
            {/* Telefon: har bir imkoniyat — alohida kartochka, lavozimlar chip ko'rinishida */}
            <ul className="space-y-2 md:hidden">
              {tools.map((tool) => (
                <li key={tool.name} className="rounded-2xl border border-border bg-card/60 p-3">
                  <div className="flex items-start gap-2">
                    <p className="flex-1 min-w-0 text-sm font-medium leading-snug break-words">{tool.description[lang] || tool.name}</p>
                    <Badge tone={tool.kind === "write" ? "amber" : "sky"}>{k(tool.kind)}</Badge>
                  </div>
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {AI_ROLES.filter((r) => tool.maxRoles.includes(r)).map((r) => {
                      const on = effectiveRow(tools, draft.tools.byRole, r).includes(tool.name);
                      return (
                        <Chip key={r} active={on} disabled={BOSS.includes(r) && !canBoss} onClick={() => toggle(r, tool.name)}
                          testId={`ai-tool-m-${tool.name}-${r}`}>
                          <span className="text-xs">{t(`aiVoice.admin.employees.roles.${r}`)}</span>
                        </Chip>
                      );
                    })}
                  </div>
                </li>
              ))}
            </ul>
            {/* Kompyuter: jadval */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-sm border-separate border-spacing-0">
                <thead>
                  <tr>
                    <th className="text-left text-xs font-semibold text-muted-foreground pb-2 pr-2">{k("tool")}</th>
                    {AI_ROLES.map((r) => (
                      <th key={r} className="text-xs font-semibold text-muted-foreground pb-2 px-1 text-center">{t(`aiVoice.admin.employees.roles.${r}`)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {tools.map((tool) => (
                    <tr key={tool.name}>
                      <td className="py-2 pr-2 border-t border-border/60 align-top">
                        <p className="font-medium leading-snug">{tool.description[lang] || tool.name}</p>
                        <div className="mt-0.5"><Badge tone={tool.kind === "write" ? "amber" : "sky"}>{k(tool.kind)}</Badge></div>
                      </td>
                      {AI_ROLES.map((r) => {
                        const allowed = tool.maxRoles.includes(r);
                        const on = allowed && effectiveRow(tools, draft.tools.byRole, r).includes(tool.name);
                        const disabled = !allowed || (BOSS.includes(r) && !canBoss);
                        return (
                          <td key={r} className="py-2 px-1 text-center border-t border-border/60">
                            <input type="checkbox" checked={on} disabled={disabled} onChange={() => toggle(r, tool.name)}
                              aria-label={`${tool.name} — ${r}`} data-testid={`ai-tool-${tool.name}-${r}`}
                              className={`w-5 h-5 accent-[var(--primary)] ${!allowed ? "opacity-25" : ""}`} />
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Card>
      <Card>
        <Toggle checked={draft.tools.allowOffShiftAssistant} label={k("allowOffShift")} hint={k("allowOffShiftHint")}
          onChange={(v) => update((d) => ({ ...d, tools: { ...d.tools, allowOffShiftAssistant: v } }))} />
      </Card>
    </div>
  );
}
