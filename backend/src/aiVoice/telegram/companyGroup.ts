// Owner 2026-11-06: "user yangi firma ochadiyu oshanda assistent ozi osha firmaga guruh ochsin
// ... ozi auto hamma ishchi userlari qoshadi ... agar qoship bolmasi link yuboradi qoshiling
// dep tushintirip faqat guruhni erp-frma comunity ichida yaratadi".
//
// Haqiqiy Telegram cheklovi (Bot API'da hech qanday yo'l bilan chetlab o'tib bo'lmaydi):
//  - bot YANGI guruh YARATA OLMAYDI — faqat odam o'zi yaratgan guruhga qo'shilishi mumkin;
//  - bot biror foydalanuvchini JIM (so'ramasdan) guruhga qo'sha OLMAYDI — faqat taklif havolasi
//    orqali odamning o'zi qo'shiladi.
// Shu sabab "avtomatik guruh" amalda: dasturchi BIR MARTA, oldindan, bitta katta "ERP-Firma
// community" supergruppasini (Mavzular/Topics yoqilgan holda) yaratadi, botni admin qiladi va
// o'sha guruh ICHIDA "/community" yuboradi (bot.ts). Shundan keyin:
//  - har yangi firma uchun bot o'sha community ichida nomi bilan MAVZU (forum topic) ochadi —
//    buni bot HAQIQATAN avtomatik va darhol qiladi (createForumTopic — bu cheklanmagan);
//  - xodim botga Telegram orqali bog'langanda (onBotLinked) — bot unga community'ga taklif
//    havolasini va qaysi mavzuni qidirishi kerakligini (firma nomi) yozib yuboradi.
import Company from '../../models/Company';
import AppSettings from '../../models/AppSettings';
import User from '../../models/User';
import { tgCall } from '../../services/botUi/telegramApi';
import { botLinkedTgId } from './tgLink';

async function getSettings(): Promise<any> {
  return AppSettings.findOne({ key: 'global' }).select('communityChatId communityInviteLink').lean();
}

/** Community'ga bitta umumiy taklif havolasi — birinchi so'ralganda yaratiladi va keshlanadi. */
async function communityInviteLink(chatId: string): Promise<string | null> {
  const s = await getSettings();
  if (s?.communityInviteLink) return s.communityInviteLink;
  try {
    const link = await tgCall<{ invite_link: string }>('createChatInviteLink', { chat_id: chatId, name: 'QurilishERP xodimlari' });
    await AppSettings.findOneAndUpdate({ key: 'global' }, { $set: { communityInviteLink: link.invite_link, updatedAt: new Date() } });
    return link.invite_link;
  } catch (e) {
    console.error('[companyGroup] taklif havolasi yaratilmadi:', (e as Error).message || e);
    return null;
  }
}

/** Firma uchun community ichidagi mavzuni (forum topic) topadi, bo'lmasa yaratadi. */
export async function ensureCompanyTopic(companyId: string): Promise<{ chatId: string; topicId: number; inviteLink: string; companyName: string } | null> {
  const s = await getSettings();
  const chatId = s?.communityChatId;
  if (!chatId) return null; // dasturchi hali "/community" bermagan — jim o'tkazib yuboriladi
  const company: any = await Company.findById(companyId);
  if (!company) return null;
  const inviteLink = await communityInviteLink(chatId);
  if (!inviteLink) return null;
  if (company.telegramTopicId) {
    return { chatId, topicId: company.telegramTopicId, inviteLink, companyName: company.name };
  }
  try {
    const topic = await tgCall<{ message_thread_id: number }>('createForumTopic', { chat_id: chatId, name: String(company.name || 'Firma').slice(0, 128) });
    company.telegramTopicId = topic.message_thread_id;
    await company.save();
    await tgCall('sendMessage', {
      chat_id: chatId, message_thread_id: topic.message_thread_id,
      text: `🏗 "${company.name}" jamoasi uchun mavzu ochildi. Xodimlar shu yerga qo'shiladi.`,
    }).catch(() => {});
    return { chatId, topicId: topic.message_thread_id, inviteLink, companyName: company.name };
  } catch (e) {
    console.error('[companyGroup] mavzu ochib bo\'lmadi:', (e as Error).message || e);
    return null;
  }
}

/**
 * Xodim botga Telegram orqali bog'langanda chaqiriladi (onBotLinked) — firmasining community
 * mavzusini tayyorlaydi (yo'q bo'lsa ochadi) va unga taklif xabari yuboradi. Jim xato qiladi —
 * bu ixtiyoriy qulaylik, asosiy bog'lanish oqimini bloklamasligi kerak.
 */
export async function inviteEmployeeToCompanyGroup(userId: string): Promise<void> {
  try {
    const u: any = await User.findById(userId).select('companyId telegramChatId telegramUserId role name').lean();
    if (!u?.companyId || u.role === 'dasturchi') return;
    const tgId = botLinkedTgId(u);
    if (!tgId) return;
    const topic = await ensureCompanyTopic(String(u.companyId));
    if (!topic) return;
    const text = `👋 Assalomu alaykum${u.name ? `, ${u.name}` : ''}!\n\n"${topic.companyName}" jamoasining Telegram guruhi tayyor. Qo'shiling:\n${topic.inviteLink}\n\nQo'shilgach, "${topic.companyName}" nomli mavzuni (topic) toping — firma e'lonlari va suhbat shu yerda boradi.`;
    await tgCall('sendMessage', { chat_id: tgId, text }).catch(() => {});
  } catch (e) {
    console.error('[companyGroup] taklif yuborilmadi:', (e as Error).message || e);
  }
}
