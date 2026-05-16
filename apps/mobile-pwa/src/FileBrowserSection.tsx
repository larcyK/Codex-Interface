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
  return (
    <section className="card">
      <div className="file-browser-header">
        <div>
          <h2>ワークスペースファイル</h2>
          <p className="mono file-browser-path">
            {browserData ? `cwd: /${browserData.currentPath || ""}` : "cwd: /"}
          </p>
        </div>
        <div className="row">
          <button onClick={onOpenParent} disabled={!browserData || browserData.parentPath === null || isBrowsing}>
            上へ
          </button>
          <button onClick={onRefresh} disabled={isBrowsing}>
            {isBrowsing ? "更新中..." : "更新"}
          </button>
        </div>
      </div>

      {browserData && (
        <p className="mono file-browser-root">Root: {browserData.rootPath}</p>
      )}
      {browserError && <p className="file-browser-error">{browserError}</p>}

      <div className="file-browser-layout">
        <div className="file-browser-pane">
          <div className="file-browser-pane-header">
            <strong>一覧</strong>
            <span className="mono">{browserData?.entries.length ?? 0} entries</span>
          </div>
          <div className="file-browser-list">
            {!browserData ? (
              <p className="mono file-browser-empty">まだ読み込んでいません。</p>
            ) : browserData.entries.length === 0 ? (
              <p className="mono file-browser-empty">このディレクトリは空です。</p>
            ) : (
              browserData.entries.map((entry) => {
                const isDirectory = entry.type === "directory";
                return (
                  <button
                    key={entry.path}
                    className={`file-browser-entry ${isDirectory ? "is-directory" : "is-file"} ${selectedFile?.path === entry.path ? "is-selected" : ""}`}
                    onClick={() => (isDirectory ? onOpenDirectory(entry.path) : onOpenFile(entry.path))}
                  >
                    <span className="mono file-browser-entry-name">
                      {isDirectory ? "[dir]" : "[file]"} {entry.name}
                    </span>
                    <span className="mono file-browser-entry-meta">
                      {isDirectory ? "dir" : formatSize(entry.size)}
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </div>

        <div className="file-browser-pane">
          <div className="file-browser-pane-header">
            <strong>プレビュー</strong>
            <span className="mono">{isLoadingFile ? "loading..." : selectedFile ? selectedFile.path : "no file"}</span>
          </div>
          {!selectedFile ? (
            <p className="mono file-browser-empty">ファイルを選ぶと内容を表示します。</p>
          ) : (
            <>
              <div className="file-browser-preview-meta mono">
                <span>{formatSize(selectedFile.size)}</span>
                <span>{new Date(selectedFile.modifiedAt).toLocaleString()}</span>
                {selectedFile.truncated && <span>preview truncated</span>}
              </div>
              <pre className="mono file-browser-preview">{selectedFile.content}</pre>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
