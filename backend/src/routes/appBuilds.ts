import { Router } from 'express';
import AppBuild from '../models/AppBuild';
import AppRelease from '../models/AppRelease';

// Ilova yangilanishini QO'LDA chiqarish (owner 2026-10-28: "har bitta push bo'lgan
// yangilanish admin panelga ko'rinadi va bittasini tanlab yuboraman").
//
// CI qurgan har bir build AppBuild'ga tushadi, lekin foydalanuvchilarga ketmaydi.
// Dasturchi shu yerdan birini tanlab chiqaradi — o'shanda AppRelease('latest')
// yangilanadi va ilovalar (UpdateChecker) yangilanishni ko'radi.
const router = Router();

/** GET / — oxirgi build'lar ro'yxati va qaysi biri hozir chiqarilgani. */
router.get('/', async (_req, res) => {
  res.set('Cache-Control', 'no-store');
  try {
    const [builds, current] = await Promise.all([
      AppBuild.find().sort({ createdAt: -1 }).limit(30).lean(),
      AppRelease.findOne({ key: 'latest' }).lean(),
    ]);
    res.json({
      current: current ? { version: current.version, updatedAt: current.updatedAt } : null,
      builds: builds.map((b: any) => ({
        id: String(b._id),
        version: b.version,
        notes: b.notes || '',
        apkUrl: b.apkUrl || null,
        exeUrl: b.exeUrl || null,
        createdAt: b.createdAt,
        publishedAt: b.publishedAt || null,
        isCurrent: !!current && current.version === b.version,
      })),
    });
  } catch (err) {
    console.error('[app-builds]', err);
    res.status(500).json({ error: 'Server xatoligi' });
  }
});

/** POST /:id/publish — shu build'ni foydalanuvchilarga chiqaradi. */
router.post('/:id/publish', async (req, res) => {
  try {
    const build: any = await AppBuild.findById(req.params.id).lean().catch(() => null);
    if (!build) return res.status(404).json({ error: 'Build topilmadi' });
    if (!build.apkUrl && !build.exeUrl) {
      return res.status(400).json({ error: "Bu build'da yuklab olinadigan fayl yo'q" });
    }

    await AppRelease.findOneAndUpdate(
      { key: 'latest' },
      {
        $set: {
          key: 'latest',
          version: build.version,
          notes: build.notes || '',
          apkUrl: build.apkUrl || undefined,
          exeUrl: build.exeUrl || undefined,
          updatedAt: new Date(),
        },
      },
      { upsert: true },
    );
    await AppBuild.updateOne({ _id: build._id }, { $set: { publishedAt: new Date() } });

    console.log(`[app-builds] chiqarildi: v${build.version}`);
    res.json({ ok: true, version: build.version });
  } catch (err) {
    console.error('[app-builds/publish]', err);
    res.status(500).json({ error: 'Server xatoligi' });
  }
});

export default router;
