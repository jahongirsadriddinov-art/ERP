import type { AiAttendanceStatus } from '../../models/AiAttendanceConfirmation';

// STUB (P1): paketlararo yakuniy imzolar. P3 (scheduler) to'ldiradi; chaqiruvchilar:
//  • P4 bot ilgaklari — ai:a:<token>:c|l|d (davomat), ai:r:<id>:d|s (eslatma);
//  • P3 meRoutes — POST /me/attendance/:id/respond, eslatmalar;
//  • P8 adminRoutes — POST /admin/attendance/run-now.
// Shu tufayli P4/P8 P3 ichki fayllariga (planner/runner) to'g'ridan-to'g'ri bog'lanmaydi.
// Hamma o'tishlar ATOMIK (findOneAndUpdate) va takroriy bosish — no-op (already:true).

export type AttendanceAnswer = 'confirm' | 'late' | 'decline';

export interface RespondAttendanceInput {
  companyId: string;
  /** Javob beruvchi = tasdiq egasi (bot: query.from.id bilan tekshirilgan foydalanuvchi; web: req.user). */
  employeeId: string;
  /** Bot yo'li: ai:a:<buttonToken>:… */
  buttonToken?: string;
  /** Veb yo'li: /me/attendance/:id */
  confirmationId?: string;
  answer: AttendanceAnswer;
  via: 'bot' | 'web';
  at?: Date;
}

export type RespondAttendanceResult =
  | { ok: true; status: AiAttendanceStatus; already: boolean }
  | { ok: false; code: 'not_found' | 'expired' | 'finalized' | 'not_implemented' };

/**
 * Tugma/veb javobi: buttonAnswer + status (confirmed/late/declined). HECH QACHON checked_in qo'ymaydi
 * (bu faqat reconciler — Attendance'dan). Token yozuvi shu xodim va firmaga tegishli bo'lishi shart.
 * Muddati: finalizedAt yoki kun oxirigacha (B5).
 */
export async function respondAttendance(_input: RespondAttendanceInput): Promise<RespondAttendanceResult> {
  return { ok: false, code: 'not_implemented' }; // P3 to'ldiradi
}

export interface ReminderActionInput {
  companyId: string;
  /** Eslatma maqsadi (targetUserId) bo'lishi shart. */
  userId: string;
  reminderId: string;
  action: 'done' | 'snooze';
  /** snooze uchun, standart 10. */
  snoozeMin?: number;
  via: 'bot' | 'web' | 'voice';
  at?: Date;
}

export type ReminderActionResult =
  | { ok: true; status: 'active' | 'done'; nextFireAt?: Date; already: boolean }
  | { ok: false; code: 'not_found' | 'forbidden' | 'not_implemented' };

export async function reminderAction(_input: ReminderActionInput): Promise<ReminderActionResult> {
  return { ok: false, code: 'not_implemented' }; // P3 to'ldiradi
}

export interface RunPlanNowInput { companyId: string; shiftId: string; requestedBy: string; now?: Date }
export type RunPlanNowResult =
  | { ok: true; jobId: string; duplicate: boolean }
  | { ok: false; code: 'not_found' | 'disabled' | 'queue_unavailable' | 'not_implemented' };

/**
 * Qo'lda rejalashtirish (C5): dedupe `att:plan:<company>:<date>:<shift>:manual:<minute>` —
 * avtomatik reja yoki 'dead' ish kalitni band qilmaydi; reja tasdiq unique indeksi bilan idempotent.
 */
export async function runAttendancePlanNow(_input: RunPlanNowInput): Promise<RunPlanNowResult> {
  return { ok: false, code: 'not_implemented' }; // P3 to'ldiradi
}
