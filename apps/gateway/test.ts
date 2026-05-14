import { test } from "node:test";
import { strict as assert } from "node:assert";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, "..");

const API_URL = "http://localhost:8000/api/v1";
const WS_URL = "ws://localhost:8001/ws";

let serverProcess: any;

// Start server before tests
async function startServer() {
  return new Promise((resolve, reject) => {
    serverProcess = spawn("node", ["dist/index.js"], {
      cwd: projectRoot,
      stdio: ["ignore", "ignore", "ignore"],
    });
    serverProcess.on("error", reject);
    setTimeout(() => resolve(null), 1000); // Wait for startup
  });
}

// Stop server after tests
function stopServer() {
  if (serverProcess) {
    serverProcess.kill();
  }
}

test("Gateway Health API", async (t) => {
  await t.test("GET /health returns ok status", async () => {
    const res = await fetch(`${API_URL}/health`);
    const data = (await res.json()) as Record<string, string>;
    assert.equal(data.status, "ok");
    assert.equal(data.codex, "running");
  });
});

test("Authentication Flow", async (t) => {
  await t.test("POST /auth/pin with correct PIN succeeds", async () => {
    const res = await fetch(`${API_URL}/auth/pin`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pin: "123456", deviceName: "test-device" }),
    });
    assert.equal(res.status, 200);
    const data = (await res.json()) as Record<string, unknown>;
    assert(data.accessToken);
    assert(data.refreshToken);
    assert.equal(data.expiresIn, 900);
  });

  await t.test("POST /auth/pin with wrong PIN fails", async () => {
    const res = await fetch(`${API_URL}/auth/pin`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pin: "000000", deviceName: "bad-device" }),
    });
    assert.equal(res.status, 401);
  });

  await t.test("POST /auth/refresh renews access token", async () => {
    // Get initial token and refresh token
    const authRes = await fetch(`${API_URL}/auth/pin`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pin: "123456", deviceName: "refresh-test" }),
    });
    const authData = (await authRes.json()) as Record<string, string>;
    const refreshToken = authData.refreshToken;
    const deviceId = authData.deviceId || "test-device";

    // Use refresh token to get new access token
    const refreshRes = await fetch(`${API_URL}/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken, deviceId }),
    });
    assert.equal(refreshRes.status, 200);
    const refreshData = (await refreshRes.json()) as Record<string, string>;
    assert(refreshData.accessToken);
    assert(refreshData.accessToken !== authData.accessToken);
  });
});

test("Session Management", async (t) => {
  let token = "";

  await t.test("Get access token", async () => {
    const res = await fetch(`${API_URL}/auth/pin`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pin: "123456", deviceName: "session-test" }),
    });
    const data = (await res.json()) as Record<string, string>;
    token = data.accessToken;
    assert(token);
  });

  await t.test("POST /sessions creates session", async () => {
    const res = await fetch(`${API_URL}/sessions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(res.status, 200);
    const data = (await res.json()) as Record<string, string>;
    assert(data.sessionId);
    assert.equal(data.status, "active");
  });

  await t.test("GET /sessions/current returns active session", async () => {
    const res = await fetch(`${API_URL}/sessions/current`);
    const data = (await res.json()) as Record<string, string>;
    assert(data.sessionId);
  });
});

test("Command Execution", async (t) => {
  let token = "";
  let sessionId = "";

  await t.test("Setup: get token and session", async () => {
    const authRes = await fetch(`${API_URL}/auth/pin`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pin: "123456", deviceName: "cmd-test" }),
    });
    const authData = (await authRes.json()) as Record<string, string>;
    token = authData.accessToken;

    const sessRes = await fetch(`${API_URL}/sessions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    const sessData = (await sessRes.json()) as Record<string, string>;
    sessionId = sessData.sessionId;
    assert(sessionId);
  });

  await t.test("POST /commands accepts command", async () => {
    const res = await fetch(`${API_URL}/commands`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        sessionId,
        command: "test-cmd",
        args: {},
      }),
    });
    assert.equal(res.status, 200);
    const data = (await res.json()) as Record<string, unknown>;
    assert(data.requestId);
    assert.equal(data.accepted, true);
  });
});

test("Logs API", async (t) => {
  await t.test("GET /logs returns log list", async () => {
    const res = await fetch(`${API_URL}/logs?limit=10`);
    assert.equal(res.status, 200);
    const data = (await res.json()) as Record<string, unknown>;
    assert(Array.isArray(data.items));
  });
});

// Run tests
(async () => {
  try {
    await startServer();
    console.log("Server started");
  } catch (err) {
    console.error("Failed to start server:", err);
    process.exit(1);
  }
})().finally(() => {
  setTimeout(() => {
    stopServer();
    process.exit(0);
  }, 2000);
});
