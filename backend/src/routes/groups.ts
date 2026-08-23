import { Router } from 'express';
import Group from '../models/Group';
import User from '../models/User';
import { emitToUser, getIO } from '../services/socket';
import { scoped, stamped } from '../middleware/scope';
import { getTenant } from '../middleware/tenantContext';

const router = Router();

// MUHIM: memberIds/adminIds schema'da `default: []` bo'lsa ham, bu default
// FAQAT yangi hujjat yaratilganda qo'llanadi — ushbu maydon qo'shilishidan
// OLDIN yozilgan eski guruh hujjatlari (agar mavjud bo'lsa) DB'da bu maydonsiz
// qolib ketishi mumkin, va .find() ularni SHUNDAY, maydonsiz qaytaradi.
// Frontend `g.memberIds.length` kabi joylarda buni himoyasiz o'qigan edi —
// production'da real foydalanuvchida xato tashlagani Render log'ida
// ([ClientError] "l.memberIds.length" ...) tasdiqlangan. Frontend'da ham
// himoya qo'shildi, lekin manba — shu yerda — eng ishonchli joy.
const shape = (g: any) => ({ ...g.toObject(), id: g._id, memberIds: g.memberIds || [], adminIds: g.adminIds || [] });

// Foydalanuvchi a'zo bo'lgan guruhlar
// XAVFSIZLIK — TOPILMA (audit): `userId` avval to'g'ridan-to'g'ri
// query'dan olinardi — istalgan xodim boshqa birovning ID'sini berib,
// o'sha kishi a'zo bo'lgan BARCHA guruhlarni (nomi, a'zolari) ko'ra
// olardi. Endi doim joriy sessiya egasi.
router.get('/', async (req, res) => {
  try {
    const uid = getTenant()?.userId;
    if (!uid) return res.status(401).json({ error: 'Autentifikatsiya talab etiladi' });
    const groups = await Group.find(scoped({ memberIds: uid })).sort({ updatedAt: -1 });
    res.json(groups.map(shape));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server xatoligi' });
  }
});

// Dasturchi-support guruhini topish yoki yaratish (firma uchun alohida).
// Oddiy firma a'zosi o'z companyId'i uchun chaqiradi; dasturchi (isDeveloper)
// istalgan firmani body.companyId orqali ko'rsatib, o'sha guruhga qo'shilishi
// mumkin — shu bitta guruh orqali ikkala tomon HAM bir xil xabarlarni ko'radi.
router.post('/dev-support', async (req, res) => {
  try {
    const t = getTenant();
    const companyId = t?.isDeveloper ? String(req.body?.companyId || '') : t?.companyId;
    if (!companyId) return res.status(400).json({ error: 'companyId kerak (firma a\'zosi bo\'lishi shart)' });

    // Dasturchi user topamiz
    const dev = await User.findOne({ role: 'dasturchi' }).lean();
    const devId = dev ? String(dev._id) : null;
    const callerId = t?.isDeveloper ? null : (t?.userId ? String(t.userId) : '');

    // Allaqachon mavjud devSupport guruhini qidiramiz
    let group = await Group.findOne({ companyId, devSupport: true });
    if (!group) {
      const members = [...new Set([callerId, devId].filter(Boolean))] as string[];
      group = await Group.create({
        name: '🛠 Dasturchi',
        devSupport: true,
        companyId,
        memberIds: members,
        adminIds: devId ? [devId] : [],
        createdBy: callerId || devId || '',
      });
      if (devId && callerId) emitToUser(devId, 'group:new', shape(group));
    } else {
      // Eski (memberIds maydoni qo'shilishidan oldingi) guruh hujjati bo'lsa ham
      // .includes()/.push() xato tashlamasligi uchun himoya.
      if (!group.memberIds) group.memberIds = [];
      let changed = false;
      if (devId && !group.memberIds.includes(devId)) {
        group.memberIds.push(devId);
        changed = true;
        if (callerId) emitToUser(devId, 'group:new', shape(group));
      }
      if (callerId && !group.memberIds.includes(callerId)) {
        group.memberIds.push(callerId);
        changed = true;
        emitToUser(callerId, 'group:new', shape(group));
      }
      if (changed) await group.save();
    }
    res.json(shape(group));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server xatoligi' });
  }
});

// Guruh yaratish
// XAVFSIZLIK — TOPILMA (audit): `createdBy` avval to'g'ridan-to'g'ri
// so'rov tanasidan olinardi — messages.ts'dagi fromUserId/materials.ts'dagi
// senderId bilan bir xil taqlid (impersonatsiya) sinfidagi zaiflik: istalgan
// xodim boshqa birortasini guruh yaratuvchisi/yagona admini qilib
// "ko'rsatishi" mumkin edi. Endi doim joriy sessiya egasi.
router.post('/', async (req, res) => {
  try {
    const tenant = getTenant();
    const creatorId = tenant?.userId;
    if (!creatorId) return res.status(401).json({ error: 'Autentifikatsiya talab etiladi' });
    const { name, memberIds, avatar } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'name kerak' });
    const members = Array.from(new Set([String(creatorId), ...(memberIds || []).map(String)]));
    const group = await Group.create(stamped({
      name: name.trim(),
      avatar,
      memberIds: members,
      adminIds: [String(creatorId)],
      createdBy: String(creatorId),
    }));
    // Barcha a'zolarga xabar berish
    members.forEach(uid => emitToUser(uid, 'group:new', shape(group)));
    res.status(201).json(shape(group));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server xatoligi' });
  }
});

