import EventEmitter from "events";

export type ExecutionRequest = {
  model: string;
  prompt: string;
  maxTokens?: number;
  temperature?: number;
  metadata?: Record<string, unknown>;
};

export type StreamChunk = {
  seq: number;
  text: string;
};

class MockCodexAdapter {
  // Synchronous-like execution (returns full output)
  async executeSync(req: ExecutionRequest): Promise<{ id: string; output: string }> {
    const id = `mock-${Date.now()}`;
    // Simple deterministic echo with minor transform for testing
    const output = `ECHO[${req.model}]: ${req.prompt.slice(0, 200)}`;
    return { id, output };
  }

  // Streaming execution: returns an EventEmitter that emits 'data' with StreamChunk
  stream(req: ExecutionRequest): EventEmitter {
    const id = `mock-${Date.now()}`;
    const ee = new EventEmitter();

    // Simulate async chunked output
    const text = `Streaming response for model ${req.model}: ${req.prompt}`;
    const words = text.split(/\s+/);

    let seq = 0;
    const timers: NodeJS.Timeout[] = [];

    words.forEach((w, i) => {
      const t = setTimeout(() => {
        seq += 1;
        ee.emit("data", { seq, text: (i === 0 ? "" : " ") + w });
        if (i === words.length - 1) {
          ee.emit("done", { id });
        }
      }, 50 * i);
      timers.push(t);
    });

    // attach a cancel handler
    ee.once("cancel", () => {
      timers.forEach((t) => clearTimeout(t));
      ee.emit("error", { code: "CANCELLED", message: "stream cancelled" });
    });

    return ee;
  }
}

export default new MockCodexAdapter();
