import { Router } from 'express';
import AppBuild from '../models/AppBuild';
import AppRelease from '../models/AppRelease';

// Ilova yangilanishini QO'LDA chiqarish (owner 2026-10-28: "har bitta push bo'lgan
// yangilanish admin panelga ko'rinadi va bittasini tanlab yuboraman").
//
// CI qurgan har bir build AppBuild'ga tushadi, lekin foydalanuvchilarga ketmaydi.
// Dasturchi shu yerdan HAR BIR qurilma turini (Android/Windows/macOS) ALOHIDA
// chiqaradi (owner 2026-11-05: "notebook ga alohida apk alohida exe alohida
// mac os ga alohida ... hammasiga alohida qil") — bittasini chiqarish
// boshqalariga tegmaydi. O'shanda AppRelease('latest').<platform> yangilanadi
// va o'sha platformadagi ilovalar (UpdateChecker) yangilanishni ko'radi.
const router = Router();

type Platform = 'android' | 'windows' | 'macos';
const URL_FIELD: Record<Platform, 'apkUrl' | 'exeUrl' | 'dmgUrl'> = {
  android: 'apkUrl',
  windows: 'exeUrl',
  macos: 'dmgUrl',
};
const PUBLISHED_FIELD: Record<Platform, 'apkPublishedAt' | 'exePublishedAt' | 'dmgPublishedAt'> = {
  android: 'apkPublishedAt',
  windows: 'exePublishedAt',
  macos: 'dmgPublishedAt',
};

/** GET / — oxirgi build'lar ro'yxati va har bir platforma uchun hozir nima chiqarilgani. */
router.get('/', async (_req, res) => {
  res.set('Cache-Control', 'no-store');
  try {
    const [builds, current] = await Promise.all([
      AppBuild.find().sort({ createdAt: -1 }).limit(30).lean(),
      AppRelease.findOne({ key: 'latest' }).lean(),
    ]);
    const platformInfo = (p: Platform) => {
      const rel = (current as any)?.[p];
      return rel ? { version: rel.version, updatedAt: rel.updatedAt } : null;
    };
    res.json({
      current: {
        android: platformInfo('android'),
        windows: platformInfo('windows'),
        macos: platformInfo('macos'),
      },
      builds: builds.map((b: any) => ({
        id: String(b._id),
        version: b.version,
        notes: b.notes || '',
        apkUrl: b.apkUrl || null,
        exeUrl: b.exeUrl || null,
        dmgUrl: b.dmgUrl || null,
        createdAt: b.createdAt,
        apkPublishedAt: b.apkPublishedAt || null,
        exePublishedAt: b.exePublishedAt || null,
        dmgPublishedAt: b.dmgPublishedAt || null,
        isCurrentAndroid: !!(current as any)?.android && (current as any).android.version === b.version,
        isCurrentWindows: !!(current as any)?.windows && (current as any).windows.version === b.version,
        isCurrentMacos: !!(current as any)?.macos && (current as any).macos.version === b.version,
      })),
    });
  } catch (err) {
    console.error('[app-builds]', err);
    res.status(500).json({ error: 'Server xatoligi' });
  }
});

/** POST /:id/publish/:platform — shu build'ni FAQAT shu bitta qurilma turiga chiqaradi. */
router.post('/:id/publish/:platform', async (req, res) => {
  try {
    const platform = req.params.platform as Platform;
    if (platform !== 'android' && platform !== 'windows' && platform !== 'macos') {
      return res.status(400).json({ error: "platform android/windows/macos bo'lishi kerak" });
    }
    const build: any = await AppBuild.findById(req.params.id).lean().catch(() => null);
    if (!build) return res.status(404).json({ error: 'Build topilmadi' });

    const urlField = URL_FIELD[platform];
    const url = build[urlField];
    if (!url) {
      return res.status(400).json({ error: "Bu build'da shu qurilma uchun fayl yo'q" });
    }

    const now = new Date();
    // Legacy (eski o'rnatilgan ilovalar uchun) ko'prik maydonlari — faqat SHU
    // platformaning o'z havola maydoni yangilanadi, boshqa ikkisiga tegilmaydi;
    // umumiy `version`/`notes`/`updatedAt` esa "oxirgi chiqarilgan harakat"ni
        // aks ettiradi (eski bir-versiyali mijozlar shundan foydalanishda davom etadi).
    await AppRelease.findOneAndUpdate(
      { key: 'latest' },
      {
        $set: {
          key: 'latest',
          version: build.version,
          notes: build.notes || '',
          updatedAt: now,
          [urlField]: url,
          [platform]: { version: build.version, notes: build.notes || '', url, updatedAt: now },
        },
      },
      { upsert: true },
    );
    await AppBuild.updateOne({ _id: build._id }, { $set: { [PUBLISHED_FIELD[platform]]: now } });

    console.log(`[app-builds] chiqarildi (${platform}): v${build.version}`);
    res.json({ ok: true, platform, version: build.version });
  } catch (err) {
    console.error('[app-builds/publish]', err);
    res.status(500).json({ error: 'Server xatoligi' });
  }
});

export default router;
