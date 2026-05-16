import type { RefCallback } from "react";
import { parseAnsiLine, type TerminalBlock } from "./terminalTranscript";

type Props = {
  terminalStatus: string;
  terminalView: "compact" | "split" | "raw";
  setTerminalView: (view: "compact" | "split" | "raw") => void;
  compactBlocks: TerminalBlock[];
  terminalHostRef: RefCallback<HTMLDivElement>;
  chatInput: string;
  setChatInput: (value: string) => void;
  token: string;
  isStreaming: boolean;
  sendChatMessage: () => Promise<void>;
  cancelCodexStream: () => void;
  clearTerminalView: () => void;
  modelInput: string;
  setModelInput: (value: string) => void;
  backendChoice: "mock" | "cli";
  setBackendChoice: (value: "mock" | "cli") => void;
  promptInput: string;
  setPromptInput: (value: string) => void;
  startCodexStream: () => Promise<void>;
  fetchStreamHistory: () => Promise<void>;
};

export function CodexTerminalSection({
  terminalStatus,
  terminalView,
  setTerminalView,
  compactBlocks,
  terminalHostRef,
  chatInput,
  setChatInput,
  token,
  isStreaming,
  sendChatMessage,
  cancelCodexStream,
  clearTerminalView,
  modelInput,
  setModelInput,
  backendChoice,
  setBackendChoice,
  promptInput,
  setPromptInput,
  startCodexStream,
  fetchStreamHistory,
}: Props) {
  return (
    <section className="card">
      <h2>Codex Terminal</h2>
      <p className="mono">status: {terminalStatus}</p>
      <div className="row terminal-view-toggle">
        <button className={terminalView === "compact" ? "is-active" : ""} onClick={() => setTerminalView("compact")}>
          Compact
        </button>
        <button className={terminalView === "split" ? "is-active" : ""} onClick={() => setTerminalView("split")}>
          Split
        </button>
        <button className={terminalView === "raw" ? "is-active" : ""} onClick={() => setTerminalView("raw")}>
          Raw Terminal
        </button>
      </div>
      {(terminalView === "compact" || terminalView === "split") && (
        <div className="terminal-compact">
          {compactBlocks.length === 0 ? (
            <p className="mono terminal-empty">No transcript yet.</p>
          ) : (
            compactBlocks.map((block) => {
              const lines = block.content.split("\n");
              return (
                <details key={block.id} className={`terminal-block terminal-block-${block.kind}`} open={block.defaultOpen}>
                  <summary>
                    <span>{block.title}</span>
                    <span className="mono terminal-block-meta">{block.lineCount} lines</span>
                  </summary>
                  <pre className="mono terminal-block-content">
                    {lines.map((line, lineIndex) => (
                      <span key={`${block.id}-${lineIndex}`} className="terminal-block-line">
                        {parseAnsiLine(line).map((span, spanIndex) => (
                          <span key={`${block.id}-${lineIndex}-${spanIndex}`} className={span.className}>
                            {span.text}
                          </span>
                        ))}
                        {lineIndex < lines.length - 1 ? "\n" : ""}
                      </span>
                    ))}
                  </pre>
                </details>
              );
            })
          )}
        </div>
      )}
      {(terminalView === "raw" || terminalView === "split") && (
        <div className="terminal-frame">
          <div className="terminal-chrome">
            <div className="terminal-lights" aria-hidden="true">
              <span className="terminal-light terminal-light-close" />
              <span className="terminal-light terminal-light-minimize" />
              <span className="terminal-light terminal-light-expand" />
            </div>
            <div className="terminal-title mono">codex / interactive stream</div>
            <div className="terminal-shell mono">zsh</div>
          </div>
          <div ref={terminalHostRef} className="terminal-host" />
        </div>
      )}
      <div className="row terminal-actions">
        <input
          style={{ flex: 1 }}
          value={chatInput}
          onChange={(e) => setChatInput(e.target.value)}
          placeholder="Send a prompt to Codex..."
        />
        <button onClick={sendChatMessage} disabled={!token || !chatInput.trim() || isStreaming}>Send</button>
        <button onClick={cancelCodexStream} disabled={!isStreaming}>Cancel</button>
        <button onClick={clearTerminalView}>Clear</button>
      </div>
      <label>
        Model
        <input value={modelInput} onChange={(e) => setModelInput(e.target.value)} />
      </label>
      <label>
        Backend
        <select value={backendChoice} onChange={(e) => setBackendChoice(e.target.value as "mock" | "cli")}>
          <option value="cli">cli</option>
          <option value="mock">mock</option>
        </select>
      </label>
      <label>
        Prompt
        <input value={promptInput} onChange={(e) => setPromptInput(e.target.value)} />
      </label>
      <div className="row">
        <button onClick={startCodexStream} disabled={isStreaming}>Run Prompt</button>
        <button onClick={fetchStreamHistory}>履歴を取得</button>
      </div>
    </section>
  );
}
