import { hasTool, registerTool } from '../registry';
import type { AiToolDef } from '../types';
import { getMyTasks } from './getMyTasks';
import { getMySchedule } from './getMySchedule';
import { getProjectSummary } from './getProjectSummary';
import { getInventoryBalance } from './getInventoryBalance';
import { getAttendanceSummary } from './getAttendanceSummary';
import { REMINDER_TOOLS } from './reminders';
import { getAllowedFinancialReport } from './getAllowedFinancialReport';
import { notifyManager } from './notifyManager';
import { getEmployeeProfile } from './getEmployeeProfile';
import { DECISION_TOOLS } from './transactionDecisions';
import { listExpenses } from './listExpenses';
import { getObjectDetails } from './getObjectDetails';
import { listEmployees } from './listEmployees';
import { getTodayOverview } from './getTodayOverview';
import { ensureCallbackJob, requestCallback } from './requestCallback';
import { getSharedQueue } from '../../queue/jobQueue';
import { getWeather } from '../general/getWeather';
import { GENERAL_CALL_TOOLS } from '../general/callControl';
import { KNOWLEDGE_TOOLS } from '../general/knowledge';
import { CONTACT_TOOLS, ensureRelayJob } from './contactEmployee';
import { CAMERA_TOOLS } from '../general/camera';

// P2: ERP tool'lari registry.registerTool() orqali ro'yxatga olinadi. bootstrap.startAiVoice() va
// P8 adminRoutes GET /tools chaqiradi — IDEMPOTENT (ikkinchi chaqiruv no-op; testlar oldindan
// ro'yxatga olgan bo'lsa ham xato bermaydi). Tartib DETERMINISTIK (prompt keshi uchun muhim).

export const ERP_TOOLS: AiToolDef[] = [
  getMyTasks,
  getMySchedule,
  getProjectSummary,
  getInventoryBalance,
  getAttendanceSummary,
  ...REMINDER_TOOLS,
  getAllowedFinancialReport,
  notifyManager,
  getEmployeeProfile,
  // 2026-10-16 (owner: "AI hamma narsani bilsin, tasdiqla desam tasdiqlasin, qo'ng'iroq qilsin")
  getTodayOverview,
  getObjectDetails,
  listEmployees,
  listExpenses,
  ...DECISION_TOOLS,
  requestCallback,
  // 2026-10-17 (owner: umumiy savollar, "telefonni o'chir", ovozli tasdiq)
  getWeather,
  ...GENERAL_CALL_TOOLS,
  // 2026-10-18 (owner: "dollar kursi", "internetdan izla" — hamma narsani bilsin)
  ...KNOWLEDGE_TOOLS,
  // 2026-10-18 (owner: "Testga ayt menga aloqaga chiqsin" — aniq xodimga xabar/qo'ng'iroq)
  ...CONTACT_TOOLS,
  // 2026-10-18 (owner: kamera — "rasmga ol", "videoga ol", "rahbarga yubor")
  ...CAMERA_TOOLS,
];

let registered = false;

export function registerErpTools(): void {
  // bootstrap navbatni shu chaqiruvdan keyin (sinxron) o'rnatadi — 'ai.callback' ishlovchisi keyingi tikda
  // ulanadi, shunda qayta ishga tushgandan keyin ham navbatdagi qo'ng'iroqlar bajariladi. Har chaqiruvda
  // (idempotent): tool'lar oldinroq (masalan, admin GET /tools) ro'yxatga olingan bo'lsa ham navbat ulanadi.
  setImmediate(() => { ensureCallbackJob(getSharedQueue()); ensureRelayJob(getSharedQueue()); });
  if (registered) return;
  registered = true;
  for (const def of ERP_TOOLS) if (!hasTool(def.name)) registerTool(def);
}
