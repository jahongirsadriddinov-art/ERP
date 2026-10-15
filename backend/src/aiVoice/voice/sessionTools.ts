import type { ToolDeclaration, ToolResult } from '../contracts';
import { recordVoiceAnswer } from '../scheduler/api';

// Sessiyaga xos ichki tool: davomat qo'ng'irog'idagi OVOZLI javob (design D10). confirmationId
// modeldan EMAS — sessiyadan olinadi; faqat voiceAnswer yoziladi, holat 'pending' qoladi
// (tasdiq — tugma yoki haqiqiy check-in). Faqat purpose='attendance' sessiyalarida e'lon qilinadi.

export const ATTENDANCE_TOOL = 'recordAttendanceAnswer';

export function attendanceToolDeclaration(lang: 'uz' | 'ru'): ToolDeclaration {
  return {
    name: ATTENDANCE_TOOL,
    description: lang === 'ru'
      ? 'Записать голосовой ответ сотрудника о выходе на работу сегодня (не является подтверждением).'
      : "Xodimning bugun ishga kelishi haqidagi OVOZLI javobini yozish (tasdiq emas).",
    parameters: {
      type: 'object',
      properties: {
        answer: { type: 'string', enum: ['coming', 'late', 'not_coming', 'unclear'], description: 'coming | late | not_coming | unclear' },
        etaMin: { type: 'integer', minimum: 0, maximum: 600, description: 'late bo\'lsa — necha daqiqa kechikadi' },
      },
      required: ['answer'],
    },
    behavior: 'BLOCKING',
  };
}

const MSG = {
  ok: {
    uz: "Ovozli javob yozildi. Bu tasdiq emas — Telegramdagi tugmani bosing, ishga kelganda ilovada \"Ishga keldim\" qiling.",
    ru: 'Голосовой ответ записан. Это не подтверждение — нажмите кнопку в Telegram, а по приходу отметьтесь в приложении.',
  },
  bad: { uz: "Javob noto'g'ri.", ru: 'Неверный ответ.' },
  notFound: { uz: 'Davomat yozuvi topilmadi.', ru: 'Запись посещаемости не найдена.' },
};

export async function runAttendanceTool(
  p: { companyId: string; employeeId: string; confirmationId?: string; lang: 'uz' | 'ru' },
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const answer = String(args?.answer || '');
  if (!['coming', 'late', 'not_coming', 'unclear'].includes(answer)) return { status: 'error', message: MSG.bad[p.lang], retryable: false };
  if (!p.confirmationId) return { status: 'not_found', message: MSG.notFound[p.lang], retryable: false };
  const etaRaw = args?.etaMin;
  const etaMin = typeof etaRaw === 'number' && Number.isFinite(etaRaw) ? Math.max(0, Math.min(600, Math.round(etaRaw))) : undefined;
  const r = await recordVoiceAnswer({
    companyId: p.companyId, employeeId: p.employeeId, confirmationId: p.confirmationId,
    answer: answer as 'coming' | 'late' | 'not_coming' | 'unclear', ...(etaMin !== undefined ? { etaMin } : {}),
  });
  if (!r.ok) return { status: r.code === 'not_found' ? 'not_found' : 'error', message: r.code === 'not_found' ? MSG.notFound[p.lang] : MSG.bad[p.lang], retryable: false };
  return { status: 'ok', message: MSG.ok[p.lang], retryable: false };
}
