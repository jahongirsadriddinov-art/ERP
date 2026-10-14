// AI ovozli testlar uchun umumiy yordamchilar: xotiradagi MongoDB, indekslar, ikki firmali seed.
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import Company from '../../models/Company';
import Subscription from '../../models/Subscription';
import User from '../../models/User';
import ObjectModel from '../../models/Object';
import AiAssistantSettings from '../../models/AiAssistantSettings';
import AiChannelConnection from '../../models/AiChannelConnection';
import AiEmployeeContact from '../../models/AiEmployeeContact';
import AiCallSession from '../../models/AiCallSession';
import AiCallEvent from '../../models/AiCallEvent';
import AiAttendanceConfirmation from '../../models/AiAttendanceConfirmation';
import AiReminder from '../../models/AiReminder';
import AiActionAudit from '../../models/AiActionAudit';
import AiUsageMetrics from '../../models/AiUsageMetrics';
import AiJob from '../../models/AiJob';
import AiNonce from '../../models/AiNonce';
import AiRateCounter from '../../models/AiRateCounter';
import AiInstance from '../../models/AiInstance';

export const AI_MODELS = [
  AiAssistantSettings, AiChannelConnection, AiEmployeeContact, AiCallSession, AiCallEvent, AiAttendanceConfirmation,
  AiReminder, AiActionAudit, AiUsageMetrics, AiJob, AiNonce, AiRateCounter, AiInstance,
] as mongoose.Model<any>[];

export async function startMongo(): Promise<MongoMemoryServer> {
  const mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  // Unique/partial indekslar testdan OLDIN qurilgan bo'lishi shart
  await Promise.all(AI_MODELS.map((m) => m.init()));
  return mongo;
}

export async function stopMongo(mongo?: MongoMemoryServer): Promise<void> {
  await mongoose.disconnect();
  await mongo?.stop();
}

let phoneSeq = 100;
const nextPhone = () => `+998901${String(phoneSeq++).padStart(6, '0')}`;

export interface SeedCompany {
  companyId: string;
  ownerId: string;
  orinbosarId: string;
  prorabId: string;
  workerId: string;
  worker2Id: string;
  objectId: string;
}

/** Firma + ai_assistant funksiyali obuna + xodimlar + obyekt. */
export async function seedCompany(name: string, opts: { feature?: boolean; aiEnabled?: boolean } = {}): Promise<SeedCompany> {
  const c: any = await Company.create({ name, branchId: name.slice(0, 3).toUpperCase(), phone: nextPhone() } as any);
  const companyId = String(c._id);
  await Subscription.create({
    companyId, selectedPlan: 'custom',
    customFeatures: opts.feature === false ? ['gps'] : ['ai_assistant'], status: 'active',
  } as any);
  const mk = async (firstName: string, role: string, extra: Record<string, unknown> = {}) =>
    String(((await User.create({ firstName, phone: nextPhone(), role, companyId, baseSalary: 5_000_000, ...extra } as any)) as any)._id);
  const ownerId = await mk(`${name}-egasi`, 'direktor', { isOwner: true });
  const orinbosarId = await mk(`${name}-orinbosar`, 'orinbosar');
  const prorabId = await mk(`${name}-prorab`, 'prorab');
  const obj: any = await ObjectModel.create({ name: `${name} obyekt`, companyId, foremanId: prorabId } as any);
  const objectId = String(obj._id);
  const workerId = await mk(`${name}-ishchi`, 'ishchi', { projectIds: [objectId] });
  const worker2Id = await mk(`${name}-ishchi2`, 'ishchi', { projectIds: [objectId] });
  if (opts.aiEnabled !== false) await AiAssistantSettings.create({ companyId, enabled: true });
  return { companyId, ownerId, orinbosarId, prorabId, workerId, worker2Id, objectId };
}
