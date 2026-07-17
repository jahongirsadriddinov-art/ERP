import mongoose, { Schema, Document } from 'mongoose';

// Atomik ketma-ketlik (sequence). branchId (BR-YYYY-NNNN) generatsiyasi uchun —
// bir vaqtda ikkita bir xil raqam berilmasligini kafolatlaydi (race-condition yo'q).
export interface ICounter extends Omit<Document, '_id'> {
  _id: string;   // masalan: "branch-2026"
  seq: number;
}

const CounterSchema: Schema = new Schema({
  _id: { type: String, required: true },
  seq: { type: Number, default: 0 }
});

const Counter = mongoose.model<ICounter>('Counter', CounterSchema);

// Keyingi raqamni atomik ravishda oladi.
export async function nextSequence(key: string): Promise<number> {
  const doc = await Counter.findByIdAndUpdate(
    key,
    { $inc: { seq: 1 } },
    { new: true, upsert: true }
  );
  return doc!.seq;
}

// branchId generatsiya qiladi: BR-2026-0001, BR-2026-0002, ...
export async function generateBranchId(year: number): Promise<string> {
  const seq = await nextSequence(`branch-${year}`);
  return `BR-${year}-${String(seq).padStart(4, '0')}`;
}

export default Counter;
