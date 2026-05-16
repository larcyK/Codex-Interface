import { useCallback, useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";

export const useXtermTerminal = () => {
  const [terminalHost, setTerminalHost] = useState<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const transcriptRef = useRef("");
  const [streamOutput, setStreamOutput] = useState("");
  const terminalHostRef = useCallback((node: HTMLDivElement | null) => {
    setTerminalHost(node);
  }, []);

  const appendTerminal = useCallback((text: string) => {
    transcriptRef.current += text;
    setStreamOutput(transcriptRef.current);
    terminalRef.current?.write(text);
  }, []);

  const resetTerminal = useCallback(() => {
    transcriptRef.current = "";
    setStreamOutput("");
    if (terminalRef.current) {
      terminalRef.current.reset();
      terminalRef.current.clear();
    }
  }, []);

  const clearTerminalView = useCallback(() => {
    resetTerminal();
    terminalRef.current?.writeln("Codex terminal cleared.");
    terminalRef.current?.writeln("");
  }, [resetTerminal]);

  const fitTerminal = useCallback(() => {
    fitAddonRef.current?.fit();
  }, []);

  useEffect(() => {
    if (!terminalHost || terminalRef.current) return;

    const fitAddon = new FitAddon();
    const term = new Terminal({
      convertEol: true,
      disableStdin: true,
      cursorBlink: true,
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
      fontSize: 13,
      lineHeight: 1.35,
      theme: {
        background: "#0b1220",
        foreground: "#dbe7ff",
        cursor: "#93c5fd",
        selectionBackground: "rgba(147, 197, 253, 0.28)",
      },
    });

    term.loadAddon(fitAddon);
    term.open(terminalHost);
    fitAddon.fit();
    term.writeln("Codex terminal ready.");
    term.writeln("");

    terminalRef.current = term;
    fitAddonRef.current = fitAddon;

    const handleResize = () => fitAddon.fit();
    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      term.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
    };
  }, [terminalHost]);

  return {
    terminalHostRef,
    streamOutput,
    appendTerminal,
    resetTerminal,
    clearTerminalView,
    fitTerminal,
  };
};
