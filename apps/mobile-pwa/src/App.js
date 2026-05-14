import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useMemo, useState } from "react";
import { useAutoReconnect } from "./useAutoReconnect";
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
    const [token, setToken] = useState("");
    const [sessionId, setSessionId] = useState("");
    const [health, setHealth] = useState("未接続");
    const [command, setCommand] = useState("status");
    const [commandResult, setCommandResult] = useState("");
    const [logs, setLogs] = useState([]);
    const [events, setEvents] = useState([]);
    const api = useMemo(() => ({
        get: async (path, auth = false) => {
            const r = await fetch(`${host}${API_PREFIX}${path}`, {
                headers: auth ? { Authorization: `Bearer ${token}` } : undefined,
            });
            return r.json();
        },
        post: async (path, body, auth = false) => {
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
        del: async (path) => {
            const r = await fetch(`${host}${API_PREFIX}${path}`, {
                method: "DELETE",
            });
            return r.json();
        },
    }), [host, token]);
    const checkHealth = async () => {
        const res = await api.get("/health");
        setHealth(`${res.status} (${res.codex})`);
    };
    const login = async () => {
        const res = await api.post("/auth/pin", { pin, deviceName });
        if (res.accessToken) {
            setToken(res.accessToken);
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
        setEvents((prev) => [eventData, ...prev].slice(0, 20));
    });
    return (_jsxs("main", { className: "app", children: [_jsx("h1", { children: "Codex Interface Mobile" }), _jsxs("section", { className: "card", children: [_jsx("h2", { children: "\u63A5\u7D9A\u8A2D\u5B9A" }), _jsxs("label", { children: ["API Host", _jsx("input", { value: host, onChange: (e) => setHost(e.target.value) })] }), _jsxs("label", { children: ["WS URL", _jsx("input", { value: wsHost, onChange: (e) => setWsHost(e.target.value) })] }), _jsx("button", { onClick: checkHealth, children: "Health\u78BA\u8A8D" }), _jsxs("p", { children: ["\u72B6\u614B: ", health] })] }), _jsxs("section", { className: "card", children: [_jsx("h2", { children: "\u8A8D\u8A3C" }), _jsxs("label", { children: ["Device Name", _jsx("input", { value: deviceName, onChange: (e) => setDeviceName(e.target.value) })] }), _jsxs("label", { children: ["PIN", _jsx("input", { value: pin, onChange: (e) => setPin(e.target.value), type: "password" })] }), _jsx("button", { onClick: login, children: "PIN\u30ED\u30B0\u30A4\u30F3" }), _jsxs("p", { className: "mono", children: ["Token: ", token ? `${token.slice(0, 24)}...` : "未取得"] }), _jsxs("p", { className: "mono", children: ["WS: ", wsConnected ? "✓接続中" : "✗切断"] })] }), _jsxs("section", { className: "card", children: [_jsx("h2", { children: "\u30BB\u30C3\u30B7\u30E7\u30F3/\u30B3\u30DE\u30F3\u30C9" }), _jsxs("div", { className: "row", children: [_jsx("button", { onClick: startSession, children: "\u30BB\u30C3\u30B7\u30E7\u30F3\u958B\u59CB" }), _jsx("button", { onClick: closeSession, children: "\u30BB\u30C3\u30B7\u30E7\u30F3\u7D42\u4E86" })] }), _jsxs("p", { className: "mono", children: ["Session: ", sessionId || "なし"] }), _jsxs("label", { children: ["Command", _jsx("input", { value: command, onChange: (e) => setCommand(e.target.value) })] }), _jsx("button", { onClick: runCommand, children: "\u5B9F\u884C" }), _jsxs("p", { className: "mono", children: ["\u7D50\u679C: ", commandResult] })] }), _jsxs("section", { className: "card", children: [_jsx("h2", { children: "\u30ED\u30B0" }), _jsx("button", { onClick: fetchLogs, children: "\u6700\u65B0\u53D6\u5F97" }), _jsx("ul", { children: logs.map((l) => (_jsxs("li", { children: [l.timestamp, " [", l.level, "] ", l.message] }, l.id))) })] }), _jsxs("section", { className: "card", children: [_jsx("h2", { children: "WS\u30A4\u30D9\u30F3\u30C8" }), _jsx("ul", { className: "mono", children: events.map((e, i) => (_jsx("li", { children: e }, `${i}_${e.slice(0, 8)}`))) })] })] }));
}
