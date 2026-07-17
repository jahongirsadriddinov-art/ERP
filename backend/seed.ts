import mongoose from 'mongoose';
import dotenv from 'dotenv';
import User from './src/models/User';

dotenv.config();

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/erp_firma';

async function seed() {
  await mongoose.connect(MONGODB_URI);
  console.log('Connected to DB');

  const adminPhone = '+998770160082';
  const existing = await User.findOne({ phone: adminPhone });
  if (!existing) {
    const admin = new User({
      firstName: 'Jahongir',
      lastName: 'Admin',
      phone: adminPhone,
      role: 'direktor'
    });
    await admin.save();
    console.log('Admin user created');
  } else {
    console.log('Admin user already exists');
  }

  await mongoose.disconnect();
}

seed();
