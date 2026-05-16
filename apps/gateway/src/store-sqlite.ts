import Database from "better-sqlite3";
import { hashPin } from "./auth.js";
import type { CommandRequest, LogEntry, Session } from "./types.js";

const nowIso = () => new Date().toISOString();

export class SqliteStore {
  private db: Database.Database;

  constructor(private readonly filePath: string) {
    this.db = new Database(filePath);
    this.db.pragma("journal_mode = WAL");
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS config (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS sessions (
        sessionId TEXT PRIMARY KEY,
        deviceId TEXT NOT NULL,
        status TEXT NOT NULL,
        createdAt TEXT NOT NULL,
        closedAt TEXT,
        codexSessionId TEXT
      );

      CREATE TABLE IF NOT EXISTS commands (
        requestId TEXT PRIMARY KEY,
        sessionId TEXT NOT NULL,
        command TEXT NOT NULL,
        argsJson TEXT NOT NULL,
        status TEXT NOT NULL,
        createdAt TEXT NOT NULL,
        completedAt TEXT
      );

      CREATE TABLE IF NOT EXISTS logs (
        id TEXT PRIMARY KEY,
        timestamp TEXT NOT NULL,
        level TEXT NOT NULL,
        category TEXT NOT NULL,
        message TEXT NOT NULL,
        requestId TEXT
      );

      CREATE TABLE IF NOT EXISTS codex_streams (
        streamId TEXT PRIMARY KEY,
        model TEXT NOT NULL,
        prompt TEXT NOT NULL,
        output TEXT NOT NULL,
        deviceId TEXT NOT NULL,
        tokensJson TEXT,
        createdAt TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_logs_timestamp ON logs(timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);
      CREATE INDEX IF NOT EXISTS idx_commands_sessionId ON commands(sessionId);
      CREATE INDEX IF NOT EXISTS idx_codex_streams_createdAt ON codex_streams(createdAt DESC);
      CREATE INDEX IF NOT EXISTS idx_codex_streams_deviceId ON codex_streams(deviceId);
    `);

    // Initialize pinHash if not exists
    const existing = this.db
      .prepare("SELECT value FROM config WHERE key = ?")
      .get("pinHash");
    if (!existing) {
      this.db
        .prepare("INSERT INTO config (key, value) VALUES (?, ?)")
        .run("pinHash", hashPin("123456"));
    }

    const sessionColumns = this.db.prepare("PRAGMA table_info(sessions)").all() as Array<{ name: string }>;
    if (!sessionColumns.some((column) => column.name === "codexSessionId")) {
      this.db.exec("ALTER TABLE sessions ADD COLUMN codexSessionId TEXT");
    }
  }

  get pinHash(): string {
    const row = this.db
      .prepare("SELECT value FROM config WHERE key = ?")
      .get("pinHash") as Record<string, string> | undefined;
    return row?.value || hashPin("123456");
  }

  setPinHash(pinHash: string): void {
    this.db
      .prepare("INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)")
      .run("pinHash", pinHash);
  }

  setRefreshToken(deviceId: string, token: string): void {
    this.db
      .prepare("INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)")
      .run(`refreshToken:${deviceId}`, token);
  }

  getRefreshToken(deviceId: string): string | undefined {
    const row = this.db
      .prepare("SELECT value FROM config WHERE key = ?")
      .get(`refreshToken:${deviceId}`) as Record<string, string> | undefined;
    return row?.value;
  }

  createSession(session: Session): void {
    this.db
      .prepare(
        "INSERT INTO sessions (sessionId, deviceId, status, createdAt, codexSessionId) VALUES (?, ?, ?, ?, ?)",
      )
      .run(session.sessionId, session.deviceId, session.status, session.createdAt, session.codexSessionId ?? null);
  }

  updateSession(sessionId: string, patch: Partial<Session>): Session | undefined {
    const current = this.db
      .prepare("SELECT * FROM sessions WHERE sessionId = ?")
      .get(sessionId) as Session | undefined;

    if (!current) {
      return undefined;
    }

    const updated = { ...current, ...patch };
    const fields = [];
    const values = [];

    for (const [key, value] of Object.entries(patch)) {
      if (key !== "sessionId") {
        fields.push(`${key} = ?`);
        values.push(value);
      }
    }

    if (fields.length > 0) {
      values.push(sessionId);
      this.db.prepare(`UPDATE sessions SET ${fields.join(", ")} WHERE sessionId = ?`).run(...values);
    }

    return updated;
  }

  getCurrentSession(): Session | undefined {
    return this.db
      .prepare("SELECT * FROM sessions WHERE status = ? ORDER BY createdAt DESC LIMIT 1")
      .get("active") as Session | undefined;
  }

  getSession(sessionId: string): Session | undefined {
    return this.db
      .prepare("SELECT * FROM sessions WHERE sessionId = ?")
      .get(sessionId) as Session | undefined;
  }

  putCommand(command: CommandRequest): void {
    this.db
      .prepare(
        "INSERT INTO commands (requestId, sessionId, command, argsJson, status, createdAt) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(
        command.requestId,
        command.sessionId,
        command.command,
        JSON.stringify(command.argsJson),
        command.status,
        command.createdAt,
      );
  }

  updateCommand(requestId: string, patch: Partial<CommandRequest>): CommandRequest | undefined {
    const current = this.db
      .prepare("SELECT * FROM commands WHERE requestId = ?")
      .get(requestId) as Record<string, unknown> | undefined;

    if (!current) {
      return undefined;
    }

    const updated: CommandRequest = {
      requestId: String(current.requestId),
      sessionId: String(current.sessionId),
      command: String(current.command),
      argsJson: JSON.parse(String(current.argsJson)),
      status: String(current.status) as any,
      createdAt: String(current.createdAt),
      ...patch,
    };

    const fields = [];
    const values = [];

    for (const [key, value] of Object.entries(patch)) {
      if (key !== "requestId" && key !== "argsJson") {
        fields.push(`${key} = ?`);
        values.push(value);
      } else if (key === "argsJson") {
        fields.push("argsJson = ?");
        values.push(JSON.stringify(value));
      }
    }

    if (fields.length > 0) {
      values.push(requestId);
      this.db.prepare(`UPDATE commands SET ${fields.join(", ")} WHERE requestId = ?`).run(...values);
    }

    return updated;
  }

  addLog(log: Omit<LogEntry, "id" | "timestamp">): LogEntry {
    const entry: LogEntry = {
      id: `log_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      timestamp: nowIso(),
      ...log,
    };

    this.db
      .prepare(
        "INSERT INTO logs (id, timestamp, level, category, message, requestId) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(entry.id, entry.timestamp, entry.level, entry.category, entry.message, entry.requestId);

    // Cleanup old logs if too many
    const count = this.db
      .prepare("SELECT COUNT(*) as cnt FROM logs")
      .get() as Record<string, number>;
    if (count.cnt > 2000) {
      this.db
        .prepare("DELETE FROM logs WHERE id NOT IN (SELECT id FROM logs ORDER BY timestamp DESC LIMIT 2000)")
        .run();
    }

    return entry;
  }

  getLogs(
    cursor?: string,
    limit = 50,
  ): { items: LogEntry[]; nextCursor?: string } {
    const start = Number(cursor ?? "0");
    const rows = this.db
      .prepare("SELECT * FROM logs ORDER BY timestamp DESC LIMIT ? OFFSET ?")
      .all(limit + 1, start) as LogEntry[];

    const items = rows.slice(0, limit);
    const next = rows.length > limit ? String(start + limit) : undefined;

    return { items, nextCursor: next };
  }

  close(): void {
    this.db.close();
  }

  addStreamLog(streamLog: Omit<Record<string, any>, "createdAt"> & { createdAt?: string }): void {
    const createdAt = streamLog.createdAt || nowIso();
    this.db
      .prepare(
        "INSERT INTO codex_streams (streamId, model, prompt, output, deviceId, tokensJson, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        streamLog.streamId,
        streamLog.model,
        streamLog.prompt,
        streamLog.output,
        streamLog.deviceId,
        streamLog.tokens ? JSON.stringify(streamLog.tokens) : null,
        createdAt,
      );
  }

  getStreamHistory(limit = 50, offset = 0): {
    items: Array<{
      streamId: string;
      model: string;
      prompt: string;
      output: string;
      deviceId: string;
      tokens?: Record<string, number>;
      createdAt: string;
    }>;
    total: number;
  } {
    const rows = this.db
      .prepare("SELECT * FROM codex_streams ORDER BY createdAt DESC LIMIT ? OFFSET ?")
      .all(limit, offset) as Array<any>;

    const total = this.db
      .prepare("SELECT COUNT(*) as cnt FROM codex_streams")
      .get() as Record<string, number>;

    return {
      items: rows.map((r) => ({
        streamId: r.streamId,
        model: r.model,
        prompt: r.prompt,
        output: r.output,
        deviceId: r.deviceId,
        tokens: r.tokensJson ? JSON.parse(r.tokensJson) : undefined,
        createdAt: r.createdAt,
      })),
      total: total.cnt,
    };
  }

  getStreamDetail(streamId: string): {
    streamId: string;
    model: string;
    prompt: string;
    output: string;
    deviceId: string;
    tokens?: Record<string, number>;
    createdAt: string;
  } | null {
    const row = this.db
      .prepare("SELECT * FROM codex_streams WHERE streamId = ?")
      .get(streamId) as Record<string, any> | undefined;

    if (!row) {
      return null;
    }

    return {
      streamId: row.streamId,
      model: row.model,
      prompt: row.prompt,
      output: row.output,
      deviceId: row.deviceId,
      tokens: row.tokensJson ? JSON.parse(row.tokensJson) : undefined,
      createdAt: row.createdAt,
    };
  }
}
