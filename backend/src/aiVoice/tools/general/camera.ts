import User from '../../../models/User';
import { getBotInstance } from '../../bot/instance';
import { resolveManagers } from '../../lib/managers';
import { truncateText } from '../../lib/untrusted';
import { callWorker } from '../../telegram/workerRpc';
import { collectFrames, encodeMp4, getMedia, lastMediaOf, latestFrame, saveMedia, type Media } from '../../voice/vision';
import { findEmployee } from '../erp/contactEmployee';
import { ALL_CHANNELS, ALL_ROLES, ASSIST, fullName, L, ok } from '../erp/common';
import type { AiToolDef, ToolCtx, ToolResult } from '../types';
import { inCompany } from '../types';

// Kamera tool'lari (owner 2026-10-18): "rasmga ol", "videoga ol", "shuni rahbarga / Aliga yubor".
//  • capturePhoto / recordVideo — Telegram video qo'ng'irog'idagi suhbatdosh kamerasidan; natija avval
//    foydalanuvchining O'Z Telegram'iga (ERP bot) boradi — tasdiq kerak emas.
//  • forwardMedia — olingan rasm/videoni boshqa odamga (rahbar yoki aniq xodim) — confirm:'always'.

const CALL_CHANNELS = ['telegram_call', 'inapp_call'] as const;
const NO_CAMERA = (ctx: ToolCtx): ToolResult => ({
  status: 'error', retryable: false,
  message: L(ctx, "Kamerangiz ko'rinmayapti — Telegram qo'ng'iroqda kamerani yoqing (video qo'ng'iroq).", 'Камера не видна — включите камеру в звонке Telegram.'),
});

async function sendMediaTo(userId: string, companyId: string, m: Media, caption: string): Promise<boolean> {
  const bot = getBotInstance();
  if (!bot) return false;
  const u: any = await User.findOne({ _id: userId, companyId, isBlocked: { $ne: true } }).select('telegramChatId').lean().catch(() => null);
  if (!u?.telegramChatId) return false;
  const opts = { caption: truncateText(caption, 900) };
  try {
    if (m.kind === 'photo' && bot.sendPhoto) { await bot.sendPhoto(u.telegramChatId, m.data, opts, { filename: 'rasm.jpg', contentType: 'image/jpeg' }); return true; }
    if (m.kind === 'video' && bot.sendVideo) { await bot.sendVideo(u.telegramChatId, m.data, opts, { filename: 'video.mp4', contentType: 'video/mp4' }); return true; }
  } catch (e) {
    console.warn('[aiVoice/camera] yuborilmadi:', (e as Error).message?.slice(0, 80));
  }
  return false;
}

const deliveredText = (ctx: ToolCtx, kind: Media['kind'], sent: boolean, id: string) => {
  const what = kind === 'photo' ? L(ctx, 'Rasm', 'Фото') : L(ctx, 'Video', 'Видео');
  return sent
    ? L(ctx, `${what} olindi va Telegram'ingizga yuborildi (id ${id}). Boshqa odamga yuborish kerak bo'lsa — ayting.`, `${what} готово и отправлено вам в Telegram (id ${id}).`)
    : L(ctx, `${what} olindi (id ${id}), lekin Telegram'ingizga yuborib bo'lmadi — ERP botiga ulaning. Boshqa odamga yuborishim mumkin.`, `${what} готово (id ${id}), но в ваш Telegram отправить не удалось.`);
};

export const capturePhoto: AiToolDef<{ caption?: string }> = {
  name: 'capturePhoto',
  description: {
    uz: "Suhbatdosh kamerasidan RASM olish (\"rasmga ol\", \"suratga ol\") — foydalanuvchining Telegram'iga yuboriladi. Boshqaga yuborish — keyin forwardMedia.",
    ru: 'Сделать ФОТО с камеры собеседника («сфоткай») — отправляется пользователю в Telegram. Переслать другому — forwardMedia.',
  },
  parameters: { type: 'object', properties: { caption: { type: 'string', maxLength: 200, description: 'Rasm izohi' } } },
  kind: 'write',
  confirm: 'never',
  maxRoles: ALL_ROLES,
  defaultRoles: ALL_ROLES,
  purposes: ASSIST,
  channels: [...CALL_CHANNELS],
  behavior: 'BLOCKING',
  auditEntity: 'ai_camera_photo',
  auditAction: 'upload',
  handler: async (ctx, args) => {
    const f = latestFrame(ctx.sessionId);
    if (!f) return NO_CAMERA(ctx);
    const m = saveMedia({ kind: 'photo', data: f.jpeg, companyId: ctx.companyId, ownerId: ctx.userId, caption: args.caption });
    const sent = await sendMediaTo(ctx.userId, ctx.companyId, m, args.caption || L(ctx, "📷 AI qo'ng'iroqdan rasm", '📷 Фото из звонка AI'));
    return ok(deliveredText(ctx, 'photo', sent, m.id), { mediaId: m.id, kind: 'photo', sentToMe: sent });
  },
};

