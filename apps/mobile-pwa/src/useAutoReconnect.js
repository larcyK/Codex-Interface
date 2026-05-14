import { useEffect, useRef, useState } from "react";
export function useAutoReconnect(wsUrl, token, onEvent) {
    const [wsConnected, setWsConnected] = useState(false);
    const wsRef = useRef(null);
    const reconnectAttemptsRef = useRef(0);
    const reconnectTimerRef = useRef(null);
    const maxReconnectAttempts = 10;
    useEffect(() => {
        if (!token || !wsUrl) {
            return;
        }
        const connect = () => {
            try {
                const ws = new WebSocket(`${wsUrl}?token=${encodeURIComponent(token)}`);
                ws.onopen = () => {
                    setWsConnected(true);
                    reconnectAttemptsRef.current = 0;
                    onEvent("WS接続成功");
                };
                ws.onmessage = (event) => {
                    onEvent(event.data);
                };
                ws.onclose = (ev) => {
                    setWsConnected(false);
                    const code = (ev && ev.code) || 0;
                    const reason = (ev && ev.reason) || "";
                    onEvent(`WS切断(code=${code}) ${reason}`);
                    scheduleReconnect();
                };
                ws.onerror = (ev) => {
                    setWsConnected(false);
                    onEvent(`WSエラー`);
                    scheduleReconnect();
                };
                wsRef.current = ws;
            }
            catch (error) {
                scheduleReconnect();
            }
        };
        const scheduleReconnect = () => {
            if (reconnectAttemptsRef.current < maxReconnectAttempts) {
                // clear any existing timer
                if (reconnectTimerRef.current) {
                    clearTimeout(reconnectTimerRef.current);
                }
                const delay = Math.min(1000 * Math.pow(2, reconnectAttemptsRef.current), 30000);
                reconnectAttemptsRef.current++;
                onEvent(`再接続予定 (${reconnectAttemptsRef.current}/${maxReconnectAttempts}) in ${delay}ms`);
                reconnectTimerRef.current = window.setTimeout(() => {
                    reconnectTimerRef.current = null;
                    connect();
                }, delay);
            }
        };
        connect();
        return () => {
            if (reconnectTimerRef.current) {
                clearTimeout(reconnectTimerRef.current);
                reconnectTimerRef.current = null;
            }
            if (wsRef.current) {
                try {
                    wsRef.current.onopen = null;
                    wsRef.current.onmessage = null;
                    wsRef.current.onclose = null;
                    wsRef.current.onerror = null;
                    wsRef.current.close();
                }
                catch (e) {
                    /* ignore */
                }
            }
        };
    }, [wsUrl, token, onEvent]);
    return wsConnected;
}
