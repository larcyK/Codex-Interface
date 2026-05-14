import { randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import Fastify from "fastify";
import cors from "@fastify/cors";
import { WebSocketServer, type WebSocket } from "ws";
import { z } from "zod";
import {
  issueAccessToken,
  issueRefreshToken,
  verifyAccessToken,
  verifyPin,
} from "./auth.js";
import { getCodexAdapter, getCodexBackendName } from "./codex-adapter.js";
import { JsonStore } from "./store.js";
import { SqliteStore } from "./store-sqlite.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const useDb = process.env.USE_DB === "sqlite";
const storePath = useDb
  ? join(__dirname, "../data/codex.db")
  : join(__dirname, "../data/store.json");

const store = useDb
  ? (new SqliteStore(storePath) as any)
  : new JsonStore(storePath);

const httpPort = Number(process.env.HTTP_PORT ?? 8000);
const wsPort = Number(process.env.WS_PORT ?? 8001);
const host = process.env.HOST ?? "0.0.0.0";
const serverName = process.env.SERVER_NAME ?? "codex-host.local";

const app = Fastify({ logger: true });
await app.register(cors, { origin: true });
const codexAdapter = getCodexAdapter();
const codexBackend = getCodexBackendName();

const wsClients = new Set<WebSocket>();

const emitEvent = (event: string, payload: unknown) => {
  const data = JSON.stringify({
    event,
    timestamp: new Date().toISOString(),
    payload,
  });
  for (const client of wsClients) {
    if (client.readyState === client.OPEN) {
      client.send(data);
    }
  }
};

const authSchema = z.object({
  pin: z.string().min(4).max(12),
  deviceName: z.string().min(1).max(80),
});

const refreshSchema = z.object({
  refreshToken: z.string().min(6),
  deviceId: z.string().min(1),
});

const commandSchema = z.object({
  sessionId: z.string().min(1),
  command: z.string().min(1),
  args: z.record(z.unknown()).default({}),
});

app.get("/api/v1/health", async () => {
  return { status: "ok", version: "0.1.0", codex: "running" };
});

app.post("/api/v1/auth/pin", async (req, reply) => {
  const parsed = authSchema.safeParse(req.body);
  if (!parsed.success) {
    return reply.code(400).send({ error: { code: "INVALID_REQUEST", message: "Invalid payload" } });
  }

  const { pin, deviceName } = parsed.data;
  if (!verifyPin(pin, store.pinHash)) {
    store.addLog({ level: "warn", category: "auth", message: `PIN failed for ${deviceName}` });
    return reply.code(401).send({ error: { code: "UNAUTHORIZED", message: "PIN is invalid" } });
  }

  const deviceId = randomUUID();
  const accessToken = await issueAccessToken({ sub: deviceId, deviceName, scope: "exec" });
  const refreshToken = issueRefreshToken();
  store.setRefreshToken(deviceId, refreshToken);

  store.addLog({ level: "info", category: "auth", message: `PIN success for ${deviceName}` });

  return { accessToken, expiresIn: 900, refreshToken, deviceId };
});

app.post("/api/v1/auth/refresh", async (req, reply) => {
  const parsed = refreshSchema.safeParse(req.body);
  if (!parsed.success) {
    return reply.code(400).send({ error: { code: "INVALID_REQUEST", message: "Invalid payload" } });
  }

  const { deviceId, refreshToken } = parsed.data;
  const current = store.getRefreshToken(deviceId);
  if (!current || current !== refreshToken) {
    return reply.code(401).send({ error: { code: "UNAUTHORIZED", message: "Refresh token is invalid" } });
  }

  const accessToken = await issueAccessToken({
    sub: deviceId,
    deviceName: "mobile-client",
    scope: "exec",
  });
  // rotate refresh token: issue a new one and store it
  const newRefresh = issueRefreshToken();
  store.setRefreshToken(deviceId, newRefresh);
  store.addLog({ level: "info", category: "auth", message: `refresh rotated for ${deviceId}` });

  return { accessToken, expiresIn: 900, refreshToken: newRefresh };
});

app.post("/api/v1/auth/revoke", async (req, reply) => {
  const parsed = refreshSchema.safeParse(req.body);
  if (!parsed.success) {
    return reply.code(400).send({ error: { code: "INVALID_REQUEST", message: "Invalid payload" } });
  }
  const { deviceId, refreshToken } = parsed.data;
  const current = store.getRefreshToken(deviceId);
  if (!current || current !== refreshToken) {
    return reply.code(401).send({ error: { code: "UNAUTHORIZED", message: "Refresh token is invalid" } });
  }
  // revoke
  store.setRefreshToken(deviceId, "");
  store.addLog({ level: "info", category: "auth", message: `refresh token revoked for ${deviceId}` });
  return { revoked: true };
});

app.get("/api/v1/server/info", async () => {
  return {
    name: serverName,
    ip: "127.0.0.1",
    features: ["exec", "logs", "ws"],
    wsUrl: `ws://localhost:${wsPort}/ws`,
  };
});

app.get("/api/v1/sessions/current", async () => {
  return store.getCurrentSession() ?? null;
});

app.post("/api/v1/sessions", async (req, reply) => {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) {
    return reply.code(401).send({ error: { code: "UNAUTHORIZED", message: "Missing token" } });
  }

  try {
    const payload = await verifyAccessToken(auth.slice("Bearer ".length));
    const session = {
      sessionId: `sess_${randomUUID()}`,
      deviceId: payload.sub,
      status: "active" as const,
      createdAt: new Date().toISOString(),
    };
    store.createSession(session);
    store.addLog({ level: "info", category: "session", message: `session started ${session.sessionId}` });
    emitEvent("session.updated", session);
    return session;
  } catch {
    return reply.code(401).send({ error: { code: "UNAUTHORIZED", message: "Token invalid" } });
  }
});

