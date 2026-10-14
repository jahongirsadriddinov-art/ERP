import type { Server } from 'socket.io';
import { aiConfig } from '../config';

// Telegram qo'ng'iroq worker'i uchun "/aiv-worker" namespace (contracts.ts WORKER_EVENTS).
// services/socket.ts initSocket'da io yaratilgandan keyin registerAiWorkerNamespace(io) ni chaqiradi.
//
// STUB (P1): yakuniy imzolar. P6 to'ldiradi: faqat websocket, Ed25519 challenge-response
// (lib/workerAuth), fencing lease (lib/workerLease) va workerInstanceId yozish, RPC.
// Namespace hozircha YARATILMAYDI — ulanmoqchi bo'lgan mijoz "Invalid namespace" oladi (fail-closed).

export function registerAiWorkerNamespace(_io: Server): void {
  if (!aiConfig.enabled) return;
  // P6 to'ldiradi
}

/** Shu instansiyada autentifikatsiyadan o'tgan worker ulanganmi (JobQueue requires:'worker' filtri, C3). */
export function workerConnectedHere(): boolean {
  return false; // P6 to'ldiradi
}

/** SIGTERM drain: worker'ga lease.revoked yuborib namespace'ni yopadi (bootstrap chaqiradi). */
export async function closeWorkerNamespace(): Promise<void> {
  // P6 to'ldiradi
}
