import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useMemo, useState, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useAutoReconnect } from "./useAutoReconnect";
import { getTokens, saveTokens, clearTokens } from "./tokenStorage";
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
    const [logs, setLogs] = useState([]);
    const [events, setEvents] = useState([]);
    const [discovered, setDiscovered] = useState([]);
    const [modelInput, setModelInput] = useState("gpt-codex-local");
    const [promptInput, setPromptInput] = useState("Say hello to Codex");
    const [backendChoice, setBackendChoice] = useState("cli");
    const [streamOutput, setStreamOutput] = useState("");
    const [isStreaming, setIsStreaming] = useState(false);
    const [streamHistory, setStreamHistory] = useState([]);
    const [selectedStream, setSelectedStream] = useState(null);
    const wsRef = useMemo(() => ({ ws: null }), []);
    const [messages, setMessages] = useState([]);
    const [chatInput, setChatInput] = useState("");
    const refreshAccessToken = async (currentToken) => {
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
                const data = (await r.json());
                const newToken = data.accessToken;
                setToken(newToken);
                saveTokens(newToken, refreshToken, deviceId);
                return newToken;
            }
        }
        catch {
            // ignore
        }
        return null;
    };
    // Proactively refresh access token before it expires (refresh 60s before exp)
    useEffect(() => {
        if (!token)
            return;
        let timeoutId;
        try {
            const parts = token.split(".");
            if (parts.length >= 2) {
                const payloadStr = parts[1].replace(/-/g, "+").replace(/_/g, "/");
                const decoded = atob(payloadStr);
                // decodeURIComponent/escape used to safely handle utf8
                // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
                const payload = JSON.parse(decodeURIComponent(escape(decoded)));
                const exp = payload?.exp;
                if (exp) {
                    const now = Math.floor(Date.now() / 1000);
                    const msUntilRefresh = (exp - now - 60) * 1000;
                    if (msUntilRefresh <= 0) {
                        // already near expiry -> refresh immediately
                        void refreshAccessToken(token);
                    }
                    else {
                        timeoutId = window.setTimeout(() => {
                            void refreshAccessToken(token);
                        }, msUntilRefresh);
                    }
                }
            }
        }
        catch (e) {
            // ignore malformed token
        }
        return () => {
            if (timeoutId)
                clearTimeout(timeoutId);
        };
    }, [token, refreshToken, deviceId, host]);
    const api = useMemo(() => ({
        get: async (path, auth = false) => {
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
        post: async (path, body, auth = false) => {
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
        del: async (path) => {
            const r = await fetch(`${host}${API_PREFIX}${path}`, {
                method: "DELETE",
            });
            return r.json();
        },
    }), [host, token, refreshToken, deviceId]);
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
        }
        else {
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
        const res = await api.post("/commands", {
            sessionId,
            command,
            args: { verbose: true },
        }, true);
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
    const loadStreamDetail = async (streamId) => {
        const res = await api.get(`/codex/history/${streamId}`, true);
        if (res && !res.error) {
            setSelectedStream(res);
        }
    };
    const startCodexStream = async () => {
        setStreamOutput("");
        setIsStreaming(true);
        const res = await api.post("/codex/stream", { model: modelInput, prompt: promptInput, metadata: { backend: backendChoice } }, true);
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
                    }
                    else if (msg.type === "done") {
                        setStreamOutput((s) => s + "\n[done]\n");
                        setIsStreaming(false);
                        try {
                            ws.close();
                        }
                        catch (e) { /* ignore */ }
                    }
                    else if (msg.type === "error") {
                        setStreamOutput((s) => s + `\n[error] ${msg.message}\n`);
                        setIsStreaming(false);
                    }
                }
                catch (e) {
                    setStreamOutput((s) => s + `\n[raw] ${String(ev.data)}\n`);
                }
            };
            ws.onerror = (e) => {
                setStreamOutput((s) => s + `\n[ws error] ${String(e?.message ?? e)}\n`);
                setIsStreaming(false);
            };
            ws.onclose = (ev) => {
                setIsStreaming(false);
                wsRef.ws = null;
                setStreamOutput((s) => s + `\n[ws closed] code=${ev.code} reason=${ev.reason}\n`);
            };
        }
        catch (e) {
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
        }
        catch (e) {
            // ignore
        }
        setIsStreaming(false);
    };
    const sendChatMessage = async () => {
        if (!chatInput.trim())
            return;
        const userId = `m_${Date.now()}`;
        setMessages((m) => [...m, { id: userId, role: "user", text: chatInput }]);
        // start assistant placeholder
        const placeholderId = `assist_${Date.now()}`;
        setMessages((m) => [...m, { id: placeholderId, role: "assistant", text: "", status: "streaming" }]);
        // start stream
        const res = await api.post("/codex/stream", { model: modelInput, prompt: chatInput, metadata: { backend: backendChoice } }, true);
        if (!res?.streamId || !res?.wsUrl) {
            setMessages((m) => m.map((mm) => (mm.id === placeholderId ? { ...mm, text: "Failed to start stream", status: "error" } : mm)));
            return;
        }
        const stored = getTokens().accessToken || token;
        const wsUrl = res.wsUrl.replace("<token>", encodeURIComponent(stored || ""));
        let ws = null;
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
                    }
                    else if (msg.type === "done") {
                        setMessages((m) => m.map((mm) => (mm.id === placeholderId ? { ...mm, status: "done" } : mm)));
                        try {
                            ws?.close();
                        }
                        catch (e) { }
                    }
                    else if (msg.type === "error") {
                        setMessages((m) => m.map((mm) => (mm.id === placeholderId ? { ...mm, text: mm.text + `\n[error] ${msg.message}`, status: "error" } : mm)));
                    }
                }
                catch (e) {
                    setMessages((m) => m.map((mm) => (mm.id === placeholderId ? { ...mm, text: mm.text + `\n[raw] ${String(ev.data)}` } : mm)));
                }
            };
            ws.onerror = () => {
                setMessages((m) => m.map((mm) => (mm.id === placeholderId ? { ...mm, status: "error" } : mm)));
            };
            ws.onclose = () => {
                setMessages((m) => m.map((mm) => (mm.id === placeholderId && mm.status !== "done" ? { ...mm, status: "done" } : mm)));
            };
        }
        catch (e) {
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
        ].filter(Boolean);
        const results = [];
        await Promise.all(candidates.map(async (c) => {
            const url = `http://${c}:8000/api/v1/server/info`;
            try {
                const r = await fetch(url, { mode: "cors" });
                if (!r.ok)
                    return;
                const data = await r.json();
                results.push({ name: data.name ?? c, ip: data.ip ?? c, wsUrl: data.wsUrl });
            }
            catch (e) {
                // ignore unreachable
            }
        }));
        setDiscovered(results);
    };
    // Auto-reconnect WS when token changes
    const handleWsEvent = useCallback((eventData) => {
        const now = new Date().toISOString();
        const text = typeof eventData === "string" ? eventData : JSON.stringify(eventData);
        const msg = `${now} ${text}`;
        console.debug("WS event:", msg);
        setEvents((prev) => [msg, ...prev].slice(0, 200));
    }, [setEvents]);
    const wsConnected = useAutoReconnect(wsHost, token, handleWsEvent);
    return (_jsxs("main", { className: "app", children: [_jsx("h1", { children: "Codex Interface Mobile" }), _jsxs("section", { className: "card", children: [_jsx("h2", { children: "\u63A5\u7D9A\u8A2D\u5B9A" }), _jsxs("label", { children: ["API Host", _jsx("input", { value: host, onChange: (e) => setHost(e.target.value) })] }), _jsxs("label", { children: ["WS URL", _jsx("input", { value: wsHost, onChange: (e) => setWsHost(e.target.value) })] }), _jsx("div", { className: "row", children: _jsx("button", { onClick: discoverLan, children: "LAN\u4E0A\u3092\u767A\u898B" }) }), discovered.length > 0 && (_jsxs("div", { children: [_jsx("h3", { children: "\u767A\u898B\u3055\u308C\u305F\u30B5\u30FC\u30D0" }), _jsx("ul", { children: discovered.map((d, i) => (_jsxs("li", { children: [d.name, " (", d.ip, ")", d.wsUrl && _jsxs("span", { children: [" \u2014 ", d.wsUrl] }), _jsx("button", { onClick: () => {
                                                setHost(`http://${d.ip}:8000`);
                                                if (d.wsUrl)
                                                    setWsHost(d.wsUrl);
                                            }, children: "\u63A5\u7D9A" })] }, i))) })] })), _jsx("button", { onClick: checkHealth, children: "Health\u78BA\u8A8D" }), _jsxs("p", { children: ["\u72B6\u614B: ", health] })] }), _jsxs("section", { className: "card", children: [_jsx("h2", { children: "\u8A8D\u8A3C" }), _jsxs("label", { children: ["Device Name", _jsx("input", { value: deviceName, onChange: (e) => setDeviceName(e.target.value) })] }), _jsxs("label", { children: ["PIN", _jsx("input", { value: pin, onChange: (e) => setPin(e.target.value), type: "password" })] }), _jsxs("div", { className: "row", children: [_jsx("button", { onClick: login, children: "PIN\u30ED\u30B0\u30A4\u30F3" }), _jsx("button", { onClick: logout, children: "\u30ED\u30B0\u30A2\u30A6\u30C8" })] }), _jsxs("p", { className: "mono", children: ["Token: ", token ? `${token.slice(0, 24)}...` : "未取得"] }), _jsxs("p", { className: "mono", children: ["RefreshToken: ", refreshToken ? "保存済" : "なし"] }), _jsxs("p", { className: "mono", children: ["WS: ", wsConnected ? "✓接続中" : "✗切断"] })] }), _jsxs("section", { className: "card", children: [_jsx("h2", { children: "\u30BB\u30C3\u30B7\u30E7\u30F3/\u30B3\u30DE\u30F3\u30C9" }), _jsxs("div", { className: "row", children: [_jsx("button", { onClick: startSession, children: "\u30BB\u30C3\u30B7\u30E7\u30F3\u958B\u59CB" }), _jsx("button", { onClick: closeSession, children: "\u30BB\u30C3\u30B7\u30E7\u30F3\u7D42\u4E86" })] }), _jsxs("p", { className: "mono", children: ["Session: ", sessionId || "なし"] }), _jsxs("label", { children: ["Command", _jsx("input", { value: command, onChange: (e) => setCommand(e.target.value) })] }), _jsx("button", { onClick: runCommand, children: "\u5B9F\u884C" }), _jsxs("p", { className: "mono", children: ["\u7D50\u679C: ", commandResult] })] }), _jsxs("section", { className: "card", children: [_jsx("h2", { children: "\u30ED\u30B0" }), _jsx("button", { onClick: fetchLogs, children: "\u6700\u65B0\u53D6\u5F97" }), _jsx("ul", { children: logs.map((l) => (_jsxs("li", { children: [l.timestamp, " [", l.level, "] ", l.message] }, l.id))) })] }), _jsxs("section", { className: "card", children: [_jsx("h2", { children: "WS\u30A4\u30D9\u30F3\u30C8" }), _jsx("div", { className: "row", children: _jsx("button", { onClick: () => setEvents([]), children: "\u30AF\u30EA\u30A2" }) }), _jsx("ul", { className: "mono", children: events.map((e, i) => (_jsx("li", { children: e }, `${i}_${e.slice(0, 8)}`))) })] }), _jsxs("section", { className: "card", children: [_jsx("h2", { children: "Codex \u30B9\u30C8\u30EA\u30FC\u30DF\u30F3\u30B0" }), _jsx("h3", { children: "\u30C1\u30E3\u30C3\u30C8" }), _jsx("div", { style: { border: "1px solid #ddd", padding: 8, maxHeight: 300, overflow: "auto", marginBottom: 8 }, children: messages.map((m) => (_jsxs("div", { style: { marginBottom: 8 }, children: [_jsxs("div", { style: { fontWeight: "bold" }, children: [m.role === "user" ? "You" : "Codex", " ", m.status === "streaming" ? "(typing...)" : ""] }), _jsx("div", { style: { whiteSpace: "pre-wrap", wordBreak: "break-word", overflowWrap: "anywhere", maxWidth: "100%" }, children: ReactMarkdown ? (_jsx(ReactMarkdown, { remarkPlugins: remarkGfm ? [remarkGfm] : [], children: m.text })) : (m.text) })] }, m.id))) }), _jsxs("div", { className: "row", children: [_jsx("input", { style: { flex: 1 }, value: chatInput, onChange: (e) => setChatInput(e.target.value), placeholder: "Type a message..." }), _jsx("button", { onClick: sendChatMessage, disabled: !token || !chatInput.trim(), children: "Send" })] }), _jsxs("label", { children: ["Model", _jsx("input", { value: modelInput, onChange: (e) => setModelInput(e.target.value) })] }), _jsxs("label", { children: ["Backend", _jsxs("select", { value: backendChoice, onChange: (e) => setBackendChoice(e.target.value), children: [_jsx("option", { value: "cli", children: "cli" }), _jsx("option", { value: "mock", children: "mock" })] })] }), _jsxs("label", { children: ["Prompt", _jsx("input", { value: promptInput, onChange: (e) => setPromptInput(e.target.value) })] }), _jsxs("div", { className: "row", children: [_jsx("button", { onClick: startCodexStream, disabled: isStreaming, children: "Start Stream" }), _jsx("button", { onClick: cancelCodexStream, disabled: !isStreaming, children: "Cancel" })] }), _jsx("div", { style: { maxHeight: 300, overflowY: "auto", overflowX: "auto", wordBreak: "break-word", overflowWrap: "anywhere", maxWidth: "100%" }, children: ReactMarkdown ? (_jsx(ReactMarkdown, { remarkPlugins: remarkGfm ? [remarkGfm] : [], children: streamOutput })) : (_jsx("pre", { className: "mono", style: { whiteSpace: "pre-wrap" }, children: streamOutput })) })] }), _jsxs("section", { className: "card", children: [_jsx("h2", { children: "Codex \u30B9\u30C8\u30EA\u30FC\u30E0\u5C65\u6B74" }), _jsxs("div", { className: "row", children: [_jsx("button", { onClick: fetchStreamHistory, children: "\u5C65\u6B74\u3092\u53D6\u5F97" }), _jsx("button", { onClick: () => setSelectedStream(null), children: "\u30AF\u30EA\u30A2" })] }), streamHistory.length > 0 && (_jsxs("div", { children: [_jsx("h3", { children: "\u904E\u53BB\u306E\u30B9\u30C8\u30EA\u30FC\u30E0" }), _jsx("ul", { children: streamHistory.map((s) => (_jsxs("li", { children: [_jsx("strong", { children: s.model }), " ", new Date(s.createdAt).toLocaleString(), " ", _jsx("button", { onClick: () => loadStreamDetail(s.streamId), children: "\u8A73\u7D30" })] }, s.streamId))) })] })), selectedStream && (_jsxs("div", { className: "card", style: { marginTop: 16, backgroundColor: "#f5f5f5" }, children: [_jsx("h3", { children: "\u30B9\u30C8\u30EA\u30FC\u30E0\u8A73\u7D30" }), _jsxs("p", { children: [_jsx("strong", { children: "Model:" }), " ", selectedStream.model] }), _jsxs("p", { children: [_jsx("strong", { children: "Device:" }), " ", selectedStream.deviceId] }), _jsxs("p", { children: [_jsx("strong", { children: "Created:" }), " ", new Date(selectedStream.createdAt).toLocaleString()] }), _jsx("p", { children: _jsx("strong", { children: "Prompt:" }) }), _jsx("div", { style: { maxHeight: 150, overflowY: "auto", overflowX: "auto", wordBreak: "break-word", overflowWrap: "anywhere", maxWidth: "100%" }, children: ReactMarkdown ? (_jsx(ReactMarkdown, { remarkPlugins: remarkGfm ? [remarkGfm] : [], children: selectedStream.prompt })) : (_jsx("pre", { className: "mono", style: { whiteSpace: "pre-wrap" }, children: selectedStream.prompt })) }), _jsx("p", { children: _jsx("strong", { children: "Output:" }) }), _jsx("div", { style: { maxHeight: 200, overflowY: "auto", overflowX: "auto", wordBreak: "break-word", overflowWrap: "anywhere", maxWidth: "100%" }, children: ReactMarkdown ? (_jsx(ReactMarkdown, { remarkPlugins: remarkGfm ? [remarkGfm] : [], children: selectedStream.output })) : (_jsx("pre", { className: "mono", style: { whiteSpace: "pre-wrap" }, children: selectedStream.output })) })] }))] })] }));
}
