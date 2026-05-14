# Codex Interface 技術選定（MVP確定案）

最終更新: 2026-05-14

## 1. 結論（MVP）
- Backend: Node.js 22 + TypeScript + Fastify + ws
- Mobile: React + Vite + PWA（モバイルWeb）
- Storage: SQLite（better-sqlite3）
- Discovery: Avahi/Bonjour互換 mDNS（Nodeのbonjour系ライブラリ）
- Auth: PIN + JWT（jose）

## 2. 採用理由
- Node.jsでREST/WSを同一ランタイムで実装しやすい
- TypeScriptでAPI契約の型安全を確保
- PWAならiOS/Android両対応を最短で実現
- SQLiteは導入容易でログ・設定保存に十分

## 3. 比較（候補）

### 3.1 Backend
- Node.js + Fastify: 採用
  - 利点: 高速、プラグイン豊富、WS連携容易
- Python + FastAPI: 今回見送り
  - 利点: 実装容易
  - 課題: WS/実行制御/型共有を統一する運用コスト

### 3.2 Mobile
- PWA (React): 採用
  - 利点: ストア配布なし、LAN検証が早い
- React Native: 次フェーズ
  - 利点: ネイティブ体験
  - 課題: 初期構築と署名運用

## 4. 想定パッケージ
- サーバ: `fastify`, `@fastify/cors`, `ws`, `zod`, `jose`, `better-sqlite3`, `pino`
- フロント: `react`, `react-router-dom`, `zustand`, `vite`, `workbox`

## 5. リスクと回避
- iOSで自己署名TLSの扱いが難しい
  - 回避: 開発時はHTTP+LAN限定、運用時は証明書導入
- mDNSが環境依存
  - 回避: 手動IP入力を常設
