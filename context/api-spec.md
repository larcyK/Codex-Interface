# Codex Interface API設計（MVP）

最終更新: 2026-05-14

## 1. 共通仕様
- Base URL: `https://<host>:8000/api/v1`
- Content-Type: `application/json`
- 認証: `Authorization: Bearer <JWT>`
- エラー形式:

```json
{
  "error": {
    "code": "UNAUTHORIZED",
    "message": "Token is invalid or expired"
  }
}
```

## 2. RESTエンドポイント

### 2.1 Health
- `GET /health`
- 認証不要
- レスポンス:

```json
{
  "status": "ok",
  "version": "0.1.0",
  "codex": "running"
}
```

### 2.2 認証
- `POST /auth/pin`
- リクエスト:

```json
{
  "pin": "123456",
  "deviceName": "iPhone-16"
}
```

- レスポンス:

```json
{
  "accessToken": "<jwt>",
  "expiresIn": 900,
  "refreshToken": "<opaque>"
}
```

- `POST /auth/refresh`
- リクエスト:

```json
{
  "refreshToken": "<opaque>"
}
```

### 2.3 接続先情報
- `GET /server/info`
- レスポンス:

```json
{
  "name": "codex-host.local",
  "ip": "192.168.1.10",
  "features": ["exec", "logs", "ws"],
  "wsUrl": "wss://codex-host.local:8001/ws"
}
```

### 2.4 セッション
- `GET /sessions/current`
- `POST /sessions`（新規セッション開始）
- `DELETE /sessions/current`（切断）

### 2.5 コマンド実行
- `POST /commands`
- リクエスト:

```json
{
  "sessionId": "sess_abc123",
  "command": "status",
  "args": {"verbose": true}
}
```

- レスポンス:

```json
{
  "requestId": "req_xyz",
  "accepted": true
}
```

- `POST /commands/{requestId}/cancel`

### 2.6 ログ
- `GET /logs?cursor=<cursor>&limit=50`
- レスポンス:

```json
{
  "items": [
    {
      "id": "log_1",
      "timestamp": "2026-05-14T10:00:00Z",
      "level": "info",
      "message": "Command status executed"
    }
  ],
  "nextCursor": "cursor_2"
}
```

## 3. WebSocket
- URL: `wss://<host>:8001/ws`
- Header: `Authorization: Bearer <JWT>`

### 3.1 イベント種別
- `server.status`
- `session.updated`
- `command.accepted`
- `command.stdout`
- `command.stderr`
- `command.completed`
- `command.failed`
- `audit.event`

### 3.2 メッセージ形式

```json
{
  "event": "command.stdout",
  "timestamp": "2026-05-14T10:00:01Z",
  "requestId": "req_xyz",
  "payload": {
    "chunk": "running..."
  }
}
```

## 4. ステータスコード方針
- `200` 成功
- `202` 非同期受理
- `400` バリデーションエラー
- `401` 認証エラー
- `403` 認可エラー
- `404` 未存在
- `409` セッション競合
- `429` レート制限
- `500` 予期しない内部エラー
