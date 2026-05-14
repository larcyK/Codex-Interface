import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useMemo, useState } from "react";
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
    // Auto-reconnect WS when token changes
    const wsConnected = useAutoReconnect(wsHost, token, (eventData) => {
        const now = new Date().toISOString();
        const text = typeof eventData === "string" ? eventData : JSON.stringify(eventData);
        const msg = `${now} ${text}`;
        console.debug("WS event:", msg);
        setEvents((prev) => [msg, ...prev].slice(0, 200));
    });
    return (_jsxs("main", { className: "app", children: [_jsx("h1", { children: "Codex Interface Mobile" }), _jsxs("section", { className: "card", children: [_jsx("h2", { children: "\u63A5\u7D9A\u8A2D\u5B9A" }), _jsxs("label", { children: ["API Host", _jsx("input", { value: host, onChange: (e) => setHost(e.target.value) })] }), _jsxs("label", { children: ["WS URL", _jsx("input", { value: wsHost, onChange: (e) => setWsHost(e.target.value) })] }), _jsx("button", { onClick: checkHealth, children: "Health\u78BA\u8A8D" }), _jsxs("p", { children: ["\u72B6\u614B: ", health] })] }), _jsxs("section", { className: "card", children: [_jsx("h2", { children: "\u8A8D\u8A3C" }), _jsxs("label", { children: ["Device Name", _jsx("input", { value: deviceName, onChange: (e) => setDeviceName(e.target.value) })] }), _jsxs("label", { children: ["PIN", _jsx("input", { value: pin, onChange: (e) => setPin(e.target.value), type: "password" })] }), _jsxs("div", { className: "row", children: [_jsx("button", { onClick: login, children: "PIN\u30ED\u30B0\u30A4\u30F3" }), _jsx("button", { onClick: logout, children: "\u30ED\u30B0\u30A2\u30A6\u30C8" })] }), _jsxs("p", { className: "mono", children: ["Token: ", token ? `${token.slice(0, 24)}...` : "未取得"] }), _jsxs("p", { className: "mono", children: ["RefreshToken: ", refreshToken ? "保存済" : "なし"] }), _jsxs("p", { className: "mono", children: ["WS: ", wsConnected ? "✓接続中" : "✗切断"] })] }), _jsxs("section", { className: "card", children: [_jsx("h2", { children: "\u30BB\u30C3\u30B7\u30E7\u30F3/\u30B3\u30DE\u30F3\u30C9" }), _jsxs("div", { className: "row", children: [_jsx("button", { onClick: startSession, children: "\u30BB\u30C3\u30B7\u30E7\u30F3\u958B\u59CB" }), _jsx("button", { onClick: closeSession, children: "\u30BB\u30C3\u30B7\u30E7\u30F3\u7D42\u4E86" })] }), _jsxs("p", { className: "mono", children: ["Session: ", sessionId || "なし"] }), _jsxs("label", { children: ["Command", _jsx("input", { value: command, onChange: (e) => setCommand(e.target.value) })] }), _jsx("button", { onClick: runCommand, children: "\u5B9F\u884C" }), _jsxs("p", { className: "mono", children: ["\u7D50\u679C: ", commandResult] })] }), _jsxs("section", { className: "card", children: [_jsx("h2", { children: "\u30ED\u30B0" }), _jsx("button", { onClick: fetchLogs, children: "\u6700\u65B0\u53D6\u5F97" }), _jsx("ul", { children: logs.map((l) => (_jsxs("li", { children: [l.timestamp, " [", l.level, "] ", l.message] }, l.id))) })] }), _jsxs("section", { className: "card", children: [_jsx("h2", { children: "WS\u30A4\u30D9\u30F3\u30C8" }), _jsx("div", { className: "row", children: _jsx("button", { onClick: () => setEvents([]), children: "\u30AF\u30EA\u30A2" }) }), _jsx("ul", { className: "mono", children: events.map((e, i) => (_jsx("li", { children: e }, `${i}_${e.slice(0, 8)}`))) })] })] }));
}
