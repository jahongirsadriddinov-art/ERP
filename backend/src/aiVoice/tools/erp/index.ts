// STUB (P1): yakuniy imzo. P2 shu yerda ERP tool'larini (getMyTasks, getMySchedule, …, optOut)
// registry.registerTool() orqali ro'yxatga oladi. bootstrap.startAiVoice() chaqiradi; P8 adminRoutes
// GET /tools ham chaqirishi mumkin — shuning uchun IDEMPOTENT bo'lishi shart (ikkinchi chaqiruv no-op).

let registered = false;

export function registerErpTools(): void {
  if (registered) return;
  registered = true;
  // P2 to'ldiradi: for (const def of ERP_TOOLS) registerTool(def);
}
