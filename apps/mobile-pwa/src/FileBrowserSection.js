import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useMemo, useState } from "react";
const formatSize = (size) => {
    if (size < 1024)
        return `${size} B`;
    if (size < 1024 * 1024)
        return `${(size / 1024).toFixed(1)} KB`;
    return `${(size / (1024 * 1024)).toFixed(1)} MB`;
};
const formatStamp = (value) => new Date(value).toLocaleString();
const buildBreadcrumbs = (path) => {
    const segments = path.split("/").filter(Boolean);
    return [
        { label: "root", path: "" },
        ...segments.map((segment, index) => ({
            label: segment,
            path: segments.slice(0, index + 1).join("/"),
        })),
    ];
};
export function FileBrowserSection({ browserData, selectedFile, browserError, isBrowsing, isLoadingFile, onRefresh, onOpenDirectory, onOpenParent, onOpenFile, }) {
    const [query, setQuery] = useState("");
    const breadcrumbs = useMemo(() => buildBreadcrumbs(browserData?.currentPath ?? ""), [browserData?.currentPath]);
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
    return (_jsxs("section", { className: "card file-browser-card", children: [_jsxs("div", { className: "file-browser-toolbar", children: [_jsxs("div", { className: "file-browser-heading", children: [_jsx("h2", { children: "\u30EF\u30FC\u30AF\u30B9\u30DA\u30FC\u30B9\u30D5\u30A1\u30A4\u30EB" }), _jsxs("p", { className: "mono file-browser-root", children: ["Root: ", browserData?.rootPath ?? "未接続"] })] }), _jsxs("div", { className: "file-browser-actions", children: [_jsx("button", { onClick: onOpenParent, disabled: !browserData || browserData.parentPath === null || isBrowsing, children: "\u4E0A\u3078" }), _jsx("button", { onClick: onRefresh, disabled: isBrowsing, children: isBrowsing ? "更新中..." : "更新" })] })] }), _jsx("div", { className: "file-browser-breadcrumbs", "aria-label": "current path", children: breadcrumbs.map((crumb) => (_jsx("button", { className: `file-browser-crumb ${crumb.path === (browserData?.currentPath ?? "") ? "is-active" : ""}`, onClick: () => onOpenDirectory(crumb.path), disabled: !browserData || isBrowsing, children: _jsx("span", { className: "mono", children: crumb.label }) }, crumb.path || "root"))) }), _jsxs("div", { className: "file-browser-layout", children: [_jsxs("div", { className: "file-browser-pane file-browser-pane-list", children: [_jsxs("div", { className: "file-browser-pane-header", children: [_jsxs("div", { children: [_jsx("strong", { children: "\u4E00\u89A7" }), _jsxs("p", { className: "mono file-browser-pane-subtitle", children: [filteredEntries.length, " / ", browserData?.entries.length ?? 0, " entries"] })] }), _jsx("input", { className: "file-browser-search", value: query, onChange: (e) => setQuery(e.target.value), placeholder: "\u540D\u524D\u3067\u7D5E\u308A\u8FBC\u307F" })] }), _jsx("div", { className: "file-browser-list", children: !browserData ? (_jsx("p", { className: "mono file-browser-empty", children: "\u307E\u3060\u8AAD\u307F\u8FBC\u3093\u3067\u3044\u307E\u305B\u3093\u3002" })) : filteredEntries.length === 0 ? (_jsx("p", { className: "mono file-browser-empty", children: browserData.entries.length === 0 ? "このディレクトリは空です。" : "一致する項目がありません。" })) : (filteredEntries.map((entry) => {
                                    const isDirectory = entry.type === "directory";
                                    return (_jsxs("button", { className: `file-browser-entry ${isDirectory ? "is-directory" : "is-file"} ${selectedFile?.path === entry.path ? "is-selected" : ""}`, onClick: () => (isDirectory ? onOpenDirectory(entry.path) : onOpenFile(entry.path)), children: [_jsx("span", { className: `file-browser-entry-glyph ${isDirectory ? "is-directory" : "is-file"}`, children: isDirectory ? "DIR" : "FILE" }), _jsxs("span", { className: "file-browser-entry-main", children: [_jsx("span", { className: "mono file-browser-entry-name", children: entry.name }), _jsxs("span", { className: "mono file-browser-entry-detail", children: [isDirectory ? "directory" : formatSize(entry.size), " · ", formatStamp(entry.modifiedAt)] })] })] }, entry.path));
                                })) })] }), _jsxs("div", { className: "file-browser-pane file-browser-pane-preview", children: [_jsxs("div", { className: "file-browser-pane-header", children: [_jsxs("div", { children: [_jsx("strong", { children: selectedFileName || "プレビュー" }), _jsx("p", { className: "mono file-browser-pane-subtitle", children: isLoadingFile ? "loading..." : selectedFile?.path || "ファイルを選択してください" })] }), selectedFile && (_jsxs("div", { className: "mono file-browser-preview-badges", children: [_jsx("span", { children: formatSize(selectedFile.size) }), selectedFile.truncated && _jsx("span", { children: "truncated" })] }))] }), browserError && _jsx("p", { className: "file-browser-error", children: browserError }), !selectedFile ? (_jsxs("div", { className: "file-browser-preview-empty", children: [_jsx("p", { className: "mono", children: "\u5DE6\u5074\u3067\u30D5\u30A1\u30A4\u30EB\u3092\u9078\u3076\u3068\u3001\u3053\u3053\u306B\u5185\u5BB9\u3092\u8868\u793A\u3057\u307E\u3059\u3002" }), _jsx("p", { className: "mono", children: "\u30C7\u30A3\u30EC\u30AF\u30C8\u30EA\u306F\u305D\u306E\u307E\u307E\u958B\u304D\u307E\u3059\u3002" })] })) : (_jsxs(_Fragment, { children: [_jsx("div", { className: "file-browser-preview-meta mono", children: _jsxs("span", { children: ["updated ", formatStamp(selectedFile.modifiedAt)] }) }), _jsx("pre", { className: "mono file-browser-preview", children: selectedFile.content })] }))] })] })] }));
}
