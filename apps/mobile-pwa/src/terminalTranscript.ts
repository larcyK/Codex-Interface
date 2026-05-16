export type TerminalBlockKind = "meta" | "thinking" | "output";

export type TerminalBlock = {
  id: string;
  kind: TerminalBlockKind;
  title: string;
  content: string;
  lineCount: number;
  defaultOpen: boolean;
};

type AnsiState = {
  fg: string | null;
  bold: boolean;
  dim: boolean;
};

const ANSI_ESCAPE_RE = /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g;
const ANSI_SGR_RE = /\x1b\[([0-9;]*)m/g;
const META_LINE_RE = /^\[(local|ws open|ws closed|done|error|raw|connect failed|cancel requested|ws error)\]/i;
const HEADER_LINE_RE = /^(OpenAI Codex|Model:|Directory:|Safety:|Session:|Permission mode:)/i;
const SESSION_INFO_LINE_RE = /^(provider:|approval:|sandbox:|reasoning effort:|reasoning summaries:|session id:)/i;
const ROLE_LINE_RE = /^(user|assistant|codex)$/i;
const THINKING_LINE_RE = /^(thinking|reasoning|analysis|plan|searching|reading|inspecting|editing|running|patching|diffing|tool\b)/i;
const ANSI_FG_CLASS: Record<number, string> = {
  30: "ansi-fg-black",
  31: "ansi-fg-red",
  32: "ansi-fg-green",
  33: "ansi-fg-yellow",
  34: "ansi-fg-blue",
  35: "ansi-fg-magenta",
  36: "ansi-fg-cyan",
  37: "ansi-fg-white",
  90: "ansi-fg-bright-black",
  91: "ansi-fg-bright-red",
  92: "ansi-fg-bright-green",
  93: "ansi-fg-bright-yellow",
  94: "ansi-fg-bright-blue",
  95: "ansi-fg-bright-magenta",
  96: "ansi-fg-bright-cyan",
  97: "ansi-fg-bright-white",
};

export const stripAnsi = (text: string) => text.replace(ANSI_ESCAPE_RE, "");

const applyAnsiCode = (state: AnsiState, code: number): AnsiState => {
  if (code === 0) {
    return { fg: null, bold: false, dim: false };
  }
  if (code === 1) {
    return { ...state, bold: true, dim: false };
  }
  if (code === 2) {
    return { ...state, dim: true, bold: false };
  }
  if (code === 22) {
    return { ...state, bold: false, dim: false };
  }
  if (code === 39) {
    return { ...state, fg: null };
  }
  if (code in ANSI_FG_CLASS) {
    return { ...state, fg: ANSI_FG_CLASS[code] };
  }
  return state;
};

export const parseAnsiLine = (line: string): Array<{ text: string; className: string }> => {
  const spans: Array<{ text: string; className: string }> = [];
  let state: AnsiState = { fg: null, bold: false, dim: false };
  let lastIndex = 0;

  for (const match of line.matchAll(ANSI_SGR_RE)) {
    const index = match.index ?? 0;
    if (index > lastIndex) {
      const text = line.slice(lastIndex, index);
      const classes = [state.fg, state.bold ? "ansi-bold" : "", state.dim ? "ansi-dim" : ""].filter(Boolean).join(" ");
      spans.push({ text, className: classes });
    }
    const codes = (match[1] || "0")
      .split(";")
      .map((part) => Number(part || "0"))
      .filter((code) => Number.isFinite(code));
    for (const code of codes) {
      state = applyAnsiCode(state, code);
    }
    lastIndex = index + match[0].length;
  }

  if (lastIndex < line.length) {
    const text = line.slice(lastIndex);
    const classes = [state.fg, state.bold ? "ansi-bold" : "", state.dim ? "ansi-dim" : ""].filter(Boolean).join(" ");
    spans.push({ text, className: classes });
  }

  if (spans.length === 0) {
    spans.push({ text: stripAnsi(line), className: "" });
  }

  return spans;
};

const getBlockKind = (line: string, currentKind: TerminalBlockKind | null): TerminalBlockKind => {
  const trimmed = stripAnsi(line).trim();
  if (!trimmed) {
    return currentKind ?? "meta";
  }
  if (META_LINE_RE.test(trimmed) || HEADER_LINE_RE.test(trimmed) || SESSION_INFO_LINE_RE.test(trimmed)) {
    return "meta";
  }
  if (ROLE_LINE_RE.test(trimmed)) {
    return "output";
  }
  if (THINKING_LINE_RE.test(trimmed)) {
    return "thinking";
  }
  if (currentKind === "thinking" && !ROLE_LINE_RE.test(trimmed) && !SESSION_INFO_LINE_RE.test(trimmed) && !META_LINE_RE.test(trimmed)) {
    return "thinking";
  }
  return "output";
};

const buildTerminalBlock = (kind: TerminalBlockKind, lines: string[], index: number): TerminalBlock => {
  const rawContent = lines.join("\n").trimEnd();
  const content = kind === "output" ? extractDisplayOutput(rawContent) : rawContent;
  const lineCount = lines.filter((line) => stripAnsi(line).trim().length > 0).length || 1;
  const firstLine = lines.find((line) => stripAnsi(line).trim().length > 0)?.trim() ?? "";

  let title = "Output";
  let defaultOpen = true;
  if (kind === "meta") {
    title = firstLine.startsWith("[error]") ? "Transport / status errors" : "Session / transport log";
    defaultOpen = false;
  } else if (kind === "thinking") {
    title = "Reasoning / work log";
    defaultOpen = false;
  } else if (firstLine.startsWith("OpenAI Codex")) {
    title = "CLI banner";
  }

  return {
    id: `${kind}-${index}`,
    kind,
    title,
    content,
    lineCount: content.split("\n").filter((line) => line.trim().length > 0).length || lineCount,
    defaultOpen,
  };
};

export const buildTerminalBlocks = (streamOutput: string): TerminalBlock[] => {
  const normalized = streamOutput.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
  if (!normalized) {
    return [];
  }

  const lines = normalized.split("\n");
  const blocks: TerminalBlock[] = [];
  let currentKind: TerminalBlockKind | null = null;
  let currentLines: string[] = [];

  const flush = () => {
    if (currentKind && currentLines.length > 0) {
      blocks.push(buildTerminalBlock(currentKind, currentLines, blocks.length));
    }
    currentKind = null;
    currentLines = [];
  };

  for (const line of lines) {
    const nextKind = getBlockKind(line, currentKind);
    if (currentKind && nextKind !== currentKind && line.trim()) {
      flush();
    }
    currentKind = nextKind;
    currentLines.push(line);
  }

  flush();
  return blocks;
};

export const extractDisplayOutput = (rawOutput: string): string => {
  const normalized = stripAnsi(rawOutput).replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
  if (!normalized) {
    return "";
  }

  const lines = normalized.split("\n");
  const tokensUsedIndex = lines.findIndex((line) => line.trim() === "tokens used");
  const codexLineIndex = lines.findIndex((line) => ROLE_LINE_RE.test(line.trim()) && line.trim().toLowerCase() === "codex");

  if (codexLineIndex >= 0) {
    const answerEndIndex = tokensUsedIndex > codexLineIndex ? tokensUsedIndex : lines.length;
    const assistantBody = lines.slice(codexLineIndex + 1, answerEndIndex).join("\n").trim();
    if (assistantBody) {
      return assistantBody;
    }
  }

  if (tokensUsedIndex >= 0) {
    const tailStart = lines.findIndex((line, index) => index > tokensUsedIndex + 1 && line.trim().length > 0);
    if (tailStart >= 0) {
      return lines.slice(tailStart).join("\n").trim();
    }
  }

  return normalized;
};
