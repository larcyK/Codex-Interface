import { useMemo, useState } from "react";

type LogItem = {
  id: string;
  timestamp: string;
  level: string;
  message: string;
};

const API_PREFIX = "/api/v1";

export default function App() {
  const [host, setHost] = useState("http://localhost:8000");
  const [wsHost, setWsHost] = useState("ws://localhost:8001/ws");
  const [deviceName, setDeviceName] = useState("mobile-pwa");
  const [pin, setPin] = useState("123456");
  const [token, setToken] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [health, setHealth] = useState("未接続");
  const [command, setCommand] = useState("status");
  const [commandResult, setCommandResult] = useState("");
  const [logs, setLogs] = useState<LogItem[]>([]);
  const [events, setEvents] = useState<string[]>([]);

  const api = useMemo(
    () => ({
      get: async (path: string, auth = false) => {
        const r = await fetch(`${host}${API_PREFIX}${path}`, {
          headers: auth ? { Authorization: `Bearer ${token}` } : undefined,
        });
        return r.json();
      },
      post: async (path: string, body: unknown, auth = false) => {
        const r = await fetch(`${host}${API_PREFIX}${path}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(auth ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify(body),
        });
        return r.json();
      },
      del: async (path: string) => {
        const r = await fetch(`${host}${API_PREFIX}${path}`, {
          method: "DELETE",
        });
        return r.json();
      },
    }),
    [host, token],
  );

  const checkHealth = async () => {
    const res = await api.get("/health");
    setHealth(`${res.status} (${res.codex})`);
  };

  const login = async () => {
    const res = await api.post("/auth/pin", { pin, deviceName });
    if (res.accessToken) {
      setToken(res.accessToken);
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

  const connectWs = () => {
    if (!token) {
      setCommandResult("先に認証してください");
      return;
    }
    const ws = new WebSocket(`${wsHost}?token=${encodeURIComponent(token)}`);
    ws.onmessage = (event) => {
      setEvents((prev) => [event.data, ...prev].slice(0, 20));
    };
    ws.onopen = () => setCommandResult("WebSocket接続完了");
    ws.onerror = () => setCommandResult("WebSocket接続エラー");
  };

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
        <button onClick={login}>PINログイン</button>
        <button onClick={connectWs}>WS接続</button>
        <p className="mono">Token: {token ? `${token.slice(0, 24)}...` : "未取得"}</p>
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
