import { useEffect, useMemo, useState, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
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
  const [discovered, setDiscovered] = useState<Array<{ name: string; ip: string; wsUrl?: string }>>([]);
  const [modelInput, setModelInput] = useState("gpt-codex-local");
  const [promptInput, setPromptInput] = useState("Say hello to Codex");
  const [backendChoice, setBackendChoice] = useState<"mock" | "cli">("cli");
  const [streamOutput, setStreamOutput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamHistory, setStreamHistory] = useState<Array<{
    streamId: string;
    model: string;
    prompt: string;
    output: string;
    deviceId: string;
    createdAt: string;
  }>>([]);
  const [selectedStream, setSelectedStream] = useState<{
    streamId: string;
    model: string;
    prompt: string;
    output: string;
    deviceId: string;
    createdAt: string;
  } | null>(null);
  const wsRef = useMemo(() => ({ ws: null as WebSocket | null }), []);

  type ChatMessage = { id: string; role: "user" | "assistant"; text: string; status?: "streaming" | "done" | "error" };
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");

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

  // Proactively refresh access token before it expires (refresh 60s before exp)
  useEffect(() => {
    if (!token) return;
    let timeoutId: number | undefined;
    try {
      const parts = token.split(".");
      if (parts.length >= 2) {
        const payloadStr = parts[1].replace(/-/g, "+").replace(/_/g, "/");
        const decoded = atob(payloadStr);
        // decodeURIComponent/escape used to safely handle utf8
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const payload = JSON.parse(decodeURIComponent(escape(decoded)));
        const exp = payload?.exp as number | undefined;
        if (exp) {
          const now = Math.floor(Date.now() / 1000);
          const msUntilRefresh = (exp - now - 60) * 1000;
          if (msUntilRefresh <= 0) {
            // already near expiry -> refresh immediately
            void refreshAccessToken(token);
          } else {
            timeoutId = window.setTimeout(() => {
              void refreshAccessToken(token);
            }, msUntilRefresh);
          }
        }
      }
    } catch (e) {
      // ignore malformed token
    }
    return () => {
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [token, refreshToken, deviceId, host]);

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

  const fetchStreamHistory = async () => {
    const res = await api.get("/codex/history?limit=50", true);
    if (res?.items) {
      setStreamHistory(res.items);
    }
  };

  const loadStreamDetail = async (streamId: string) => {
    const res = await api.get(`/codex/history/${streamId}`, true);
    if (res && !res.error) {
      setSelectedStream(res);
    }
  };

  const startCodexStream = async () => {
    setStreamOutput("");
    setIsStreaming(true);
    const res = await api.post(
      "/codex/stream",
      { model: modelInput, prompt: promptInput, metadata: { backend: backendChoice } },
      true,
    );
    if (!res?.streamId || !res?.wsUrl) {
      setStreamOutput((s) => s + "\nFailed to start stream\n");
      setIsStreaming(false);
      return;
    }

    // replace placeholder token in wsUrl if present
    // Prefer token persisted in storage (may have been refreshed during API call)
    const stored = getTokens().accessToken || token;
    const wsUrl = res.wsUrl.replace("<token>", encodeURIComponent(stored || ""));
    try {
      setStreamOutput((s) => s + `\n[connecting to] ${wsUrl}\n[location] ${typeof window !== 'undefined' ? window.location.href : 'unknown'}\n`);
      const ws = new WebSocket(wsUrl);
      wsRef.ws = ws;
      ws.onopen = () => {
        setStreamOutput((s) => s + "\n[ws open]\n");
      };
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data);
          if (msg.type === "chunk") {
            setStreamOutput((s) => s + msg.text);
          } else if (msg.type === "done") {
            setStreamOutput((s) => s + "\n[done]\n");
            setIsStreaming(false);
            try { ws.close(); } catch (e) { /* ignore */ }
          } else if (msg.type === "error") {
            setStreamOutput((s) => s + `\n[error] ${msg.message}\n`);
            setIsStreaming(false);
          }
        } catch (e) {
          setStreamOutput((s) => s + `\n[raw] ${String(ev.data)}\n`);
        }
      };
      ws.onerror = (e) => {
        setStreamOutput((s) => s + `\n[ws error] ${String((e as any)?.message ?? e)}\n`);
        setIsStreaming(false);
      };
      ws.onclose = (ev) => {
        setIsStreaming(false);
        wsRef.ws = null;
        setStreamOutput((s) => s + `\n[ws closed] code=${ev.code} reason=${ev.reason}\n`);
      };
    } catch (e) {
      setStreamOutput((s) => s + `\n[connect failed] ${String(e)}\n`);
      setIsStreaming(false);
    }
  };

  const cancelCodexStream = () => {
    try {
      if (wsRef.ws && wsRef.ws.readyState === WebSocket.OPEN) {
        wsRef.ws.send(JSON.stringify({ type: "cancel" }));
      }
      wsRef.ws?.close();
    } catch (e) {
      // ignore
    }
    setIsStreaming(false);
  };

  const sendChatMessage = async () => {
    if (!chatInput.trim()) return;
    const userId = `m_${Date.now()}`;
    setMessages((m) => [...m, { id: userId, role: "user", text: chatInput }]);

    // start assistant placeholder
    const placeholderId = `assist_${Date.now()}`;
    setMessages((m) => [...m, { id: placeholderId, role: "assistant", text: "", status: "streaming" }]);

    // start stream
    const res = await api.post(
      "/codex/stream",
      { model: modelInput, prompt: chatInput, metadata: { backend: backendChoice } },
      true,
    );
    if (!res?.streamId || !res?.wsUrl) {
      setMessages((m) => m.map((mm) => (mm.id === placeholderId ? { ...mm, text: "Failed to start stream", status: "error" } : mm)));
      return;
    }

    const stored = getTokens().accessToken || token;
    const wsUrl = res.wsUrl.replace("<token>", encodeURIComponent(stored || ""));
    let ws: WebSocket | null = null;
    try {
      ws = new WebSocket(wsUrl);
      ws.onopen = () => {
        // no-op
      };
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data);
          if (msg.type === "chunk") {
            setMessages((m) => m.map((mm) => (mm.id === placeholderId ? { ...mm, text: mm.text + msg.text } : mm)));
          } else if (msg.type === "done") {
            setMessages((m) => m.map((mm) => (mm.id === placeholderId ? { ...mm, status: "done" } : mm)));
            try { ws?.close(); } catch (e) {}
          } else if (msg.type === "error") {
            setMessages((m) => m.map((mm) => (mm.id === placeholderId ? { ...mm, text: mm.text + `\n[error] ${msg.message}`, status: "error" } : mm)));
          }
        } catch (e) {
          setMessages((m) => m.map((mm) => (mm.id === placeholderId ? { ...mm, text: mm.text + `\n[raw] ${String(ev.data)}` } : mm)));
        }
      };
      ws.onerror = () => {
        setMessages((m) => m.map((mm) => (mm.id === placeholderId ? { ...mm, status: "error" } : mm)));
      };
      ws.onclose = () => {
        setMessages((m) => m.map((mm) => (mm.id === placeholderId && mm.status !== "done" ? { ...mm, status: "done" } : mm)));
      };
    } catch (e) {
      setMessages((m) => m.map((mm) => (mm.id === placeholderId ? { ...mm, text: "[connect failed] " + String(e), status: "error" } : mm)));
    }

    setChatInput("");
  };

  // Try simple LAN discovery by attempting common .local and hostnames.
  const discoverLan = async () => {
    const candidates = [
      // advertised default
      "codex-host.local",
      // try local hostname
      typeof window !== "undefined" ? `${window.location.hostname}` : "",
    ].filter(Boolean) as string[];

    const results: Array<{ name: string; ip: string; wsUrl?: string }> = [];
    await Promise.all(
      candidates.map(async (c) => {
        const url = `http://${c}:8000/api/v1/server/info`;
        try {
          const r = await fetch(url, { mode: "cors" });
          if (!r.ok) return;
          const data = await r.json();
          results.push({ name: data.name ?? c, ip: data.ip ?? c, wsUrl: data.wsUrl });
        } catch (e) {
          // ignore unreachable
        }
      }),
    );
    setDiscovered(results);
  };

  // Auto-reconnect WS when token changes
  const handleWsEvent = useCallback((eventData: string | unknown) => {
    const now = new Date().toISOString();
    const text = typeof eventData === "string" ? eventData : JSON.stringify(eventData);
    const msg = `${now} ${text}`;
    console.debug("WS event:", msg);
    setEvents((prev) => [msg, ...prev].slice(0, 200));
  }, [setEvents]);

  const wsConnected = useAutoReconnect(wsHost, token, handleWsEvent);

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
        <div className="row">
          <button onClick={discoverLan}>LAN上を発見</button>
        </div>
        {discovered.length > 0 && (
          <div>
            <h3>発見されたサーバ</h3>
            <ul>
              {discovered.map((d, i) => (
                <li key={i}>
                  {d.name} ({d.ip})
                  {d.wsUrl && <span> — {d.wsUrl}</span>}
                  <button onClick={() => {
                    setHost(`http://${d.ip}:8000`);
                    if (d.wsUrl) setWsHost(d.wsUrl);
                  }}>接続</button>
                </li>
              ))}
            </ul>
          </div>
        )}
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
        <div className="row">
          <button onClick={() => setEvents([])}>クリア</button>
        </div>
        <ul className="mono">
          {events.map((e, i) => (
            <li key={`${i}_${e.slice(0, 8)}`}>{e}</li>
          ))}
        </ul>
      </section>

      <section className="card">
        <h2>Codex ストリーミング</h2>
        <h3>チャット</h3>
        <div className="chat-area">
          {messages.map((m) => (
            <div key={m.id} className={`chat-message ${m.role === "user" ? "user" : "assistant"}`}>
              <div className="chat-meta"><strong>{m.role === "user" ? "You" : "Codex"}</strong> {m.status === "streaming" ? "(typing...)" : ""}</div>
              <div className="chat-bubble">
                <div className="chat-text">
                  {ReactMarkdown ? (
                    <ReactMarkdown remarkPlugins={remarkGfm ? [remarkGfm] : []}>{m.text}</ReactMarkdown>
                  ) : (
                    m.text
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
        <div className="row">
          <input style={{ flex: 1 }} value={chatInput} onChange={(e) => setChatInput(e.target.value)} placeholder="Type a message..." />
          <button onClick={sendChatMessage} disabled={!token || !chatInput.trim()}>Send</button>
        </div>
        <label>
          Model
          <input value={modelInput} onChange={(e) => setModelInput(e.target.value)} />
        </label>
        <label>
          Backend
          <select value={backendChoice} onChange={(e) => setBackendChoice(e.target.value as any)}>
            <option value="cli">cli</option>
            <option value="mock">mock</option>
          </select>
        </label>
        <label>
          Prompt
          <input value={promptInput} onChange={(e) => setPromptInput(e.target.value)} />
        </label>
        <div className="row">
          <button onClick={startCodexStream} disabled={isStreaming}>Start Stream</button>
          <button onClick={cancelCodexStream} disabled={!isStreaming}>Cancel</button>
        </div>
        <div style={{ maxHeight: 300, overflowY: "auto", overflowX: "auto", wordBreak: "break-word", overflowWrap: "anywhere", maxWidth: "100%" }}>
          {ReactMarkdown ? (
            <ReactMarkdown remarkPlugins={remarkGfm ? [remarkGfm] : []}>{streamOutput}</ReactMarkdown>
          ) : (
            <pre className="mono" style={{ whiteSpace: "pre-wrap" }}>{streamOutput}</pre>
          )}
        </div>
      </section>

      <section className="card">
        <h2>Codex ストリーム履歴</h2>
        <div className="row">
          <button onClick={fetchStreamHistory}>履歴を取得</button>
          <button onClick={() => setSelectedStream(null)}>クリア</button>
        </div>
        {streamHistory.length > 0 && (
          <div>
            <h3>過去のストリーム</h3>
            <ul>
              {streamHistory.map((s) => (
                <li key={s.streamId}>
                  <strong>{s.model}</strong> {new Date(s.createdAt).toLocaleString()}{" "}
                  <button onClick={() => loadStreamDetail(s.streamId)}>詳細</button>
                </li>
              ))}
            </ul>
          </div>
        )}
        {selectedStream && (
          <div className="card" style={{ marginTop: 16, backgroundColor: "#f5f5f5" }}>
            <h3>ストリーム詳細</h3>
            <p><strong>Model:</strong> {selectedStream.model}</p>
            <p><strong>Device:</strong> {selectedStream.deviceId}</p>
            <p><strong>Created:</strong> {new Date(selectedStream.createdAt).toLocaleString()}</p>
            <p><strong>Prompt:</strong></p>
            <div style={{ maxHeight: 150, overflowY: "auto", overflowX: "auto", wordBreak: "break-word", overflowWrap: "anywhere", maxWidth: "100%" }}>
              {ReactMarkdown ? (
                <ReactMarkdown remarkPlugins={remarkGfm ? [remarkGfm] : []}>{selectedStream.prompt}</ReactMarkdown>
              ) : (
                <pre className="mono" style={{ whiteSpace: "pre-wrap" }}>{selectedStream.prompt}</pre>
              )}
            </div>
            <p><strong>Output:</strong></p>
            <div style={{ maxHeight: 200, overflowY: "auto", overflowX: "auto", wordBreak: "break-word", overflowWrap: "anywhere", maxWidth: "100%" }}>
              {ReactMarkdown ? (
                <ReactMarkdown remarkPlugins={remarkGfm ? [remarkGfm] : []}>{selectedStream.output}</ReactMarkdown>
              ) : (
                <pre className="mono" style={{ whiteSpace: "pre-wrap" }}>{selectedStream.output}</pre>
              )}
            </div>
          </div>
        )}
      </section>
    </main>
  );
}
