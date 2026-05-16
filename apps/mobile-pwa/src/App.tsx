import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "@xterm/xterm/css/xterm.css";
import { useAutoReconnect } from "./useAutoReconnect";
import { clearTokens, getTokens, saveTokens } from "./tokenStorage";
import { buildTerminalBlocks } from "./terminalTranscript";
import { useXtermTerminal } from "./useXtermTerminal";
import { CodexTerminalSection } from "./CodexTerminalSection";
import { FileBrowserSection } from "./FileBrowserSection";

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
  const [modelInput, setModelInput] = useState("gpt-5.4");
  const [promptInput, setPromptInput] = useState("Say hello to Codex");
  const [backendChoice, setBackendChoice] = useState<"mock" | "cli">("cli");
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
  const [chatInput, setChatInput] = useState("");
  const [terminalStatus, setTerminalStatus] = useState("ready");
  const [terminalView, setTerminalView] = useState<"compact" | "split" | "raw">("compact");
  const [browserData, setBrowserData] = useState<{
    rootPath: string;
    currentPath: string;
    parentPath: string | null;
    entries: Array<{
      name: string;
      path: string;
      type: "file" | "directory";
      size: number;
      modifiedAt: string;
    }>;
  } | null>(null);
  const [selectedFile, setSelectedFile] = useState<{
    path: string;
    size: number;
    modifiedAt: string;
    truncated: boolean;
    content: string;
  } | null>(null);
  const [browserError, setBrowserError] = useState("");
  const [isBrowsing, setIsBrowsing] = useState(false);
  const [isLoadingFile, setIsLoadingFile] = useState(false);

  const wsRef = useMemo(() => ({ ws: null as WebSocket | null }), []);
  const isStreamingRef = useRef(false);
  const terminalStatusRef = useRef("ready");
  const {
    terminalHostRef,
    streamOutput,
    appendTerminal,
    resetTerminal,
    clearTerminalView: resetTerminalView,
    fitTerminal,
  } = useXtermTerminal();

  useEffect(() => {
    isStreamingRef.current = isStreaming;
  }, [isStreaming]);

  useEffect(() => {
    terminalStatusRef.current = terminalStatus;
  }, [terminalStatus]);

  const compactBlocks = useMemo(() => buildTerminalBlocks(streamOutput), [streamOutput]);

  const refreshAccessToken = async (currentToken: string): Promise<string | null> => {
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

  useEffect(() => {
    if (!token) return;
    let timeoutId: number | undefined;
    try {
      const parts = token.split(".");
      if (parts.length >= 2) {
        const payloadStr = parts[1].replace(/-/g, "+").replace(/_/g, "/");
        const decoded = atob(payloadStr);
        const payload = JSON.parse(decodeURIComponent(escape(decoded))) as { exp?: number };
        const exp = payload.exp;
        if (exp) {
          const now = Math.floor(Date.now() / 1000);
          const msUntilRefresh = (exp - now - 60) * 1000;
          if (msUntilRefresh <= 0) {
            void refreshAccessToken(token);
          } else {
            timeoutId = window.setTimeout(() => {
              void refreshAccessToken(token);
            }, msUntilRefresh);
          }
        }
      }
    } catch {
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

  const browseFiles = useCallback(async (path = "") => {
    setIsBrowsing(true);
    setBrowserError("");
    try {
      const query = path ? `?path=${encodeURIComponent(path)}` : "";
      const res = await api.get(`/files${query}`, true);
      if (res?.error) {
        setBrowserError(res.error.message ?? "ファイル一覧の取得に失敗しました");
        return;
      }
      setBrowserData(res);
      setSelectedFile((prev) => {
        if (!prev) return prev;
        const stillVisible = (res.entries ?? []).some((entry: { path: string }) => entry.path === prev.path);
        return stillVisible ? prev : null;
      });
    } finally {
      setIsBrowsing(false);
    }
  }, [api]);

  const openFilePreview = useCallback(async (path: string) => {
    setIsLoadingFile(true);
    setBrowserError("");
    try {
      const res = await api.get(`/files/content?path=${encodeURIComponent(path)}`, true);
      if (res?.error) {
        setBrowserError(res.error.message ?? "ファイルの読み込みに失敗しました");
        return;
      }
      setSelectedFile(res);
    } finally {
      setIsLoadingFile(false);
    }
  }, [api]);

  const loadStreamDetail = async (streamId: string) => {
    const res = await api.get(`/codex/history/${streamId}`, true);
    if (res && !res.error) {
      setSelectedStream(res);
    }
  };

  const openTerminalStream = useCallback(async (prompt: string) => {
    if (!prompt.trim() || isStreaming) return;

    resetTerminal();
    setSelectedStream(null);
    setIsStreaming(true);
    setTerminalStatus("connecting");
    appendTerminal(`\x1b[90m[local] starting Codex stream for model=${modelInput}, backend=${backendChoice}\x1b[0m\r\n`);

    const res = await api.post(
      "/codex/stream",
      { model: modelInput, prompt, metadata: { backend: backendChoice } },
      true,
    );
    if (!res?.streamId || !res?.wsUrl) {
      appendTerminal("\x1b[31m[error] failed to start stream\x1b[0m\r\n");
      setTerminalStatus("error");
      setIsStreaming(false);
      return;
    }

    const stored = getTokens().accessToken || token;
    const wsUrl = res.wsUrl.replace("<token>", encodeURIComponent(stored || ""));
    try {
      const ws = new WebSocket(wsUrl);
      wsRef.ws = ws;
      ws.onopen = () => {
        setTerminalStatus("streaming");
        appendTerminal(`\x1b[90m[ws open] ${wsUrl}\x1b[0m\r\n`);
      };
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data) as { type: string; text?: string; message?: string };
          if (msg.type === "chunk") {
            appendTerminal(msg.text ?? "");
            fitTerminal();
          } else if (msg.type === "done") {
            appendTerminal("\r\n\x1b[32m[done]\x1b[0m\r\n");
            setTerminalStatus("done");
            setIsStreaming(false);
            try {
              ws.close();
            } catch {
              // ignore
            }
          } else if (msg.type === "error") {
            appendTerminal(`\r\n\x1b[31m[error] ${msg.message ?? "unknown error"}\x1b[0m\r\n`);
            setTerminalStatus("error");
            setIsStreaming(false);
          }
        } catch {
          appendTerminal(`\r\n[raw] ${String(ev.data)}\r\n`);
        }
      };
      ws.onerror = (e) => {
        appendTerminal(`\r\n\x1b[31m[ws error] ${String((e as { message?: string })?.message ?? "unknown")}\x1b[0m\r\n`);
        setTerminalStatus("error");
        setIsStreaming(false);
      };
      ws.onclose = (ev) => {
        wsRef.ws = null;
        if (isStreamingRef.current) {
          appendTerminal(`\r\n\x1b[90m[ws closed] code=${ev.code} reason=${ev.reason}\x1b[0m\r\n`);
        }
        if (terminalStatusRef.current === "streaming") {
          setTerminalStatus("idle");
        }
        setIsStreaming(false);
      };
    } catch (e) {
      appendTerminal(`\r\n\x1b[31m[connect failed] ${String(e)}\x1b[0m\r\n`);
      setTerminalStatus("error");
      setIsStreaming(false);
    }
  }, [
    api,
    appendTerminal,
    backendChoice,
    fitTerminal,
    isStreaming,
    modelInput,
    resetTerminal,
    token,
    wsRef,
  ]);

  const startCodexStream = async () => {
    await openTerminalStream(promptInput);
  };

  const cancelCodexStream = () => {
    try {
      if (wsRef.ws && wsRef.ws.readyState === WebSocket.OPEN) {
        wsRef.ws.send(JSON.stringify({ type: "cancel" }));
      }
      wsRef.ws?.close();
    } catch {
      // ignore
    }
    appendTerminal("\r\n\x1b[33m[cancel requested]\x1b[0m\r\n");
    setTerminalStatus("idle");
    setIsStreaming(false);
  };

  const sendChatMessage = async () => {
    const prompt = chatInput.trim();
    if (!prompt) return;
    setPromptInput(prompt);
    setChatInput("");
    await openTerminalStream(prompt);
  };

  const clearTerminalView = () => {
    resetTerminalView();
    setTerminalStatus("ready");
  };

  const discoverLan = async () => {
    const candidates = [
      "codex-host.local",
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
        } catch {
          // ignore unreachable
        }
      }),
    );
    setDiscovered(results);
  };

  const handleWsEvent = useCallback((eventData: string | unknown) => {
    const now = new Date().toISOString();
    const text = typeof eventData === "string" ? eventData : JSON.stringify(eventData);
    const msg = `${now} ${text}`;
    console.debug("WS event:", msg);
    setEvents((prev) => [msg, ...prev].slice(0, 200));
  }, []);

  const wsConnected = useAutoReconnect(wsHost, token, handleWsEvent);

  useEffect(() => {
    if (!token) {
      setBrowserData(null);
      setSelectedFile(null);
      setBrowserError("");
      return;
    }
    void browseFiles("");
  }, [browseFiles, token]);

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
                  <button
                    onClick={() => {
                      setHost(`http://${d.ip}:8000`);
                      if (d.wsUrl) setWsHost(d.wsUrl);
                    }}
                  >
                    接続
                  </button>
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

      <CodexTerminalSection
        terminalStatus={terminalStatus}
        terminalView={terminalView}
        setTerminalView={setTerminalView}
        compactBlocks={compactBlocks}
        terminalHostRef={terminalHostRef}
        chatInput={chatInput}
        setChatInput={setChatInput}
        token={token}
        isStreaming={isStreaming}
        sendChatMessage={sendChatMessage}
        cancelCodexStream={cancelCodexStream}
        clearTerminalView={clearTerminalView}
        modelInput={modelInput}
        setModelInput={setModelInput}
        backendChoice={backendChoice}
        setBackendChoice={setBackendChoice}
        promptInput={promptInput}
        setPromptInput={setPromptInput}
        startCodexStream={startCodexStream}
        fetchStreamHistory={fetchStreamHistory}
      />

      <FileBrowserSection
        browserData={browserData}
        selectedFile={selectedFile}
        browserError={browserError}
        isBrowsing={isBrowsing}
        isLoadingFile={isLoadingFile}
        onRefresh={() => browseFiles(browserData?.currentPath ?? "")}
        onOpenDirectory={browseFiles}
        onOpenParent={() => browseFiles(browserData?.parentPath ?? "")}
        onOpenFile={openFilePreview}
      />

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
            <pre className="mono terminal-history">{selectedStream.prompt}</pre>
            <p><strong>Output:</strong></p>
            <pre className="mono terminal-history">{selectedStream.output}</pre>
          </div>
        )}
      </section>
    </main>
  );
}
