import mongoose, { Schema, Document } from 'mongoose';

export interface AttendanceDoc extends Document {
  userId: string;
  companyId?: string;
  date: string; // YYYY-MM-DD
  checkIn?: string; // ISO timestamp
  checkOut?: string;
  lat?: number;
  lng?: number;
  checkOutLat?: number;
  checkOutLng?: number;
  note?: string;
  status: 'present' | 'late' | 'absent' | 'half';
  workHours?: number; // calculated on checkout
  biometricVerified?: boolean; // check-in vaqtida barmoq izi/Face ID tasdiqlangan (buddy-punching'ga qarshi)
}

const AttendanceSchema = new Schema<AttendanceDoc>({
  userId: { type: String, required: true },
  companyId: String,
  date: { type: String, required: true },
  checkIn: String,
  checkOut: String,
  lat: Number,
  lng: Number,
  checkOutLat: Number,
  checkOutLng: Number,
  note: String,
  status: { type: String, enum: ['present', 'late', 'absent', 'half'], default: 'present' },
  workHours: Number,
  biometricVerified: Boolean,
}, { timestamps: true });

AttendanceSchema.index({ userId: 1, date: 1 }, { unique: true });

export default mongoose.model<AttendanceDoc>('Attendance', AttendanceSchema);