app.delete("/api/v1/sessions/current", async () => {
  const current = store.getCurrentSession();
  if (!current) {
    return { closed: false };
  }
  const updated = store.updateSession(current.sessionId, {
    status: "closed",
    closedAt: new Date().toISOString(),
  });
  if (updated) {
    emitEvent("session.updated", updated);
  }
  return { closed: true };
});

app.post("/api/v1/commands", async (req, reply) => {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) {
    return reply.code(401).send({ error: { code: "UNAUTHORIZED", message: "Missing token" } });
  }
  try {
    await verifyAccessToken(auth.slice("Bearer ".length));
  } catch {
    return reply.code(401).send({ error: { code: "UNAUTHORIZED", message: "Token invalid" } });
  }

  const parsed = commandSchema.safeParse(req.body);
  if (!parsed.success) {
    return reply.code(400).send({ error: { code: "INVALID_REQUEST", message: "Invalid payload" } });
  }

  const { sessionId, command, args } = parsed.data;
  const requestId = `req_${randomUUID()}`;
  store.putCommand({
    requestId,
    sessionId,
    command,
    argsJson: args,
    status: "accepted",
    createdAt: new Date().toISOString(),
  });
  emitEvent("command.accepted", { requestId, sessionId, command, args });

  // Simulate codex streaming response for MVP.
  setTimeout(() => {
    const running = store.updateCommand(requestId, { status: "running" });
    if (!running) {
      return;
    }
    emitEvent("command.stdout", { requestId, chunk: `running ${command}...` });
  }, 300);

  setTimeout(() => {
    const completed = store.updateCommand(requestId, {
      status: "completed",
      completedAt: new Date().toISOString(),
    });
    if (!completed) {
      return;
    }
    store.addLog({
      level: "info",
      category: "command",
      message: `command completed: ${command}`,
      requestId,
    });
    emitEvent("command.completed", { requestId, result: "ok" });
  }, 1000);

  return { requestId, accepted: true };
});

app.post("/api/v1/commands/:requestId/cancel", async (req) => {
  const requestId = (req.params as { requestId: string }).requestId;
  const updated = store.updateCommand(requestId, {
    status: "cancelled",
    completedAt: new Date().toISOString(),
  });
  if (!updated) {
    return { cancelled: false };
  }
  emitEvent("command.failed", { requestId, reason: "cancelled" });
  return { cancelled: true };
});

app.get("/api/v1/logs", async (req) => {
  const query = req.query as { cursor?: string; limit?: string };
  const limit = Number(query.limit ?? "50");
  const res = store.getLogs(query.cursor, limit);
  return { items: res.items, nextCursor: res.nextCursor };
});

