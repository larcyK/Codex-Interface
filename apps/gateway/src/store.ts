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
        codexStreams: [],
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

  getSession(sessionId: string): Session | undefined {
    return this.state.sessions.find((item) => item.sessionId === sessionId);
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

  // Codex stream history (for JsonStore-backed mode)
  addStreamLog(stream: {
    streamId: string;
    model: string;
    prompt: string;
    output: string;
    deviceId: string;
    tokens?: Record<string, number>;
    createdAt?: string;
  }): void {
    const entry = {
      streamId: stream.streamId,
      model: stream.model,
      prompt: stream.prompt,
      output: stream.output,
      deviceId: stream.deviceId,
      tokens: stream.tokens ?? undefined,
      createdAt: stream.createdAt ?? nowIso(),
    };
    if (!this.state.codexStreams) this.state.codexStreams = [];
    this.state.codexStreams.push(entry);
    // keep recent 1000
    if (this.state.codexStreams.length > 1000) {
      this.state.codexStreams = this.state.codexStreams.slice(-1000);
    }
    this.persist();
  }

  getStreamHistory(limit = 50, offset = 0): { items: any[]; total: number } {
    const arr = this.state.codexStreams ? [...this.state.codexStreams].reverse() : [];
    const items = arr.slice(offset, offset + limit);
    return { items, total: arr.length };
  }

  getStreamDetail(streamId: string) {
    if (!this.state.codexStreams) return null;
    return this.state.codexStreams.find((s) => s.streamId === streamId) ?? null;
  }

  private persist(): void {
    writeFileSync(this.filePath, JSON.stringify(this.state, null, 2));
  }
}