// A'zo qo'shish
// XAVFSIZLIK — TOPILMA (audit): scoped() firmalararo sizishni to'sardi,
// lekin firma ICHIDA guruhga a'ZO bo'lmagan istalgan xodim ham o'zi
// tanlagan odamlarni o'sha guruhga qo'sha olardi. Endi faqat guruh
// a'zosi (yoki admini) shu amalni bajara oladi.
router.post('/:id/members', async (req, res) => {
  try {
    const tenant = getTenant();
    const actorId = tenant?.userId;
    if (!actorId) return res.status(401).json({ error: 'Autentifikatsiya talab etiladi' });
    const { memberIds } = req.body;
    const group = await Group.findOne(scoped({ _id: req.params.id }));
    if (!group) return res.status(404).json({ error: 'Guruh topilmadi' });
    if (!group.memberIds) group.memberIds = [];
    if (!group.memberIds.includes(String(actorId))) return res.status(403).json({ error: 'Faqat guruh a\'zosi qo\'sha oladi' });
    const toAdd = (memberIds || []).map(String).filter((id: string) => !group.memberIds.includes(id));
    group.memberIds.push(...toAdd);
    await group.save();
    (group.memberIds || []).forEach(uid => emitToUser(uid, 'group:update', shape(group)));
    res.json(shape(group));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server xatoligi' });
  }
});

// Guruhdan chiqish / a'zoni o'chirish
// XAVFSIZLIK — TOPILMA (audit): `userId` (kim chiqarilishi) avval
// to'g'ridan-to'g'ri so'rov tanasidan olinardi, hech qanday tekshiruvsiz
// — istalgan xodim istalgan boshqa a'zoni (guruh a'zosi bo'lmasa ham)
// istalgan guruhdan chiqarib yubora olardi. Endi: o'zini chiqarish har
// doim ruxsat etiladi (haqiqiy "guruhdan chiqish"); boshqa birovni
// chiqarish faqat guruh admini uchun.
router.post('/:id/leave', async (req, res) => {
  try {
    const tenant = getTenant();
    const actorId = tenant?.userId;
    if (!actorId) return res.status(401).json({ error: 'Autentifikatsiya talab etiladi' });
    const { userId } = req.body;
    const group = await Group.findOne(scoped({ _id: req.params.id }));
    if (!group) return res.status(404).json({ error: 'Guruh topilmadi' });
    const leaving = String(userId || actorId);
    const isSelf = leaving === String(actorId);
    const isGroupAdmin = (group.adminIds || []).includes(String(actorId));
    if (!isSelf && !isGroupAdmin) return res.status(403).json({ error: 'Faqat guruh admini boshqa a\'zoni chiqara oladi' });
    group.memberIds = (group.memberIds || []).filter(id => id !== leaving);
    group.adminIds = (group.adminIds || []).filter(id => id !== leaving);
    await group.save();
    emitToUser(leaving, 'group:removed', { id: String(group._id) });
    (group.memberIds || []).forEach(uid => emitToUser(uid, 'group:update', shape(group)));
    res.json(shape(group));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server xatoligi' });
  }
});

// Guruh nomi/avatarini yangilash
// XAVFSIZLIK — TOPILMA (audit): guruh a'zosi bo'lmagan xodim ham
// istalgan guruh nomini/rasmini o'zgartira olardi (scoped() faqat
// firmalararo sizishni to'sadi, guruh a'zoligini emas). Endi faqat
// guruh a'zosi.
router.patch('/:id', async (req, res) => {
  try {
    const tenant = getTenant();
    const actorId = tenant?.userId;
    if (!actorId) return res.status(401).json({ error: 'Autentifikatsiya talab etiladi' });
    const { name, avatar } = req.body;
    const group = await Group.findOne(scoped({ _id: req.params.id }));
    if (!group) return res.status(404).json({ error: 'Guruh topilmadi' });
    if (!(group.memberIds || []).includes(String(actorId))) return res.status(403).json({ error: 'Faqat guruh a\'zosi o\'zgartira oladi' });
    if (name?.trim()) group.name = name.trim();
    if (avatar !== undefined) group.avatar = avatar;
    await group.save();
    (group.memberIds || []).forEach(uid => emitToUser(uid, 'group:update', shape(group)));
    res.json(shape(group));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server xatoligi' });
  }
});

export default router;
