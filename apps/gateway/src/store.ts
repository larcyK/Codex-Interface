import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { hashPin } from "./auth.js";
import type { CommandRequest, LogEntry, PersistedState, Session } from "./types.js";

const nowIso = () => new Date().toISOString();

export class JsonStore {
  private state: PersistedState;

  constructor(private readonly filePath: string) {
    const dir = dirname(filePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    if (existsSync(filePath)) {
      this.state = JSON.parse(readFileSync(filePath, "utf-8")) as PersistedState;
    } else {
      this.state = {
        pinHash: hashPin("123456"),
        refreshTokens: {},
        sessions: [],
        commands: [],
        logs: [],
      };
      this.persist();
    }
  }

  get pinHash(): string {
    return this.state.pinHash;
  }

  setPinHash(pinHash: string): void {
    this.state.pinHash = pinHash;
    this.persist();
  }

  setRefreshToken(deviceId: string, token: string): void {
    this.state.refreshTokens[deviceId] = token;
    this.persist();
  }

  getRefreshToken(deviceId: string): string | undefined {
    return this.state.refreshTokens[deviceId];
  }

  createSession(session: Session): void {
    this.state.sessions.push(session);
    this.persist();
  }

  updateSession(sessionId: string, patch: Partial<Session>): Session | undefined {
    const session = this.state.sessions.find((item) => item.sessionId === sessionId);
    if (!session) {
      return undefined;
    }
    Object.assign(session, patch);
    this.persist();
    return session;
  }

  getCurrentSession(): Session | undefined {
    return [...this.state.sessions].reverse().find((item) => item.status === "active");
  }

  putCommand(command: CommandRequest): void {
    this.state.commands.push(command);
    this.persist();
  }

  updateCommand(
    requestId: string,
    patch: Partial<CommandRequest>,
  ): CommandRequest | undefined {
    const cmd = this.state.commands.find((item) => item.requestId === requestId);
    if (!cmd) {
      return undefined;
    }
    Object.assign(cmd, patch);
    this.persist();
    return cmd;
  }

  addLog(log: Omit<LogEntry, "id" | "timestamp">): LogEntry {
    const entry: LogEntry = {
      id: `log_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      timestamp: nowIso(),
      ...log,
    };
    this.state.logs.push(entry);
    if (this.state.logs.length > 2000) {
      this.state.logs = this.state.logs.slice(-2000);
    }
    this.persist();
    return entry;
  }

  getLogs(cursor?: string, limit = 50): { items: LogEntry[]; nextCursor?: string } {
    const start = Number(cursor ?? "0");
    const sorted = [...this.state.logs].reverse();
    const items = sorted.slice(start, start + limit);
    const next = start + limit < sorted.length ? String(start + limit) : undefined;
    return { items, nextCursor: next };
  }

  private persist(): void {
    writeFileSync(this.filePath, JSON.stringify(this.state, null, 2));
  }
}
