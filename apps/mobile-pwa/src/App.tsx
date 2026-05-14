import { useEffect, useMemo, useState } from "react";
import { useAutoReconnect } from "./useAutoReconnect";
import { getTokens, saveTokens, clearTokens } from "./tokenStorage";

type LogItem = {
  id: string;
  timestamp: string;
  level: string;
  message: string;
};

const API_PREFIX = "/api/v1";

export default function App() {
  const [host, setHost] = useState(() => {
    const hostname = typeof window !== "undefined" ? window.location.hostname : "localhost";
    const protocol = typeof window !== "undefined" && window.location.protocol === "https:" ? "https:" : "http:";
    return `${protocol}//${hostname}:8000`;
  });
  const [wsHost, setWsHost] = useState(() => {
    const hostname = typeof window !== "undefined" ? window.location.hostname : "localhost";
    const protocol = typeof window !== "undefined" && window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${protocol}//${hostname}:8001/ws`;
  });
  const [deviceName, setDeviceName] = useState("mobile-pwa");
  const [pin, setPin] = useState("123456");
  const [token, setToken] = useState(() => getTokens().accessToken || "");
  const [refreshToken, setRefreshToken] = useState(() => getTokens().refreshToken || "");
  const [deviceId, setDeviceId] = useState(() => getTokens().deviceId || "");
  const [sessionId, setSessionId] = useState("");
  const [health, setHealth] = useState("未接続");
  const [command, setCommand] = useState("status");
  const [commandResult, setCommandResult] = useState("");
  const [logs, setLogs] = useState<LogItem[]>([]);
  const [events, setEvents] = useState<string[]>([]);

  const refreshAccessToken = async (
    currentToken: string,
  ): Promise<string | null> => {
    if (!refreshToken || !deviceId) {
      return null;
    }
    try {
      const r = await fetch(`${host}${API_PREFIX}/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken, deviceId }),
      });
      if (r.ok) {
        const data = (await r.json()) as Record<string, string>;
        const newToken = data.accessToken;
        setToken(newToken);
        saveTokens(newToken, refreshToken, deviceId);
        return newToken;
      }
    } catch {
      // ignore
    }
    return null;
  };

  const api = useMemo(
    () => ({
      get: async (path: string, auth = false) => {
        let currentToken = token;
        const r = await fetch(`${host}${API_PREFIX}${path}`, {
          headers: auth ? { Authorization: `Bearer ${currentToken}` } : undefined,
        });
        if (r.status === 401 && auth && refreshToken) {
          const newToken = await refreshAccessToken(currentToken);
          if (newToken) {
            currentToken = newToken;
            return fetch(`${host}${API_PREFIX}${path}`, {
              headers: { Authorization: `Bearer ${currentToken}` },
            }).then((r2) => r2.json());
          }
        }
        return r.json();
      },
      post: async (path: string, body: unknown, auth = false) => {
        let currentToken = token;
        const r = await fetch(`${host}${API_PREFIX}${path}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(auth ? { Authorization: `Bearer ${currentToken}` } : {}),
          },
          body: JSON.stringify(body),
        });
        if (r.status === 401 && auth && refreshToken) {
          const newToken = await refreshAccessToken(currentToken);
          if (newToken) {
            currentToken = newToken;
            return fetch(`${host}${API_PREFIX}${path}`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${currentToken}`,
              },
              body: JSON.stringify(body),
            }).then((r2) => r2.json());
          }
        }
        return r.json();
      },
      del: async (path: string) => {
        const r = await fetch(`${host}${API_PREFIX}${path}`, {
          method: "DELETE",
        });
        return r.json();
      },
    }),
    [host, token, refreshToken, deviceId],
  );

  const checkHealth = async () => {
    const res = await api.get("/health");
    setHealth(`${res.status} (${res.codex})`);
  };

  const login = async () => {
    const res = await api.post("/auth/pin", { pin, deviceName });
    if (res.accessToken) {
      const newDeviceId = res.deviceId || `dev_${Date.now()}`;
      setToken(res.accessToken);
      setRefreshToken(res.refreshToken);
      setDeviceId(newDeviceId);
      saveTokens(res.accessToken, res.refreshToken, newDeviceId);
      setCommandResult("認証成功");
    } else {
      setCommandResult("認証失敗");
    }
  };

  const startSession = async () => {
    const res = await api.post("/sessions", {}, true);
    if (res.sessionId) {
      setSessionId(res.sessionId);
      setCommandResult(`セッション開始: ${res.sessionId}`);
    }
  };

  const closeSession = async () => {
    await api.del("/sessions/current");
    setSessionId("");
  };

  const logout = () => {
    clearTokens();
    setToken("");
    setRefreshToken("");
    setDeviceId("");
    setSessionId("");
    setCommandResult("ログアウト");
  };

  const runCommand = async () => {
    if (!sessionId) {
      setCommandResult("先にセッションを開始してください");
      return;
    }
    const res = await api.post(
      "/commands",
      {
        sessionId,
        command,
        args: { verbose: true },
      },
      true,
    );
    setCommandResult(JSON.stringify(res));
  };

  const fetchLogs = async () => {
    const res = await api.get("/logs?limit=20");
    setLogs(res.items ?? []);
  };

  // Auto-reconnect WS when token changes
  const wsConnected = useAutoReconnect(wsHost, token, (eventData) => {
    setEvents((prev) => [eventData, ...prev].slice(0, 20));
  });

  return (
    <main className="app">
      <h1>Codex Interface Mobile</h1>
      <section className="card">
        <h2>接続設定</h2>
        <label>
          API Host
          <input value={host} onChange={(e) => setHost(e.target.value)} />
        </label>
        <label>
          WS URL
          <input value={wsHost} onChange={(e) => setWsHost(e.target.value)} />
        </label>
        <button onClick={checkHealth}>Health確認</button>
        <p>状態: {health}</p>
      </section>

      <section className="card">
        <h2>認証</h2>
        <label>
          Device Name
          <input value={deviceName} onChange={(e) => setDeviceName(e.target.value)} />
        </label>
        <label>
          PIN
          <input value={pin} onChange={(e) => setPin(e.target.value)} type="password" />
        </label>
        <div className="row">
          <button onClick={login}>PINログイン</button>
          <button onClick={logout}>ログアウト</button>
        </div>
        <p className="mono">Token: {token ? `${token.slice(0, 24)}...` : "未取得"}</p>
        <p className="mono">RefreshToken: {refreshToken ? "保存済" : "なし"}</p>
        <p className="mono">WS: {wsConnected ? "✓接続中" : "✗切断"}</p>
      </section>

      <section className="card">
        <h2>セッション/コマンド</h2>
        <div className="row">
          <button onClick={startSession}>セッション開始</button>
          <button onClick={closeSession}>セッション終了</button>
        </div>
        <p className="mono">Session: {sessionId || "なし"}</p>
        <label>
          Command
          <input value={command} onChange={(e) => setCommand(e.target.value)} />
        </label>
        <button onClick={runCommand}>実行</button>
        <p className="mono">結果: {commandResult}</p>
      </section>

      <section className="card">
        <h2>ログ</h2>
        <button onClick={fetchLogs}>最新取得</button>
        <ul>
          {logs.map((l) => (
            <li key={l.id}>
              {l.timestamp} [{l.level}] {l.message}
            </li>
          ))}
        </ul>
      </section>

      <section className="card">
        <h2>WSイベント</h2>
        <ul className="mono">
          {events.map((e, i) => (
            <li key={`${i}_${e.slice(0, 8)}`}>{e}</li>
          ))}
        </ul>
      </section>
    </main>
  );
}