const wss = new WebSocketServer({ port: wsPort, path: "/ws" });
// map of pending stream requests created by /api/v1/codex/stream
const pendingStreams = new Map<string, { req: any; createdAt: number; socket?: WebSocket }>();
wss.on("connection", async (socket: WebSocket, req: IncomingMessage) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
  const token = url.searchParams.get("token");
  const streamId = url.searchParams.get("streamId");
  const remote = (req.socket && (req.socket as any).remoteAddress) || "unknown";
  app.log.info({ remote, tokenPresent: Boolean(token), streamId }, `ws connection attempt`);

  if (!token) {
    socket.close(1008, "missing token");
    return;
  }

  // log close and error for all sockets to aid debugging
  socket.on("close", (code: number, reason: Buffer) => {
    try {
      app.log.info({ remote, streamId, code, reason: reason ? reason.toString() : undefined }, "ws closed");
    } catch (e) {
      /* ignore logging errors */
    }
  });
  socket.on("error", (err: any) => {
    try {
      app.log.error({ remote, streamId, err }, "ws error");
    } catch (e) {
      /* ignore */
    }
  });

  // Verify token for all ws connections
  try {
    await verifyAccessToken(token);
  } catch {
    app.log.warn({ remote, token: token ? "present" : "missing" }, "ws token invalid or missing");
    socket.close(1008, "invalid token");
    return;
  }

  // Handle Codex streaming WS if streamId is present
  if (streamId) {
    app.log.info({ remote, streamId }, `ws/codex stream connection`);
    const pending = pendingStreams.get(streamId);
    if (!pending) {
      app.log.warn({ remote, streamId }, "ws/codex unknown streamId");
      socket.close(1008, "unknown streamId");
      return;
    }

    // Extract deviceId from token
    let deviceId = "unknown";
    try {
      const tokenPayload = await verifyAccessToken(token);
      deviceId = tokenPayload.sub;
    } catch (e) {
      app.log.warn({ streamId }, "Failed to extract deviceId from token");
    }

    const ee = codexAdapter.stream(pending.req);
    pending.socket = socket; // track socket for cleanup

    // Buffer chunks to collect complete output
    const outputChunks: string[] = [];

    const sendSafe = (obj: any) => {
      try {
        socket.send(JSON.stringify(obj));
      } catch (e) {
        app.log.warn({ streamId, err: e }, "ws send failed");
      }
    };

    const onData = (chunk: { seq: number; text: string }) => {
      outputChunks.push(chunk.text);
      sendSafe({ type: "chunk", seq: chunk.seq, text: chunk.text });
    };
    const onDone = (meta: any) => {
      sendSafe({ type: "done", id: meta.id });
      // Save stream to history
      const output = outputChunks.join("");
      store.addStreamLog({
        streamId,
        model: pending.req.model,
        prompt: pending.req.prompt,
        output,
        deviceId,
        tokens: pending.req.tokens,
      });
      try {
        socket.close(1000, "done");
      } catch (e) {
        /* ignore */
      }
    };
    const onError = (err: any) => {
      sendSafe({ type: "error", message: err?.message ?? String(err) });
      try {
        socket.close(1011, "error");
      } catch (e) {
        /* ignore */
      }
    };

    ee.on("data", onData);
    ee.on("done", onDone);
    ee.on("error", onError);

    socket.on("message", (m) => {
      try {
        const parsed = JSON.parse(String(m));
        if (parsed?.type === "cancel") {
          ee.emit("cancel");
        }
      } catch {
        // ignore
      }
    });

    socket.on("close", () => {
      ee.removeListener("data", onData);
      ee.removeListener("done", onDone);
      ee.removeListener("error", onError);
      pendingStreams.delete(streamId);
    });

    return;
  }

  // Handle regular server event WS
  if (!streamId) {
    wsClients.add(socket);
    socket.send(
      JSON.stringify({
        event: "server.status",
        timestamp: new Date().toISOString(),
        payload: { status: "connected" },
      }),
    );
    socket.on("close", () => {
      wsClients.delete(socket);
    });
    return;
  }
});

// Codex execute (sync)
const codexExecSchema = z.object({
  model: z.string().min(1),
  prompt: z.string().min(1),
  maxTokens: z.number().optional(),
  temperature: z.number().optional(),
  metadata: z.record(z.unknown()).optional(),
});

