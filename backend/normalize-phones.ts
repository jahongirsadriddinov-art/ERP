import mongoose from 'mongoose';
import dotenv from 'dotenv';
import User from './src/models/User';

dotenv.config();

const normalizePhones = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/construction_erp');
    console.log('Connected to MongoDB');

    const users = await User.find({});
    let updatedCount = 0;
    for (const user of users) {
      if (user.phone && user.phone.includes(' ')) {
        const oldPhone = user.phone;
        const newPhone = user.phone.replace(/\s+/g, '');
        user.phone = newPhone;
        await user.save();
        console.log(`Updated user ${user.firstName}: ${oldPhone} -> ${newPhone}`);
        updatedCount++;
      }
    }
    console.log(`Normalized ${updatedCount} phone numbers.`);
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await mongoose.disconnect();
    console.log('Disconnected from MongoDB');
  }
};

normalizePhones();
