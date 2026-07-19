import { Router } from 'express';
import Group from '../models/Group';
import User from '../models/User';
import { emitToUser, getIO } from '../services/socket';
import { scoped, stamped } from '../middleware/scope';
import { getTenant } from '../middleware/tenantContext';

const router = Router();

const shape = (g: any) => ({ ...g.toObject(), id: g._id });

// Foydalanuvchi a'zo bo'lgan guruhlar
router.get('/', async (req, res) => {
  try {
    const { userId } = req.query;
    if (!userId) return res.status(400).json({ error: 'userId kerak' });
    const groups = await Group.find(scoped({ memberIds: String(userId) })).sort({ updatedAt: -1 });
    res.json(groups.map(shape));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server xatoligi' });
  }
});

// Dasturchi-support guruhini topish yoki yaratish (firma uchun alohida)
router.post('/dev-support', async (req, res) => {
  try {
    const t = getTenant();
    if (!t?.companyId) return res.status(400).json({ error: 'companyId kerak (firma a\'zosi bo\'lishi shart)' });

    // Dasturchi user topamiz
    const dev = await User.findOne({ role: 'dasturchi' }).lean();
    const devId = dev ? String(dev._id) : null;
    const callerId = t.userId ? String(t.userId) : '';

    // Allaqachon mavjud devSupport guruhini qidiramiz
    let group = await Group.findOne({ companyId: t.companyId, devSupport: true });
    if (!group) {
      const members = [...new Set([callerId, ...(devId ? [devId] : [])])].filter(Boolean);
      group = await Group.create({
        name: '🛠 Dasturchi',
        devSupport: true,
        companyId: t.companyId,
        memberIds: members,
        adminIds: devId ? [devId] : [],
        createdBy: callerId,
      });
      if (devId) emitToUser(devId, 'group:new', { ...group.toObject(), id: group._id });
    } else {
      let changed = false;
      if (devId && !group.memberIds.includes(devId)) {
        group.memberIds.push(devId);
        changed = true;
        emitToUser(devId, 'group:new', { ...group.toObject(), id: group._id });
      }
      if (callerId && !group.memberIds.includes(callerId)) {
        group.memberIds.push(callerId);
        changed = true;
      }
      if (changed) await group.save();
    }
    res.json({ ...group.toObject(), id: group._id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server xatoligi' });
  }
});

// Guruh yaratish
router.post('/', async (req, res) => {
  try {
    const { name, memberIds, createdBy, avatar } = req.body;
    if (!name?.trim() || !createdBy) return res.status(400).json({ error: 'name va createdBy kerak' });
    const members = Array.from(new Set([String(createdBy), ...(memberIds || []).map(String)]));
    const group = await Group.create(stamped({
      name: name.trim(),
      avatar,
      memberIds: members,
      adminIds: [String(createdBy)],
      createdBy: String(createdBy),
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
router.post('/:id/members', async (req, res) => {
  try {
    const { memberIds } = req.body;
    const group = await Group.findOne(scoped({ _id: req.params.id }));
    if (!group) return res.status(404).json({ error: 'Guruh topilmadi' });
    const toAdd = (memberIds || []).map(String).filter((id: string) => !group.memberIds.includes(id));
    group.memberIds.push(...toAdd);
    await group.save();
    group.memberIds.forEach(uid => emitToUser(uid, 'group:update', shape(group)));
    res.json(shape(group));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server xatoligi' });
  }
});

// Guruhdan chiqish / a'zoni o'chirish
router.post('/:id/leave', async (req, res) => {
  try {
    const { userId } = req.body;
    const group = await Group.findOne(scoped({ _id: req.params.id }));
    if (!group) return res.status(404).json({ error: 'Guruh topilmadi' });
    const leaving = String(userId);
    group.memberIds = group.memberIds.filter(id => id !== leaving);
    group.adminIds = group.adminIds.filter(id => id !== leaving);
    await group.save();
    emitToUser(leaving, 'group:removed', { id: String(group._id) });
    group.memberIds.forEach(uid => emitToUser(uid, 'group:update', shape(group)));
    res.json(shape(group));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server xatoligi' });
  }
});

// Guruh nomi/avatarini yangilash
router.patch('/:id', async (req, res) => {
  try {
    const { name, avatar } = req.body;
    const group = await Group.findOne(scoped({ _id: req.params.id }));
    if (!group) return res.status(404).json({ error: 'Guruh topilmadi' });
    if (name?.trim()) group.name = name.trim();
    if (avatar !== undefined) group.avatar = avatar;
    await group.save();
    group.memberIds.forEach(uid => emitToUser(uid, 'group:update', shape(group)));
    res.json(shape(group));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server xatoligi' });
  }
});

export default router;
