import { io, Socket } from "socket.io-client";
import { API_BASE } from "./api";

let socket: Socket | null = null;

export function connectSocket(userId: string): Socket {
  if (socket) {
    if ((socket as any).io?.opts?.query?.userId === userId) return socket;
    socket.disconnect();
  }
  socket = io(API_BASE, {
    query: { userId },
    transports: ["websocket", "polling"],
    reconnection: true,
  });
  return socket;
}

export function getSocket(): Socket | null {
  return socket;
}

export function disconnectSocket() {
  socket?.disconnect();
  socket = null;
}
