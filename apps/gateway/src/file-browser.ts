import { readdir, readFile, stat } from "node:fs/promises";
import { extname, relative, resolve, sep } from "node:path";

const TEXT_PREVIEW_LIMIT = 64 * 1024;

const textExtensions = new Set([
  ".c",
  ".cc",
  ".cpp",
  ".css",
  ".go",
  ".h",
  ".html",
  ".java",
  ".js",
  ".json",
  ".jsx",
  ".md",
  ".mjs",
  ".py",
  ".rb",
  ".rs",
  ".sh",
  ".sql",
  ".svg",
  ".ts",
  ".tsx",
  ".txt",
  ".xml",
  ".yaml",
  ".yml",
]);

export type FileEntry = {
  name: string;
  path: string;
  type: "file" | "directory";
  size: number;
  modifiedAt: string;
};

const normalizeRelativePath = (rawPath?: string) => {
  const trimmed = (rawPath ?? "").trim();
  if (!trimmed || trimmed === "." || trimmed === "/") {
    return "";
  }
  return trimmed.replace(/^\/+/, "").replace(/\\/g, "/");
};

export const getWorkspaceRoot = () => resolve(process.cwd());

export const resolveWorkspacePath = (rawPath?: string) => {
  const root = getWorkspaceRoot();
  const relativePath = normalizeRelativePath(rawPath);
  const absolutePath = resolve(root, relativePath);
  const rel = relative(root, absolutePath);

  if (rel.startsWith("..") || rel === ".." || absolutePath !== root && !absolutePath.startsWith(`${root}${sep}`)) {
    throw new Error("Path is outside the workspace");
  }

  return { root, absolutePath, relativePath: rel === "" ? "" : rel.replace(/\\/g, "/") };
};

export const listWorkspaceDirectory = async (rawPath?: string) => {
  const { root, absolutePath, relativePath } = resolveWorkspacePath(rawPath);
  const info = await stat(absolutePath);
  if (!info.isDirectory()) {
    throw new Error("Path is not a directory");
  }

  const dirents = await readdir(absolutePath, { withFileTypes: true });
  const entries = await Promise.all(
    dirents
      .filter((entry) => entry.isDirectory() || entry.isFile())
      .map(async (entry) => {
        const entryPath = resolve(absolutePath, entry.name);
        const entryInfo = await stat(entryPath);
        const rel = relative(root, entryPath).replace(/\\/g, "/");
        return {
          name: entry.name,
          path: rel,
          type: entry.isDirectory() ? "directory" : "file",
          size: entryInfo.size,
          modifiedAt: entryInfo.mtime.toISOString(),
        } satisfies FileEntry;
      }),
  );

  entries.sort((a, b) => {
    if (a.type !== b.type) {
      return a.type === "directory" ? -1 : 1;
    }
    return a.name.localeCompare(b.name);
  });

  const parentPath = relativePath.includes("/")
    ? relativePath.slice(0, Math.max(relativePath.lastIndexOf("/"), 0))
    : relativePath
      ? ""
      : null;

  return {
    rootPath: root,
    currentPath: relativePath,
    parentPath,
    entries,
  };
};

const isProbablyText = (path: string, content: Buffer) => {
  if (content.includes(0)) {
    return false;
  }
  const extension = extname(path).toLowerCase();
  if (textExtensions.has(extension)) {
    return true;
  }
  return true;
};

export const readWorkspaceFile = async (rawPath?: string) => {
  const { absolutePath, relativePath } = resolveWorkspacePath(rawPath);
  const info = await stat(absolutePath);
  if (!info.isFile()) {
    throw new Error("Path is not a file");
  }

  const content = await readFile(absolutePath);
  if (!isProbablyText(absolutePath, content.subarray(0, Math.min(content.length, 4096)))) {
    throw new Error("Binary files are not previewable");
  }

  const truncated = content.length > TEXT_PREVIEW_LIMIT;
  return {
    path: relativePath,
    size: info.size,
    modifiedAt: info.mtime.toISOString(),
    truncated,
    content: content.subarray(0, TEXT_PREVIEW_LIMIT).toString("utf8"),
  };
};
