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
  const rawArgs = parseArgs(process.env.CODEX_CLI_ARGS);
  // Default to non-interactive execution mode.
  const args = rawArgs.length > 0 ? rawArgs : ["exec", "--color", "always"];
  const promptMode = (process.env.CODEX_CLI_PROMPT_MODE ?? "stdin").toLowerCase();
  const timeoutMs = Number(process.env.CODEX_CLI_TIMEOUT_MS ?? "120000");
  const usePtyEnv = (process.env.CODEX_CLI_USE_PTY ?? "").toLowerCase();
  const usePty = usePtyEnv === "1" || usePtyEnv === "true";
  return { command, args, promptMode, timeoutMs, usePty };
};

export class CliCodexAdapter implements CodexAdapter {
  async executeSync(req: ExecutionRequest): Promise<{ id: string; output: string }> {
    const { command, args, promptMode, timeoutMs, usePty } = getCliConfig();
    // if CODEX_CLI_PROMPT_MODE=stdin but no PTY requested, fall back to arg to avoid CLI TTY errors
    const effectivePromptMode = promptMode === "stdin" && !usePty ? "arg" : promptMode;
    const id = `cli-${randomUUID()}`;
    const stdinSpec = effectivePromptMode === "arg" ? "ignore" : "pipe";

    return await new Promise((resolve, reject) => {
      const finalArgs = [...args];
      if (command.endsWith("codex") && !finalArgs.includes("--color")) {
        finalArgs.push("--color", "always");
      }
      if (effectivePromptMode === "arg") {
        finalArgs.push(req.prompt);
      }

      const child = spawn(command, finalArgs, {
        stdio: [stdinSpec, "pipe", "pipe"],
        env: {
          ...process.env,
          TERM: process.env.TERM ?? "xterm-256color",
          FORCE_COLOR: "1",
          CLICOLOR_FORCE: "1",
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

      if (child.stdout) {
        child.stdout.on("data", (buf: Buffer) => {
          out += buf.toString("utf-8");
        });
      }

      if (child.stderr) {
        child.stderr.on("data", (buf: Buffer) => {
          err += buf.toString("utf-8");
        });
      }

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

      if (effectivePromptMode !== "arg" && child.stdin) {
        child.stdin.write(req.prompt);
        child.stdin.end();
      }
    });
  }

  stream(req: ExecutionRequest): EventEmitter {
    const { command, args, promptMode, timeoutMs, usePty } = getCliConfig();
    const id = `cli-${randomUUID()}`;
    const ee = new EventEmitter();
    // prevent unhandled 'error' from crashing the process if adapter emits before
    // the caller has a chance to attach listeners
    ee.on("error", () => {});
    const finalArgs = [...args];
    if (command.endsWith("codex") && !finalArgs.includes("--color")) {
      finalArgs.push("--color", "always");
    }

    // if CODEX_CLI_PROMPT_MODE=stdin but no PTY requested, fall back to arg to avoid CLI TTY errors
    const effectivePromptMode = promptMode === "stdin" && !usePty ? "arg" : promptMode;
    const stdinSpec = effectivePromptMode === "arg" ? "ignore" : "pipe";

    if (effectivePromptMode === "arg") {
      finalArgs.push(req.prompt);
    }

    const child = spawn(command, finalArgs, {
      stdio: [stdinSpec, "pipe", "pipe"],
      env: {
        ...process.env,
        TERM: process.env.TERM ?? "xterm-256color",
        FORCE_COLOR: "1",
        CLICOLOR_FORCE: "1",
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
        setImmediate(() => ee.emit("error", { code: "TIMEOUT", message: `codex cli timed out after ${timeoutMs}ms` }));
      }
    }, timeoutMs);

    if (child.stdout) {
      child.stdout.on("data", (buf: Buffer) => {
        const text = buf.toString("utf-8");
        if (!text) return;
        seq += 1;
        setImmediate(() => ee.emit("data", { seq, text }));
      });
    }

    if (child.stderr) {
      child.stderr.on("data", (buf: Buffer) => {
        const text = buf.toString("utf-8");
        stderrText += text;
        if (text) {
          seq += 1;
          setImmediate(() => ee.emit("data", { seq, text }));
        }
      });
    }

    child.on("error", (e) => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      setImmediate(() => ee.emit("error", { code: "SPAWN_ERROR", message: e.message }));
    });

    child.on("close", (code) => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      if (code === 0) {
        setImmediate(() => ee.emit("done", { id }));
        return;
      }
      setImmediate(() =>
        ee.emit("error", {
          code: "PROCESS_EXIT",
          message: `codex cli exited with code ${String(code)}${stderrText ? `: ${stderrText.trim()}` : ""}`,
        }),
      );
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

    if (effectivePromptMode !== "arg" && child.stdin) {
      child.stdin.write(req.prompt);
      child.stdin.end();
    }

    return ee;
  }
}
