import AiJob from '../../models/AiJob';

// Eski ertalabki/kechki bot eslatmalari (services/bot.ts sendMorningReminders/sendEveningReminders) uchun
// "shu soatda yuborildimi" belgisi (review C8). Avval faqat xotiradagi lastReminderKeyIn/Out edi — deploy
// overlap'da ikki instansiya ikkalasi ham yuborardi. Endi AiJob dedupeKey (unique partial) orqali: faqat
// bitta instansiya slotni oladi. Hujjat darhol 'done' (navbat uni hech qachon bajarmaydi) va 2 kunda TTL.
// DB xatosida — xotiradagi zaxira (avvalgi xatti-harakat: eng yomoni bir marta takror).
//
// bot.ts ulanishi (shared fayl — P3 tahrir qilmaydi):  if (await claimLegacyReminderSlot('in', key)) sendMorningReminders()

export const LEGACY_REMINDER_JOB = 'legacy.reminder';
const KEEP_MS = 2 * 86_400_000;
const memory = new Map<string, string>();

export function legacyReminderKey(kind: 'in' | 'out', slot: string): string {
  return `legacy:rem:${kind}:${slot}`;
}

/** true — shu slot (masalan "2026-10-14-7") uchun eslatmani SHU instansiya yuboradi. */
export async function claimLegacyReminderSlot(kind: 'in' | 'out', slot: string, now: Date = new Date()): Promise<boolean> {
  const dedupeKey = legacyReminderKey(kind, slot);
  try {
    await AiJob.create({
      type: LEGACY_REMINDER_JOB, dedupeKey, status: 'done', runAt: now, finishedAt: now, attempts: 0, maxAttempts: 1,
      expiresAt: new Date(now.getTime() + KEEP_MS),
    });
    memory.set(kind, slot);
    return true;
  } catch (e: any) {
    if (e?.code === 11000) { memory.set(kind, slot); return false; }
    console.error('[aiVoice] eski eslatma dedupe xatosi (xotira zaxirasi):', (e as Error).message);
    if (memory.get(kind) === slot) return false;
    memory.set(kind, slot);
    return true;
  }
}

/** Faqat testlar uchun. */
export function __resetLegacyReminderMemory(): void { memory.clear(); }
