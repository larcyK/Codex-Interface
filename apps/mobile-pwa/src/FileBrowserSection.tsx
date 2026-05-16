import { useMemo, useState } from "react";

type FileEntry = {
  name: string;
  path: string;
  type: "file" | "directory";
  size: number;
  modifiedAt: string;
};

type FileBrowserData = {
  rootPath: string;
  currentPath: string;
  parentPath: string | null;
  entries: FileEntry[];
};

type FilePreview = {
  path: string;
  size: number;
  modifiedAt: string;
  truncated: boolean;
  content: string;
};

type Props = {
  browserData: FileBrowserData | null;
  selectedFile: FilePreview | null;
  browserError: string;
  isBrowsing: boolean;
  isLoadingFile: boolean;
  onRefresh: () => Promise<void>;
  onOpenDirectory: (path: string) => Promise<void>;
  onOpenParent: () => Promise<void>;
  onOpenFile: (path: string) => Promise<void>;
};

const formatSize = (size: number) => {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
};

const formatStamp = (value: string) => new Date(value).toLocaleString();

const buildBreadcrumbs = (path: string) => {
  const segments = path.split("/").filter(Boolean);
  return [
    { label: "root", path: "" },
    ...segments.map((segment, index) => ({
      label: segment,
      path: segments.slice(0, index + 1).join("/"),
    })),
  ];
};

export function FileBrowserSection({
  browserData,
  selectedFile,
  browserError,
  isBrowsing,
  isLoadingFile,
  onRefresh,
  onOpenDirectory,
  onOpenParent,
  onOpenFile,
}: Props) {
  const [query, setQuery] = useState("");

  const breadcrumbs = useMemo(
    () => buildBreadcrumbs(browserData?.currentPath ?? ""),
    [browserData?.currentPath],
  );

  const filteredEntries = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const entries = browserData?.entries ?? [];
    if (!normalized) {
      return entries;
    }
    return entries.filter((entry) => {
      const haystack = `${entry.name} ${entry.path}`.toLowerCase();
      return haystack.includes(normalized);
    });
  }, [browserData?.entries, query]);

  const selectedFileName = selectedFile?.path.split("/").pop() ?? "";

  return (
    <section className="card file-browser-card">
      <div className="file-browser-toolbar">
        <div className="file-browser-heading">
          <h2>ワークスペースファイル</h2>
          <p className="mono file-browser-root">Root: {browserData?.rootPath ?? "未接続"}</p>
        </div>
        <div className="file-browser-actions">
          <button onClick={onOpenParent} disabled={!browserData || browserData.parentPath === null || isBrowsing}>
            上へ
          </button>
          <button onClick={onRefresh} disabled={isBrowsing}>
            {isBrowsing ? "更新中..." : "更新"}
          </button>
        </div>
      </div>

      <div className="file-browser-breadcrumbs" aria-label="current path">
        {breadcrumbs.map((crumb) => (
          <button
            key={crumb.path || "root"}
            className={`file-browser-crumb ${crumb.path === (browserData?.currentPath ?? "") ? "is-active" : ""}`}
            onClick={() => onOpenDirectory(crumb.path)}
            disabled={!browserData || isBrowsing}
          >
            <span className="mono">{crumb.label}</span>
          </button>
        ))}
      </div>

      <div className="file-browser-layout">
        <div className="file-browser-pane file-browser-pane-list">
          <div className="file-browser-pane-header">
            <div>
              <strong>一覧</strong>
              <p className="mono file-browser-pane-subtitle">
                {filteredEntries.length} / {browserData?.entries.length ?? 0} entries
              </p>
            </div>
            <input
              className="file-browser-search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="名前で絞り込み"
            />
          </div>

          <div className="file-browser-list">
            {!browserData ? (
              <p className="mono file-browser-empty">まだ読み込んでいません。</p>
            ) : filteredEntries.length === 0 ? (
              <p className="mono file-browser-empty">
                {browserData.entries.length === 0 ? "このディレクトリは空です。" : "一致する項目がありません。"}
              </p>
            ) : (
              filteredEntries.map((entry) => {
                const isDirectory = entry.type === "directory";
                return (
                  <button
                    key={entry.path}
                    className={`file-browser-entry ${isDirectory ? "is-directory" : "is-file"} ${selectedFile?.path === entry.path ? "is-selected" : ""}`}
                    onClick={() => (isDirectory ? onOpenDirectory(entry.path) : onOpenFile(entry.path))}
                  >
                    <span className={`file-browser-entry-glyph ${isDirectory ? "is-directory" : "is-file"}`}>
                      {isDirectory ? "DIR" : "FILE"}
                    </span>
                    <span className="file-browser-entry-main">
                      <span className="mono file-browser-entry-name">{entry.name}</span>
                      <span className="mono file-browser-entry-detail">
                        {isDirectory ? "directory" : formatSize(entry.size)}
                        {" · "}
                        {formatStamp(entry.modifiedAt)}
                      </span>
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </div>

        <div className="file-browser-pane file-browser-pane-preview">
          <div className="file-browser-pane-header">
            <div>
              <strong>{selectedFileName || "プレビュー"}</strong>
              <p className="mono file-browser-pane-subtitle">
                {isLoadingFile ? "loading..." : selectedFile?.path || "ファイルを選択してください"}
              </p>
            </div>
            {selectedFile && (
              <div className="mono file-browser-preview-badges">
                <span>{formatSize(selectedFile.size)}</span>
                {selectedFile.truncated && <span>truncated</span>}
              </div>
            )}
          </div>

          {browserError && <p className="file-browser-error">{browserError}</p>}

          {!selectedFile ? (
            <div className="file-browser-preview-empty">
              <p className="mono">左側でファイルを選ぶと、ここに内容を表示します。</p>
              <p className="mono">ディレクトリはそのまま開きます。</p>
            </div>
          ) : (
            <>
              <div className="file-browser-preview-meta mono">
                <span>updated {formatStamp(selectedFile.modifiedAt)}</span>
              </div>
              <pre className="mono file-browser-preview">{selectedFile.content}</pre>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
