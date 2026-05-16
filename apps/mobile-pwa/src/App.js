import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "@xterm/xterm/css/xterm.css";
import { useAutoReconnect } from "./useAutoReconnect";
import { clearTokens, getTokens, saveTokens } from "./tokenStorage";
import { buildTerminalBlocks } from "./terminalTranscript";
import { useXtermTerminal } from "./useXtermTerminal";
import { CodexTerminalSection } from "./CodexTerminalSection";
import { FileBrowserSection } from "./FileBrowserSection";
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
    const [modelInput, setModelInput] = useState("gpt-5.4");
    const [promptInput, setPromptInput] = useState("Say hello to Codex");
    const [backendChoice, setBackendChoice] = useState("cli");
    const [isStreaming, setIsStreaming] = useState(false);
    const [streamHistory, setStreamHistory] = useState([]);
    const [selectedStream, setSelectedStream] = useState(null);
    const [sessionStreamHistory, setSessionStreamHistory] = useState([]);
    const [chatInput, setChatInput] = useState("");
    const [terminalStatus, setTerminalStatus] = useState("ready");
    const [terminalView, setTerminalView] = useState("compact");
    const [browserData, setBrowserData] = useState(null);
    const [selectedFile, setSelectedFile] = useState(null);
    const [browserError, setBrowserError] = useState("");
    const [isBrowsing, setIsBrowsing] = useState(false);
    const [isLoadingFile, setIsLoadingFile] = useState(false);
    const wsRef = useMemo(() => ({ ws: null }), []);
    const isStreamingRef = useRef(false);
    const terminalStatusRef = useRef("ready");
    const { terminalHostRef, streamOutput, appendTerminal, setTerminalOutput, resetTerminal, clearTerminalView: resetTerminalView, fitTerminal, } = useXtermTerminal();
    useEffect(() => {
        isStreamingRef.current = isStreaming;
    }, [isStreaming]);
    useEffect(() => {
        terminalStatusRef.current = terminalStatus;
    }, [terminalStatus]);
    const compactBlocks = useMemo(() => buildTerminalBlocks(streamOutput), [streamOutput]);
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
    useEffect(() => {
        if (!token)
            return;
        let timeoutId;
        try {
            const parts = token.split(".");
            if (parts.length >= 2) {
                const payloadStr = parts[1].replace(/-/g, "+").replace(/_/g, "/");
                const decoded = atob(payloadStr);
                const payload = JSON.parse(decodeURIComponent(escape(decoded)));
                const exp = payload.exp;
                if (exp) {
                    const now = Math.floor(Date.now() / 1000);
                    const msUntilRefresh = (exp - now - 60) * 1000;
                    if (msUntilRefresh <= 0) {
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
        catch {
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
            setSessionStreamHistory([]);
            setTerminalOutput("");
        }
    };
    const fetchCurrentSession = useCallback(async () => {
        const res = await api.get("/sessions/current");
        if (res?.sessionId && res?.status === "active") {
            setSessionId(res.sessionId);
            return res.sessionId;
        }
        setSessionId("");
        return "";
    }, [api]);
    const ensureActiveSessionId = useCallback(async () => {
        if (sessionId) {
            return sessionId;
        }
        const current = await fetchCurrentSession();
        if (current) {
            return current;
        }
        const created = await api.post("/sessions", {}, true);
        if (created?.sessionId) {
            setSessionId(created.sessionId);
            return created.sessionId;
        }
        return "";
    }, [api, fetchCurrentSession, sessionId]);
    const closeSession = async () => {
        await api.del("/sessions/current");
        setSessionId("");
        setSessionStreamHistory([]);
        setTerminalOutput("");
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
    const fetchSessionStreamHistory = useCallback(async (targetSessionId) => {
        if (!targetSessionId) {
            setSessionStreamHistory([]);
            setTerminalOutput("");
            return;
        }
        const res = await api.get(`/codex/history?limit=100&sessionId=${encodeURIComponent(targetSessionId)}`, true);
        if (res?.items) {
            const items = [...res.items].reverse();
            setSessionStreamHistory(items);
            const mergedTranscript = items
                .map((item) => item.output.trim())
                .filter(Boolean)
                .join("\n\n");
            setTerminalOutput(mergedTranscript);
        }
    }, [api, setTerminalOutput]);
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
                if (!prev)
                    return prev;
                const stillVisible = (res.entries ?? []).some((entry) => entry.path === prev.path);
                return stillVisible ? prev : null;
            });
        }
        finally {
            setIsBrowsing(false);
        }
    }, [api]);
    const openFilePreview = useCallback(async (path) => {
        setIsLoadingFile(true);
        setBrowserError("");
        try {
            const res = await api.get(`/files/content?path=${encodeURIComponent(path)}`, true);
            if (res?.error) {
                setBrowserError(res.error.message ?? "ファイルの読み込みに失敗しました");
                return;
            }
            setSelectedFile(res);
        }
        finally {
            setIsLoadingFile(false);
        }
    }, [api]);
    const loadStreamDetail = async (streamId) => {
        const res = await api.get(`/codex/history/${streamId}`, true);
        if (res && !res.error) {
            setSelectedStream(res);
        }
    };
    const openTerminalStream = useCallback(async (prompt) => {
        if (!prompt.trim() || isStreaming)
            return;
        const activeSessionId = await ensureActiveSessionId();
        setSelectedStream(null);
        setIsStreaming(true);
        setTerminalStatus("connecting");
        if (streamOutput.trim()) {
            appendTerminal("\r\n\r\n\x1b[90m======== next turn ========\x1b[0m\r\n");
        }
        appendTerminal(`\x1b[90m[local] starting Codex stream for model=${modelInput}, backend=${backendChoice}\x1b[0m\r\n`);
        const res = await api.post("/codex/stream", { model: modelInput, prompt, metadata: { backend: backendChoice, ...(activeSessionId ? { sessionId: activeSessionId } : {}) } }, true);
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
                    const msg = JSON.parse(ev.data);
                    if (msg.type === "chunk") {
                        appendTerminal(msg.text ?? "");
                        fitTerminal();
                    }
                    else if (msg.type === "done") {
                        appendTerminal("\r\n\x1b[32m[done]\x1b[0m\r\n");
                        setTerminalStatus("done");
                        setIsStreaming(false);
                        if (activeSessionId) {
                            void fetchSessionStreamHistory(activeSessionId);
                        }
                        try {
                            ws.close();
                        }
                        catch {
                            // ignore
                        }
                    }
                    else if (msg.type === "error") {
                        appendTerminal(`\r\n\x1b[31m[error] ${msg.message ?? "unknown error"}\x1b[0m\r\n`);
                        setTerminalStatus("error");
                        setIsStreaming(false);
                    }
                }
                catch {
                    appendTerminal(`\r\n[raw] ${String(ev.data)}\r\n`);
                }
            };
            ws.onerror = (e) => {
                appendTerminal(`\r\n\x1b[31m[ws error] ${String(e?.message ?? "unknown")}\x1b[0m\r\n`);
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
        }
        catch (e) {
            appendTerminal(`\r\n\x1b[31m[connect failed] ${String(e)}\x1b[0m\r\n`);
            setTerminalStatus("error");
            setIsStreaming(false);
        }
    }, [
        api,
        appendTerminal,
        backendChoice,
        ensureActiveSessionId,
        fetchSessionStreamHistory,
        fitTerminal,
        isStreaming,
        modelInput,
        streamOutput,
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
        }
        catch {
            // ignore
        }
        appendTerminal("\r\n\x1b[33m[cancel requested]\x1b[0m\r\n");
        setTerminalStatus("idle");
        setIsStreaming(false);
    };
    const sendChatMessage = async () => {
        const prompt = chatInput.trim();
        if (!prompt)
            return;
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
            catch {
                // ignore unreachable
            }
        }));
        setDiscovered(results);
    };
    const handleWsEvent = useCallback((eventData) => {
        const now = new Date().toISOString();
        const text = typeof eventData === "string" ? eventData : JSON.stringify(eventData);
        const msg = `${now} ${text}`;
        console.debug("WS event:", msg);
        setEvents((prev) => [msg, ...prev].slice(0, 200));
    }, []);
    const wsConnected = useAutoReconnect(wsHost, token, handleWsEvent);
    useEffect(() => {
        if (!token) {
            setSessionId("");
            setSessionStreamHistory([]);
            setBrowserData(null);
            setSelectedFile(null);
            setBrowserError("");
            setTerminalOutput("");
            return;
        }
        void fetchCurrentSession().then((activeSessionId) => {
            if (activeSessionId) {
                void fetchSessionStreamHistory(activeSessionId);
            }
            else {
                setSessionStreamHistory([]);
                setTerminalOutput("");
            }
        });
        void browseFiles("");
    }, [browseFiles, fetchCurrentSession, fetchSessionStreamHistory, setTerminalOutput, token]);
    return (_jsxs("main", { className: "app", children: [_jsx("h1", { children: "Codex Interface Mobile" }), _jsxs("section", { className: "card", children: [_jsx("h2", { children: "\u63A5\u7D9A\u8A2D\u5B9A" }), _jsxs("label", { children: ["API Host", _jsx("input", { value: host, onChange: (e) => setHost(e.target.value) })] }), _jsxs("label", { children: ["WS URL", _jsx("input", { value: wsHost, onChange: (e) => setWsHost(e.target.value) })] }), _jsx("div", { className: "row", children: _jsx("button", { onClick: discoverLan, children: "LAN\u4E0A\u3092\u767A\u898B" }) }), discovered.length > 0 && (_jsxs("div", { children: [_jsx("h3", { children: "\u767A\u898B\u3055\u308C\u305F\u30B5\u30FC\u30D0" }), _jsx("ul", { children: discovered.map((d, i) => (_jsxs("li", { children: [d.name, " (", d.ip, ")", d.wsUrl && _jsxs("span", { children: [" \u2014 ", d.wsUrl] }), _jsx("button", { onClick: () => {
                                                setHost(`http://${d.ip}:8000`);
                                                if (d.wsUrl)
                                                    setWsHost(d.wsUrl);
                                            }, children: "\u63A5\u7D9A" })] }, i))) })] })), _jsx("button", { onClick: checkHealth, children: "Health\u78BA\u8A8D" }), _jsxs("p", { children: ["\u72B6\u614B: ", health] })] }), _jsxs("section", { className: "card", children: [_jsx("h2", { children: "\u8A8D\u8A3C" }), _jsxs("label", { children: ["Device Name", _jsx("input", { value: deviceName, onChange: (e) => setDeviceName(e.target.value) })] }), _jsxs("label", { children: ["PIN", _jsx("input", { value: pin, onChange: (e) => setPin(e.target.value), type: "password" })] }), _jsxs("div", { className: "row", children: [_jsx("button", { onClick: login, children: "PIN\u30ED\u30B0\u30A4\u30F3" }), _jsx("button", { onClick: logout, children: "\u30ED\u30B0\u30A2\u30A6\u30C8" })] }), _jsxs("p", { className: "mono", children: ["Token: ", token ? `${token.slice(0, 24)}...` : "未取得"] }), _jsxs("p", { className: "mono", children: ["RefreshToken: ", refreshToken ? "保存済" : "なし"] }), _jsxs("p", { className: "mono", children: ["WS: ", wsConnected ? "✓接続中" : "✗切断"] })] }), _jsxs("section", { className: "card", children: [_jsx("h2", { children: "\u30BB\u30C3\u30B7\u30E7\u30F3/\u30B3\u30DE\u30F3\u30C9" }), _jsxs("div", { className: "row", children: [_jsx("button", { onClick: startSession, children: "\u30BB\u30C3\u30B7\u30E7\u30F3\u958B\u59CB" }), _jsx("button", { onClick: closeSession, children: "\u30BB\u30C3\u30B7\u30E7\u30F3\u7D42\u4E86" })] }), _jsxs("p", { className: "mono", children: ["Session: ", sessionId || "なし"] }), _jsxs("p", { className: "mono", children: ["Session Rallies: ", sessionStreamHistory.length] }), _jsxs("label", { children: ["Command", _jsx("input", { value: command, onChange: (e) => setCommand(e.target.value) })] }), _jsx("button", { onClick: runCommand, children: "\u5B9F\u884C" }), _jsxs("p", { className: "mono", children: ["\u7D50\u679C: ", commandResult] })] }), _jsx(CodexTerminalSection, { terminalStatus: terminalStatus, terminalView: terminalView, setTerminalView: setTerminalView, compactBlocks: compactBlocks, terminalHostRef: terminalHostRef, chatInput: chatInput, setChatInput: setChatInput, token: token, isStreaming: isStreaming, sendChatMessage: sendChatMessage, cancelCodexStream: cancelCodexStream, clearTerminalView: clearTerminalView, modelInput: modelInput, setModelInput: setModelInput, backendChoice: backendChoice, setBackendChoice: setBackendChoice, promptInput: promptInput, setPromptInput: setPromptInput, startCodexStream: startCodexStream, fetchStreamHistory: fetchStreamHistory }), _jsx(FileBrowserSection, { browserData: browserData, selectedFile: selectedFile, browserError: browserError, isBrowsing: isBrowsing, isLoadingFile: isLoadingFile, onRefresh: () => browseFiles(browserData?.currentPath ?? ""), onOpenDirectory: browseFiles, onOpenParent: () => browseFiles(browserData?.parentPath ?? ""), onOpenFile: openFilePreview }), _jsxs("section", { className: "card", children: [_jsx("h2", { children: "\u30ED\u30B0" }), _jsx("button", { onClick: fetchLogs, children: "\u6700\u65B0\u53D6\u5F97" }), _jsx("ul", { children: logs.map((l) => (_jsxs("li", { children: [l.timestamp, " [", l.level, "] ", l.message] }, l.id))) })] }), _jsxs("section", { className: "card", children: [_jsx("h2", { children: "WS\u30A4\u30D9\u30F3\u30C8" }), _jsx("div", { className: "row", children: _jsx("button", { onClick: () => setEvents([]), children: "\u30AF\u30EA\u30A2" }) }), _jsx("ul", { className: "mono", children: events.map((e, i) => (_jsx("li", { children: e }, `${i}_${e.slice(0, 8)}`))) })] }), _jsxs("section", { className: "card", children: [_jsx("h2", { children: "\u3053\u306E\u30BB\u30C3\u30B7\u30E7\u30F3\u306E\u4F1A\u8A71\u5C65\u6B74" }), _jsx("div", { className: "row", children: _jsx("button", { onClick: () => void fetchSessionStreamHistory(sessionId), disabled: !sessionId, children: "\u3053\u306E\u30BB\u30C3\u30B7\u30E7\u30F3\u3092\u518D\u8AAD\u8FBC" }) }), sessionStreamHistory.length > 0 ? (_jsx("ul", { children: sessionStreamHistory.map((s) => (_jsxs("li", { children: [_jsx("strong", { children: new Date(s.createdAt).toLocaleString() }), " ", _jsx("span", { className: "mono", children: s.prompt.slice(0, 60) }), _jsx("button", { onClick: () => loadStreamDetail(s.streamId), children: "\u8A73\u7D30" })] }, s.streamId))) })) : (_jsx("p", { className: "mono", children: "\u3053\u306E session \u306B\u306F\u307E\u3060\u4F1A\u8A71\u5C65\u6B74\u304C\u3042\u308A\u307E\u305B\u3093\u3002" }))] }), _jsxs("section", { className: "card", children: [_jsx("h2", { children: "Codex \u30B9\u30C8\u30EA\u30FC\u30E0\u5C65\u6B74" }), _jsxs("div", { className: "row", children: [_jsx("button", { onClick: fetchStreamHistory, children: "\u5C65\u6B74\u3092\u53D6\u5F97" }), _jsx("button", { onClick: () => setSelectedStream(null), children: "\u30AF\u30EA\u30A2" })] }), streamHistory.length > 0 && (_jsxs("div", { children: [_jsx("h3", { children: "\u904E\u53BB\u306E\u30B9\u30C8\u30EA\u30FC\u30E0" }), _jsx("ul", { children: streamHistory.map((s) => (_jsxs("li", { children: [_jsx("strong", { children: s.model }), " ", new Date(s.createdAt).toLocaleString(), " ", _jsx("button", { onClick: () => loadStreamDetail(s.streamId), children: "\u8A73\u7D30" })] }, s.streamId))) })] })), selectedStream && (_jsxs("div", { className: "card", style: { marginTop: 16, backgroundColor: "#f5f5f5" }, children: [_jsx("h3", { children: "\u30B9\u30C8\u30EA\u30FC\u30E0\u8A73\u7D30" }), _jsxs("p", { children: [_jsx("strong", { children: "Model:" }), " ", selectedStream.model] }), _jsxs("p", { children: [_jsx("strong", { children: "Device:" }), " ", selectedStream.deviceId] }), _jsxs("p", { children: [_jsx("strong", { children: "Created:" }), " ", new Date(selectedStream.createdAt).toLocaleString()] }), _jsx("p", { children: _jsx("strong", { children: "Prompt:" }) }), _jsx("pre", { className: "mono terminal-history", children: selectedStream.prompt }), _jsx("p", { children: _jsx("strong", { children: "Output:" }) }), _jsx("pre", { className: "mono terminal-history", children: selectedStream.output })] }))] })] }));
}