export const recordVideo: AiToolDef<{ seconds?: number; caption?: string }> = {
  name: 'recordVideo',
  description: {
    uz: "Suhbatdosh kamerasidan VIDEO yozish (\"videoga ol\", \"10 soniya yozib ol\"), 3–20 s — foydalanuvchining Telegram'iga yuboriladi.",
    ru: 'Записать ВИДЕО с камеры собеседника (3–20 с) — отправляется пользователю в Telegram.',
  },
  parameters: {
    type: 'object',
    properties: {
      seconds: { type: 'integer', minimum: 3, maximum: 20, description: 'Necha soniya (standart 8)' },
      caption: { type: 'string', maxLength: 200 },
    },
  },
  kind: 'write',
  confirm: 'never',
  maxRoles: ALL_ROLES,
  defaultRoles: ALL_ROLES,
  purposes: ASSIST,
  channels: [...CALL_CHANNELS],
  behavior: 'BLOCKING',
  auditEntity: 'ai_camera_video',
  auditAction: 'upload',
  handler: async (ctx, args) => {
    if (!ctx.sessionId || !latestFrame(ctx.sessionId)) return NO_CAMERA(ctx);
    const sec = Math.max(3, Math.min(20, Math.round(Number(args.seconds) || 8)));
    const fps = 6;
    // Yozish paytida worker ko'proq kadr yuborsin (keyin 1 kadr/s ga qaytadi)
    await callWorker('call.video_rate', { sessionId: ctx.sessionId, fps, forSec: sec + 2 }).catch(() => undefined);
    const frames = await collectFrames(ctx.sessionId, sec * 1000);
    if (frames.length < 3) return NO_CAMERA(ctx);
    let data: Buffer;
    try {
      data = await encodeMp4(frames, Math.max(1, Math.min(fps, frames.length / sec)));
    } catch (e) {
      console.warn('[aiVoice/camera] video kodlanmadi:', (e as Error).message?.slice(0, 120));
      return { status: 'error', retryable: true, message: L(ctx, "Videoni tayyorlab bo'lmadi, qayta urinib ko'ring.", 'Не удалось собрать видео.') };
    }
    const m = saveMedia({ kind: 'video', data, companyId: ctx.companyId, ownerId: ctx.userId, caption: args.caption });
    const sent = await sendMediaTo(ctx.userId, ctx.companyId, m, args.caption || L(ctx, "🎥 AI qo'ng'iroqdan video", '🎥 Видео из звонка AI'));
    return ok(deliveredText(ctx, 'video', sent, m.id), { mediaId: m.id, kind: 'video', seconds: sec, sentToMe: sent });
  },
};

type FwdArgs = { mediaId?: string; to: 'manager' | 'employee'; employeeId?: string; employeeName?: string; caption?: string };