app.post("/api/v1/codex/execute", async (req, reply) => {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) {
    return reply.code(401).send({ error: { code: "UNAUTHORIZED", message: "Missing token" } });
  }
  try {
    await verifyAccessToken(auth.slice("Bearer ".length));
  } catch {
    return reply.code(401).send({ error: { code: "UNAUTHORIZED", message: "Token invalid" } });
  }

  const parsed = codexExecSchema.safeParse(req.body);
  if (!parsed.success) {
    return reply.code(400).send({ error: { code: "INVALID_REQUEST", message: "Invalid payload" } });
  }

  const { model, prompt } = parsed.data;
  try {
    const res = await codexAdapter.executeSync(parsed.data as any);
    store.addLog({ level: "info", category: "codex", message: `execute ${model}`, requestId: res.id });
    return { id: res.id, output: res.output };
  } catch (e: any) {
    const message = e?.message ?? "codex execute failed";
    store.addLog({ level: "error", category: "codex", message });
    return reply.code(502).send({ error: { code: "CODEX_EXEC_FAILED", message } });
  }
});

// Codex stream (start)
app.post("/api/v1/codex/stream", async (req, reply) => {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) {
    return reply.code(401).send({ error: { code: "UNAUTHORIZED", message: "Missing token" } });
  }
  try {
    await verifyAccessToken(auth.slice("Bearer ".length));
  } catch {
    return reply.code(401).send({ error: { code: "UNAUTHORIZED", message: "Token invalid" } });
  }

  const parsed = codexExecSchema.safeParse(req.body);
  if (!parsed.success) {
    return reply.code(400).send({ error: { code: "INVALID_REQUEST", message: "Invalid payload" } });
  }

  const streamId = `stream_${randomUUID()}`;
  pendingStreams.set(streamId, { req: parsed.data, createdAt: Date.now() });
  store.addLog({ level: "info", category: "codex", message: `stream started`, requestId: streamId });

  // Build a wsUrl using the request host so clients (on other devices) get a reachable address
  const hostHeader = String((req.headers as any).host ?? `localhost:${httpPort}`);
  const hostname = hostHeader.split(":")[0];
  const proto = ((req.headers as any)["x-forwarded-proto"] === "https") ? "wss" : "ws";
  const wsUrl = `${proto}://${hostname}:${wsPort}/ws?streamId=${streamId}&token=<token>`;

  return { streamId, wsUrl };
});

// Codex history (list)
app.get("/api/v1/codex/history", async (req, reply) => {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) {
    return reply.code(401).send({ error: { code: "UNAUTHORIZED", message: "Missing token" } });
  }
  try {
    await verifyAccessToken(auth.slice("Bearer ".length));
  } catch {
    return reply.code(401).send({ error: { code: "UNAUTHORIZED", message: "Token invalid" } });
  }

  const query = req.query as Record<string, any>;
  const limit = Math.min(Number(query.limit ?? "50"), 100);
  const offset = Number(query.offset ?? "0");

  const result = store.getStreamHistory(limit, offset);
  return result;
});

// Codex history (detail)
app.get("/api/v1/codex/history/:streamId", async (req, reply) => {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) {
    return reply.code(401).send({ error: { code: "UNAUTHORIZED", message: "Missing token" } });
  }
  try {
    await verifyAccessToken(auth.slice("Bearer ".length));
  } catch {
    return reply.code(401).send({ error: { code: "UNAUTHORIZED", message: "Token invalid" } });
  }

  const { streamId } = req.params as Record<string, string>;
  const result = store.getStreamDetail(streamId);

  if (!result) {
    return reply.code(404).send({ error: { code: "NOT_FOUND", message: "Stream not found" } });
  }

  return result;
});

const start = async () => {
  try {
    await app.listen({ host, port: httpPort });
    app.log.info(`gateway listening on http://${host}:${httpPort}`);
    app.log.info(`ws listening on ws://${host}:${wsPort}/ws`);
    app.log.info({ codexBackend }, "codex adapter backend selected");
    // Try to advertise via mDNS (bonjour) for LAN discovery. Optional dependency.
    try {
      const bonjourModule = await import("bonjour");
      const bonjour = bonjourModule.default ?? bonjourModule;
      const service = bonjour.publish({
        name: serverName,
        type: "codexif",
        protocol: "tcp",
        port: httpPort,
        txt: { wsPort: String(wsPort), features: "exec,logs,ws" },
      });
      app.log.info(`mDNS: advertised service ${serverName} (_codexif._tcp)`);
      // Unpublish on exit
      const cleanup = () => {
        try {
          service.stop();
          bonjour.destroy();
        } catch (e) {
          /* ignore */
        }
      };
      process.on("exit", cleanup);
      process.on("SIGINT", () => {
        cleanup();
        process.exit(0);
      });
    } catch (e) {
      app.log.warn("mDNS advertise not available (bonjour not installed)");
    }
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
};

await start();
