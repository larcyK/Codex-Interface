import EventEmitter from "node:events";
import mockCodex from "./codex-adapter-mock.js";
import { CliCodexAdapter } from "./codex-adapter-cli.js";

export type ExecutionRequest = {
  model: string;
  prompt: string;
  maxTokens?: number;
  temperature?: number;
  metadata?: Record<string, unknown>;
  resumeSessionId?: string;
};

export type StreamChunk = {
  seq: number;
  text: string;
};

export interface CodexAdapter {
  executeSync(req: ExecutionRequest): Promise<{ id: string; output: string }>;
  stream(req: ExecutionRequest): EventEmitter;
}

const cliAdapter = new CliCodexAdapter();

export const getAdapterByName = (name?: string) => {
  const raw = (name ?? "").toLowerCase();
  if (raw === "cli") return cliAdapter;
  return getCodexAdapter();
};

export const getCodexBackendName = (): "mock" | "cli" => {
  const raw = (process.env.CODEX_BACKEND ?? "mock").toLowerCase();
  return raw === "cli" ? "cli" : "mock";
};

export const getCodexAdapter = (): CodexAdapter => {
  return getCodexBackendName() === "cli" ? cliAdapter : mockCodex;
};

export { cliAdapter };