export const forwardMedia: AiToolDef<FwdArgs> = {
  name: 'forwardMedia',
  description: {
    uz: "Olingan rasm/videoni boshqa odamga yuborish: to='manager' (o'z rahbari) yoki to='employee' + employeeName (aniq xodim). mediaId berilmasa — oxirgi olingan.",
    ru: "Переслать снятое фото/видео: to='manager' (своему руководителю) или to='employee' + employeeName. Без mediaId — последнее.",
  },
  parameters: {
    type: 'object',
    properties: {
      mediaId: { type: 'string', maxLength: 20 },
      to: { type: 'string', enum: ['manager', 'employee'] },
      employeeId: { type: 'string' },
      employeeName: { type: 'string', maxLength: 60 },
      caption: { type: 'string', maxLength: 300 },
    },
    required: ['to'],
  },
  kind: 'write',
  confirm: 'always',
  maxRoles: ALL_ROLES,
  defaultRoles: ALL_ROLES,
  purposes: ASSIST,
  channels: ALL_CHANNELS,
  behavior: 'BLOCKING',
  refs: { employeeId: 'User' },
  untrustedKeys: ['name'],
  auditEntity: 'ai_media_forward',
  auditAction: 'send_push',
  summarize: (a, lng) => {
    const who = a.to === 'manager' ? (lng === 'ru' ? 'руководителю' : 'rahbarga') : (a.employeeName || (lng === 'ru' ? 'сотруднику' : 'xodimga'));
    return lng === 'ru' ? `Отправить снятое ${who}` : `Olingan rasm/videoni ${who} yuborish`;
  },
  handler: async (ctx, args) => {
    const m = (args.mediaId && getMedia(args.mediaId, ctx.companyId)) || lastMediaOf(ctx.userId, ctx.companyId);
    if (!m) return { status: 'not_found', retryable: false, message: L(ctx, "Yuboradigan rasm yoki video yo'q — avval \"rasmga ol\" deng.", 'Нечего пересылать — сначала сделайте фото.') };
    const me: any = await User.findOne(inCompany(ctx, { _id: ctx.userId })).select('firstName lastName').lean();
    const from = truncateText(fullName(me) || 'Xodim', 60);
    const caption = `${m.kind === 'photo' ? '📷' : '🎥'} ${from}${args.caption ? `: ${truncateText(args.caption, 300)}` : ''}`;
    let targets: { id: string; name: string }[] = [];
    if (args.to === 'manager') {
      targets = (await resolveManagers(ctx.companyId, ctx.userId)).map((x) => ({ id: x.userId, name: x.name }));
      if (!targets.length) return { status: 'not_found', retryable: false, message: L(ctx, "Sizning rahbaringiz topilmadi — kimga yuborishni ism bilan ayting.", 'Руководитель не найден — назовите получателя.') };
    } else {
      if (ctx.role === 'ishchi' && !ctx.isOwner) return { status: 'denied', retryable: false, message: L(ctx, 'Ishchi faqat rahbariga yubora oladi.', 'Рабочий может отправить только руководителю.') };
      const r = await findEmployee(ctx, args);
      if (!r.one) {
        const names = r.many?.map((w) => w.name).join(', ');
        return { status: names ? 'error' : 'not_found', retryable: false, message: names ? L(ctx, `Bir nechta: ${names}. Qaysi biri?`, `Несколько: ${names}. Кто?`) : L(ctx, 'Bunday xodim topilmadi.', 'Сотрудник не найден.') };
      }
      targets = [{ id: r.one.id, name: r.one.name }];
    }
    const sent: string[] = [];
    const failed: string[] = [];
    for (const t of targets) ((await sendMediaTo(t.id, ctx.companyId, m, caption)) ? sent : failed).push(t.name);
    if (!sent.length) return { status: 'error', retryable: false, message: L(ctx, `Yuborib bo'lmadi: ${failed.join(', ')} ERP botiga ulanmagan.`, `Не отправлено: ${failed.join(', ')} не подключены к боту.`) };
    return ok(L(ctx, `Yuborildi: ${sent.join(', ')}.${failed.length ? ` Yetmadi: ${failed.join(', ')}.` : ''}`, `Отправлено: ${sent.join(', ')}.${failed.length ? ` Не дошло: ${failed.join(', ')}.` : ''}`), { sent, failed });
  },
};

export const setSubtitles: AiToolDef<{ on: boolean }> = {
  name: 'setSubtitles',
  description: {
    uz: "Video qo'ng'iroqdagi subtitrni (AI gapining yozuvi ekranda) yoqish/o'chirish. Standart o'chiq.",
    ru: 'Включить/выключить субтитры (текст речи AI на экране) в видеозвонке. По умолчанию выключены.',
  },
  parameters: { type: 'object', properties: { on: { type: 'boolean' } }, required: ['on'] },
  kind: 'read',
  confirm: 'never',
  general: true,
  maxRoles: ALL_ROLES,
  defaultRoles: ALL_ROLES,
  purposes: ASSIST,
  channels: ['telegram_call'],
  behavior: 'BLOCKING',
  handler: async (ctx, args) => {
    if (!ctx.sessionId) return { status: 'error', retryable: false, message: L(ctx, "Faqat Telegram qo'ng'irog'ida.", 'Только в звонке Telegram.') };
    try {
      await callWorker('call.subtitles', { sessionId: ctx.sessionId, on: !!args.on });
    } catch {
      return { status: 'error', retryable: true, message: L(ctx, "Subtitrni hozir o'zgartirib bo'lmadi.", 'Не удалось переключить субтитры.') };
    }
    return ok(args.on ? L(ctx, 'Subtitr yoqildi.', 'Субтитры включены.') : L(ctx, "Subtitr o'chirildi.", 'Субтитры выключены.'), { on: !!args.on });
  },
};

export const CAMERA_TOOLS: AiToolDef[] = [capturePhoto, recordVideo, forwardMedia, setSubtitles];
