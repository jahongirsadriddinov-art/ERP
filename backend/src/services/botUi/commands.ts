// Bot buyruqlari menyusi (setMyCommands) — dasturchi panelidan tavsiflar (uz/ru) va ko'rinishi tahrirlanadi.
// Sozlama yo'q bo'lsa — avvalgi (ikki tilli bitta tavsif) ro'yxat o'zgarishsiz yuboriladi.
import BotUiConfig from '../../models/BotUiConfig';
import { aiConfig } from '../../aiVoice/config';
import { BOT_UI_COMMANDS } from './catalog';
import { tgCall } from './telegramApi';

type Cmd = { command: string; description: string };
type Saved = { command: string; enabled?: boolean; description?: { uz?: string; ru?: string } }[];

export function legacyCommands(aiEnabled: boolean): Cmd[] {
  return [
    { command: 'start', description: 'Botni boshlash / Запуск' },
    { command: 'res', description: 'Botni yangilash / Обновить бота' },
    ...(aiEnabled ? [{ command: 'ai', description: 'AI yordamchi / AI помощник' }, { command: 'jadval', description: 'Ish jadvali (rahbar) / График работы' }] : []),
  ];
}

/** Saqlangan sozlamadan til bo'yicha ro'yxat (null → sozlama yo'q, eski ro'yxat ishlatiladi). */
export function commandsFor(saved: Saved | undefined | null, lang: 'uz' | 'ru', aiEnabled: boolean): Cmd[] | null {
  if (!saved?.length) return null;
  const out: Cmd[] = [];
  for (const c of BOT_UI_COMMANDS) {
    if (c.aiOnly && !aiEnabled) continue;
    const s = saved.find(x => x.command === c.command);
    if (s?.enabled === false) continue;
    const d = (s?.description?.[lang] || '').trim() || c.defaults[lang];
    out.push({ command: c.command, description: d.slice(0, 256) });
  }
  return out;
}

export async function applyBotCommands(call: typeof tgCall = tgCall): Promise<void> {
  const doc: any = await BotUiConfig.findOne({ key: 'global' }).select('commands').lean().catch(() => null);
  const aiEnabled = !!aiConfig.enabled;
  const uz = commandsFor(doc?.commands, 'uz', aiEnabled);
  if (!uz) {
    await call('setMyCommands', { commands: legacyCommands(aiEnabled) });
    await call('deleteMyCommands', { language_code: 'ru' }).catch(() => {});
    return;
  }
  const ru = commandsFor(doc.commands, 'ru', aiEnabled)!;
  if (uz.length) await call('setMyCommands', { commands: uz }); else await call('deleteMyCommands', {});
  if (ru.length) await call('setMyCommands', { commands: ru, language_code: 'ru' }); else await call('deleteMyCommands', { language_code: 'ru' });
}
