# Codex Interface データモデル設計（MVP）

最終更新: 2026-05-14

## 1. エンティティ

### 1.1 Device
- `deviceId` (string, PK)
- `deviceName` (string)
- `firstSeenAt` (datetime)
- `lastSeenAt` (datetime)
- `trusted` (boolean)

### 1.2 Session
- `sessionId` (string, PK)
- `deviceId` (FK -> Device)
- `status` (active | closed | expired)
- `createdAt` (datetime)
- `closedAt` (datetime, nullable)

### 1.3 CommandRequest
- `requestId` (string, PK)
- `sessionId` (FK -> Session)
- `command` (string)
- `argsJson` (json)
- `status` (accepted | running | completed | failed | cancelled)
- `createdAt` (datetime)
- `completedAt` (datetime, nullable)

### 1.4 LogEntry
- `id` (string, PK)
- `timestamp` (datetime, index)
- `level` (debug | info | warn | error)
- `category` (auth | session | command | system)
- `message` (text)
- `requestId` (nullable)

### 1.5 ServerConfig
- `key` (string, PK)
- `value` (json)
- 例: `pinHash`, `tlsFingerprint`, `rateLimitConfig`

## 2. インデックス
- `Session(deviceId, status)`
- `CommandRequest(sessionId, createdAt DESC)`
- `LogEntry(timestamp DESC)`
- `LogEntry(category, timestamp DESC)`

## 3. 保存方式
- MVP推奨: SQLite
- 簡易代替: JSONファイル

## 4. ライフサイクル
- Session/Commandはイベント駆動で状態遷移
- LogEntryは追記専用
- 古いログはローテーション（14日）

## 5. 状態遷移

### 5.1 Session
- `active -> closed`
- `active -> expired`

### 5.2 CommandRequest
- `accepted -> running`
- `running -> completed`
- `running -> failed`
- `accepted|running -> cancelled`
