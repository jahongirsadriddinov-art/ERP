import { Router, type Request, type Response } from 'express';
import AppSettings from '../models/AppSettings';
import BotUiConfig from '../models/BotUiConfig';
import AiAssistantSettings from '../models/AiAssistantSettings';
import Company from '../models/Company';
import User from '../models/User';
import { defaultSettings, invalidateSettings } from '../aiVoice/settings';
import { reloadBotUi } from '../services/botUi/runtime';
import { logAudit } from '../services/audit';

// Dasturchi paneli → "Sozlamalarni standartga qaytarish": AppSettings (global),
// BotUiConfig (global), AiAssistantSettings (har firma) va Company.features (har firma)
// standart qiymatlarga qaytariladi. Userlar, obyektlar, tranzaksiyalar, AI suhbat/qo'ng'iroq
// tarixi va Telegram integratsiya holati (discoveredChats/communityChatId/...) TEGILMAYDI
// (owner 2026-11-08: "faqat userlar va malumotlar qolsin, qolgani reset").
// index.ts: app.use('/api/dev/settings-reset', requireAuth, requireDeveloper, devSettingsResetRoutes)
const router = Router();

const SECTIONS = ['appSettings', 'botUi', 'aiAssistant', 'companyFeatures'] as const;
type Section = typeof SECTIONS[number];

async function actorOf(req: Request) {
  const id = String((req as any).user?.userId || '');
  const u: any = id ? await User.findById(id).select('firstName lastName role').lean().catch(() => null) : null;
  return { userId: id, name: u ? `${u.firstName || ''} ${u.lastName || ''}`.trim() || 'Dasturchi' : 'Dasturchi', role: u?.role || 'dasturchi' };
}

// Hisobot/ko'rish uchun: nima o'zgarishini amalga oshirmasdan oldin ko'rsatish.
router.get('/preview', async (_req: Request, res: Response) => {
  const companies = await Company.find({}).select('_id name').lean();
  res.json({
    sections: SECTIONS,
    companiesAffected: companies.length,
    note: "Userlar, obyektlar, tranzaksiyalar, hujjatlar, AI suhbat/qo'ng'iroq tarixi va Telegram integratsiya holati (kashf qilingan chatlar, community ID/havola) o'zgarmaydi.",
  });
});

router.post('/', async (req: Request, res: Response) => {
  const body = req.body || {};
  const requested: Section[] = Array.isArray(body.sections) && body.sections.length
    ? body.sections.filter((s: any) => SECTIONS.includes(s))
    : [...SECTIONS];
  if (!requested.length) return res.status(400).json({ error: "sections noto'g'ri" });

  const by = await actorOf(req);
  const result: Record<string, any> = {};

  if (requested.includes('appSettings')) {
    await AppSettings.findOneAndUpdate(
      { key: 'global' },
      {
        $set: {
          siteEnabled: true, appEnabled: true, botEnabled: true,
          priceChannels: [], priceSites: [],
          devButtonLabels: {}, devButtonOrder: [],
          adminButtonLabels: {}, adminButtonOrder: [],
          userButtonLabels: {}, userButtonOrder: [],
          devMessageTexts: {}, requiredChannels: [],
        },
        $unset: { subscribeGateMsg: 1, customPlanPricing: 1 },
      },
      { upsert: true, setDefaultsOnInsert: true },
    );
    result.appSettings = 'reset';
  }

  if (requested.includes('botUi')) {
    await BotUiConfig.findOneAndUpdate(
      { key: 'global' },
      { $set: { buttons: {}, messageEmoji: [], commands: [], draft: null, messageEmojiEnabled: true, stripEmojiWhenIcon: true, updatedBy: by.userId } },
      { upsert: true, setDefaultsOnInsert: true },
    );
    await reloadBotUi();
    result.botUi = 'reset';
  }

  const companies = await Company.find({}).select('_id').lean();

  if (requested.includes('aiAssistant')) {
    let n = 0;
    for (const c of companies) {
      const companyId = String(c._id);
      const { companyId: _c, version: _v, ...defaults } = defaultSettings(companyId);
      await AiAssistantSettings.findOneAndUpdate(
        { companyId },
        { $set: { ...defaults, companyId, updatedBy: by.userId }, $inc: { version: 1 } },
        { upsert: true, setDefaultsOnInsert: true },
      );
      invalidateSettings(companyId);
      n++;
    }
    result.aiAssistant = { reset: n };
  }

  if (requested.includes('companyFeatures')) {
    const r = await Company.updateMany({}, {
      $set: {
        'features.briefing': true, 'features.theft': true, 'features.prices': true,
        'features.docs': true, 'features.equipment': true, 'features.photoAi': true,
        'features.piecework': false,
      },
    });
    result.companyFeatures = { matched: r.matchedCount, modified: r.modifiedCount };
  }

  await logAudit({
    userId: by.userId, userName: by.name, userRole: by.role,
    action: 'update', entity: 'settings-reset',
    description: `Sozlamalar standartga qaytarildi: ${requested.join(', ')}`,
    newValue: result,
    req,
  });

  res.json({ ok: true, sections: requested, result });
});

export default router;
