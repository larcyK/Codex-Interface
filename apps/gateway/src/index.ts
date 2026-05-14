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

  return { accessToken, expiresIn: 900 };
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
wss.on("connection", async (socket: WebSocket, req: IncomingMessage) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
  const token = url.searchParams.get("token");

  if (!token) {
    socket.close(1008, "missing token");
    return;
  }

  try {
    await verifyAccessToken(token);
    wsClients.add(socket);
    socket.send(
      JSON.stringify({
        event: "server.status",
        timestamp: new Date().toISOString(),
        payload: { status: "connected" },
      }),
    );
  } catch {
    socket.close(1008, "invalid token");
    return;
  }

  socket.on("close", () => {
    wsClients.delete(socket);
  });
});

const start = async () => {
  try {
    await app.listen({ host, port: httpPort });
    app.log.info(`gateway listening on http://${host}:${httpPort}`);
    app.log.info(`ws listening on ws://${host}:${wsPort}/ws`);
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
