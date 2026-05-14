export type SessionStatus = "active" | "closed" | "expired";
export type CommandStatus =
  | "accepted"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export interface Session {
  sessionId: string;
  deviceId: string;
  status: SessionStatus;
  createdAt: string;
  closedAt?: string;
}

export interface CommandRequest {
  requestId: string;
  sessionId: string;
  command: string;
  argsJson: Record<string, unknown>;
  status: CommandStatus;
  createdAt: string;
  completedAt?: string;
}

export interface LogEntry {
  id: string;
  timestamp: string;
  level: "debug" | "info" | "warn" | "error";
  category: "auth" | "session" | "command" | "system";
  message: string;
  requestId?: string;
}

export interface PersistedState {
  pinHash: string;
  refreshTokens: Record<string, string>;
  sessions: Session[];
  commands: CommandRequest[];
  logs: LogEntry[];
}
