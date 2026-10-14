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
];

let registered = false;

export function registerErpTools(): void {
  if (registered) return;
  registered = true;
  for (const def of ERP_TOOLS) if (!hasTool(def.name)) registerTool(def);
}
