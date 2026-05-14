import { randomUUID } from "node:crypto";
import EventEmitter from "node:events";
import { spawn } from "node:child_process";
import type { CodexAdapter, ExecutionRequest } from "./codex-adapter.js";

const parseArgs = (raw?: string): string[] => {
  if (!raw) return [];
  const trimmed = raw.trim();
  if (!trimmed) return [];
  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed) && parsed.every((x) => typeof x === "string")) {
      return parsed;
    }
  } catch {
    // fall back to whitespace split
  }
  return trimmed.split(/\s+/g).filter(Boolean);
};

const getCliConfig = () => {
  const command = process.env.CODEX_CLI_COMMAND ?? "codex";
  const args = parseArgs(process.env.CODEX_CLI_ARGS);
  const promptMode = (process.env.CODEX_CLI_PROMPT_MODE ?? "stdin").toLowerCase();
  const timeoutMs = Number(process.env.CODEX_CLI_TIMEOUT_MS ?? "120000");
  return { command, args, promptMode, timeoutMs };
};

export class CliCodexAdapter implements CodexAdapter {
  async executeSync(req: ExecutionRequest): Promise<{ id: string; output: string }> {
    const { command, args, promptMode, timeoutMs } = getCliConfig();
    const id = `cli-${randomUUID()}`;

    return await new Promise((resolve, reject) => {
      const finalArgs = [...args];
      if (promptMode === "arg") {
        finalArgs.push(req.prompt);
      }

      const child = spawn(command, finalArgs, {
        stdio: ["pipe", "pipe", "pipe"],
        env: {
          ...process.env,
          CODEX_MODEL: req.model,
          CODEX_MAX_TOKENS: String(req.maxTokens ?? ""),
          CODEX_TEMPERATURE: String(req.temperature ?? ""),
        },
      });

      let out = "";
      let err = "";

      const timeout = setTimeout(() => {
        child.kill("SIGKILL");
        reject(new Error(`codex cli timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      child.stdout.on("data", (buf: Buffer) => {
        out += buf.toString("utf-8");
      });

      child.stderr.on("data", (buf: Buffer) => {
        err += buf.toString("utf-8");
      });

      child.on("error", (e) => {
        clearTimeout(timeout);
        reject(e);
      });

      child.on("close", (code) => {
        clearTimeout(timeout);
        if (code === 0) {
          resolve({ id, output: out.trimEnd() });
          return;
        }
        reject(new Error(`codex cli exited with code ${String(code)}${err ? `: ${err.trim()}` : ""}`));
      });

      if (promptMode !== "arg") {
        child.stdin.write(req.prompt);
        child.stdin.end();
      }
    });
  }

  stream(req: ExecutionRequest): EventEmitter {
    const { command, args, promptMode, timeoutMs } = getCliConfig();
    const id = `cli-${randomUUID()}`;
    const ee = new EventEmitter();
    const finalArgs = [...args];

    if (promptMode === "arg") {
      finalArgs.push(req.prompt);
    }

    const child = spawn(command, finalArgs, {
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        CODEX_MODEL: req.model,
        CODEX_MAX_TOKENS: String(req.maxTokens ?? ""),
        CODEX_TEMPERATURE: String(req.temperature ?? ""),
      },
    });

    let seq = 0;
    let finished = false;
    let stderrText = "";

    const timeout = setTimeout(() => {
      if (!finished) {
        child.kill("SIGKILL");
        ee.emit("error", { code: "TIMEOUT", message: `codex cli timed out after ${timeoutMs}ms` });
      }
    }, timeoutMs);

    child.stdout.on("data", (buf: Buffer) => {
      const text = buf.toString("utf-8");
      if (!text) return;
      seq += 1;
      ee.emit("data", { seq, text });
    });

    child.stderr.on("data", (buf: Buffer) => {
      stderrText += buf.toString("utf-8");
    });

    child.on("error", (e) => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      ee.emit("error", { code: "SPAWN_ERROR", message: e.message });
    });

    child.on("close", (code) => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      if (code === 0) {
        ee.emit("done", { id });
        return;
      }
      ee.emit("error", {
        code: "PROCESS_EXIT",
        message: `codex cli exited with code ${String(code)}${stderrText ? `: ${stderrText.trim()}` : ""}`,
      });
    });

    ee.once("cancel", () => {
      if (finished) return;
      child.kill("SIGINT");
      setTimeout(() => {
        if (!finished) {
          child.kill("SIGKILL");
        }
      }, 2000);
    });

    if (promptMode !== "arg") {
      child.stdin.write(req.prompt);
      child.stdin.end();
    }

    return ee;
  }
}
