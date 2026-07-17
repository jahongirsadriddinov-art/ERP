/**
 * v1.2 MULTI-TENANT BACKFILL MIGRATION
 * ------------------------------------------------------------------
 * Bu skript MAVJUD ma'lumotni buzmaydi — faqat "Legacy" firma yaratadi
 * va barcha eski yozuvlarga o'sha firmaning companyId sini qo'yadi.
 *
 * ⚠️ ISHGA TUSHIRISHDAN OLDIN BACKUP OLING:
 *     mongodump --uri="mongodb://127.0.0.1:27017/erp_firma" --out=./backup-YYYYMMDD
 *
 * Ishga tushirish (backenddan):
 *     npx ts-node src/scripts/migrate-v12-multitenant.ts
 *
 * Skript IDEMPOTENT — bir necha marta yugurtirish xavfsiz (ikkinchi marta hech
 * narsani o'zgartirmaydi). companyId maydoni nullable bo'lib qoladi; NOT NULL
 * majburlash kod darajasida (tenant-scoping middleware) amalga oshiriladi.
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Company from '../models/Company';
import User from '../models/User';
import ObjectModel from '../models/Object';
import Material from '../models/Material';
import Transaction from '../models/Transaction';
import Message from '../models/Message';
import Group from '../models/Group';

dotenv.config();

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/erp_firma';
const LEGACY_BRANCH_ID = 'BR-0000';

async function run() {
  await mongoose.connect(MONGODB_URI);
  console.log('✓ MongoDB ga ulandi:', MONGODB_URI);

  // 1) Legacy firma bor-yo'qligini tekshir (idempotent)
  let legacy = await Company.findOne({ branchId: LEGACY_BRANCH_ID });

  if (!legacy) {
    // Firma egasini topamiz: birinchi direktor, bo'lmasa istalgan foydalanuvchi
    const owner =
      (await User.findOne({ role: 'direktor' })) ||
      (await User.findOne({ role: 'orinbosar' })) ||
      (await User.findOne({}));

    legacy = await Company.create({
      branchId: LEGACY_BRANCH_ID,
      name: 'QurilishERP',              // mavjud yagona firmaning nomi (kerak bo'lsa qo'lda o'zgartiring)
      phone: owner?.phone || '+998000000000',
      currency: 'UZS',
      status: 'ACTIVE',
      plan: 'FREE',
      ownerUserId: owner ? String(owner._id) : undefined
    });
    console.log('✓ Legacy firma yaratildi:', legacy.branchId, legacy._id);

    // Egasini owner qilib belgilaymiz
    if (owner) {
      owner.isOwner = true;
      (owner as any).companyId = String(legacy._id);
      await owner.save();
      console.log('✓ Firma egasi belgilandi:', owner.phone);
    }
  } else {
    console.log('• Legacy firma allaqachon mavjud:', legacy.branchId, legacy._id);
  }

  const companyId = String(legacy._id);

  // 2) Barcha kolleksiyalarda companyId yo'q yozuvlarni backfill qilamiz
  const collections: Array<[string, mongoose.Model<any>]> = [
    ['User', User],
    ['Object', ObjectModel],
    ['Material', Material],
    ['Transaction', Transaction],
    ['Message', Message],
    ['Group', Group],
  ];

  for (const [label, Model] of collections) {
    const res = await Model.updateMany(
      { $or: [{ companyId: { $exists: false } }, { companyId: null }, { companyId: '' }] },
      { $set: { companyId } }
    );
    console.log(`✓ ${label}: ${res.modifiedCount} ta yozuvga companyId qo'yildi`);
  }

  console.log('\n✅ Migration tugadi. Hech qanday eski ma\'lumot o\'chirilmadi.');
  await mongoose.disconnect();
  process.exit(0);
}

run().catch(async (err) => {
  console.error('❌ Migration xatosi:', err);
  await mongoose.disconnect();
  process.exit(1);
});
