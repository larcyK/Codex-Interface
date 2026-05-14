import { useEffect, useRef, useState } from "react";
export function useAutoReconnect(wsUrl, token, onEvent) {
    const [wsConnected, setWsConnected] = useState(false);
    const wsRef = useRef(null);
    const reconnectAttemptsRef = useRef(0);
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
                ws.onclose = () => {
                    setWsConnected(false);
                    scheduleReconnect();
                };
                ws.onerror = () => {
                    setWsConnected(false);
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
                const delay = Math.min(1000 * Math.pow(2, reconnectAttemptsRef.current), 30000);
                reconnectAttemptsRef.current++;
                onEvent(`再接続予定 (${reconnectAttemptsRef.current}/${maxReconnectAttempts})`);
                setTimeout(connect, delay);
            }
        };
        connect();
        return () => {
            if (wsRef.current) {
                wsRef.current.close();
            }
        };
    }, [wsUrl, token, onEvent]);
    return wsConnected;
}
