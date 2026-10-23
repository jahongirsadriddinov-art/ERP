import { call } from "../../api";

// AI ofis (owner 2026-10-22): /api/ai-voice/platform/office, /agents, /agent-tasks — faqat dasturchi.
export type OfficeKind = "tg" | "role" | "code" | "content";
export type OfficeActivity = "call" | "chat" | "task" | "review" | "idle";
export type TaskStatus = "queued" | "review" | "running" | "done" | "failed" | "cancelled";
export type Team = "lead" | "platform" | "apps" | "ai" | "ops" | "growth" | "assistants";
export const TEAMS: Team[] = ["lead", "platform", "apps", "ai", "ops", "growth", "assistants"];

export interface OfficeAgent {
  id: string; name: string; kind: OfficeKind; team: string; color: string; role?: string;
  busy: boolean; activity: OfficeActivity; since?: string; status?: string;
  task?: { id: string; status: TaskStatus; text: string; finishedAt?: string };
}
export interface AgentProfile { key: string; name: string; kind: string; team: string; description: string; systemPrompt: string; color: string; enabled: boolean; builtIn: boolean }
export interface SetupItem { key: string; ok: boolean | null; where: "backend" | "github"; required: boolean; for: "code" | "content" | "reporter" }
export interface Setup { codeReady: boolean; contentReady: boolean; items: SetupItem[] }
export interface PlanItem { agentKey: string; text: string; taskId?: string }
export interface AgentTask {
  id: string; agentKey: string; agentKind: "code" | "content"; text: string; status: TaskStatus; summary?: string; spec?: string;
  parentId?: string; spawnedKey?: string; plan: PlanItem[]; items: { title: string; text: string; hashtags?: string[] }[]; links: { label: string; url: string }[];
  log: { at: string; text: string }[]; error?: string; createdAt: string; startedAt?: string; finishedAt?: string;
}

export const officeApi = {
  office: () => call<{ agents: OfficeAgent[]; generatedAt: string }>("GET", "/platform/office"),
  agents: () => call<{ agents: AgentProfile[]; setup: Setup }>("GET", "/platform/agents"),
  createAgent: (b: { name: string; kind: "code" | "content"; description?: string; systemPrompt?: string; team?: string }) =>
    call<{ ok: true; agent: AgentProfile }>("POST", "/platform/agents", b),
  updateAgent: (key: string, b: Partial<Pick<AgentProfile, "name" | "description" | "systemPrompt" | "enabled" | "team" | "color">>) =>
    call<{ ok: true; agent: AgentProfile }>("PATCH", `/platform/agents/${encodeURIComponent(key)}`, b),
  tasks: (agentKey?: string, limit = 20) =>
    call<{ tasks: AgentTask[] }>("GET", `/platform/agent-tasks?limit=${limit}${agentKey ? `&agentKey=${encodeURIComponent(agentKey)}` : ""}`),
  createTask: (agentKey: string, text: string) => call<{ ok: true; task: AgentTask }>("POST", "/platform/agent-tasks", { agentKey, text }),
  cancel: (id: string) => call<{ ok: true; task: AgentTask }>("POST", `/platform/agent-tasks/${id}/cancel`, {}),
  retry: (id: string) => call<{ ok: true; task: AgentTask }>("POST", `/platform/agent-tasks/${id}/retry`, {}),
  approve: (id: string, b: { spec?: string; plan?: PlanItem[] }) => call<{ ok: true; task: AgentTask }>("POST", `/platform/agent-tasks/${id}/approve`, b),
  send: (id: string, target: "channel" | "developer", index?: number) =>
    call<{ ok: true }>("POST", `/platform/agent-tasks/${id}/send`, { target, ...(index !== undefined ? { index } : {}) }),
};
