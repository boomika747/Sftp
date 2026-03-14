"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";

type EntryType = "d" | "-" | "l";

interface FileEntry {
  name: string;
  type: EntryType;
  size: number;
  modifyTime: number;
  rights: {
    user: string;
    group: string;
    other: string;
  };
}

interface PreviewState {
  open: boolean;
  filePath: string;
  name: string;
  mime: "text" | "image" | "unsupported";
  content?: string;
  imageSrc?: string;
  metadata?: { size: number; modifyTime: number };
}

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  if (size < 1024 * 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  return `${(size / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function joinPath(base: string, segment: string): string {
  if (base === "/") return `/${segment}`;
  return `${base.replace(/\/+$/, "")}/${segment}`;
}

function splitBreadcrumb(path: string): string[] {
  return path.split("/").filter(Boolean);
}

function isImage(name: string): boolean {
  return /\.(png|jpg|jpeg|gif|webp|bmp|svg)$/i.test(name);
}

function isTextLike(name: string): boolean {
  return /\.(txt|md|json|ts|tsx|js|jsx|css|html|xml|yml|yaml|log)$/i.test(name);
}

export default function FileManager({ initialPath = "/upload" }: { initialPath?: string }) {
  const [currentPath, setCurrentPath] = useState(initialPath);
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string>("");
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [preview, setPreview] = useState<PreviewState>({ open: false, filePath: "", name: "", mime: "unsupported" });
  const [renameTarget, setRenameTarget] = useState<string>("");
  const [renameValue, setRenameValue] = useState<string>("");

  async function loadDirectory(path: string) {
    setIsLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/sftp/list?path=${encodeURIComponent(path)}`, { cache: "no-store" });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({ error: "Failed to load directory" }));
        throw new Error(payload.error || "Failed to load directory");
      }
      const data = (await res.json()) as FileEntry[];
      setEntries(data);
      setCurrentPath(path);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load directory");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void loadDirectory(initialPath);
  }, [initialPath]);

  const directories = useMemo(() => entries.filter((e) => e.type === "d"), [entries]);
  const files = useMemo(() => entries.filter((e) => e.type !== "d"), [entries]);

  async function handleDelete(path: string) {
    const res = await fetch(`/api/sftp/delete?path=${encodeURIComponent(path)}`, { method: "DELETE" });
    if (!res.ok) {
      const payload = await res.json().catch(() => ({ error: "Delete failed" }));
      alert(payload.error || "Delete failed");
      return;
    }
    void loadDirectory(currentPath);
  }

  function handleUpload(file: File) {
    const xhr = new XMLHttpRequest();
    const formData = new FormData();
    formData.append("path", currentPath);
    formData.append("file", file);

    setUploadProgress(0);

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        const pct = Math.round((event.loaded / event.total) * 100);
        setUploadProgress(pct);
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        setUploadProgress(null);
        void loadDirectory(currentPath);
      } else {
        setUploadProgress(null);
        alert("Upload failed");
      }
    };

    xhr.onerror = () => {
      setUploadProgress(null);
      alert("Upload failed");
    };

    xhr.open("POST", "/api/sftp/upload");
    xhr.send(formData);
  }

  async function handleRename(fromName: string) {
    const fromPath = joinPath(currentPath, fromName);
    const toPath = joinPath(currentPath, renameValue.trim());
    if (!renameValue.trim()) return;

    const res = await fetch("/api/sftp/rename", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fromPath, toPath }),
    });

    if (!res.ok) {
      const payload = await res.json().catch(() => ({ error: "Rename failed" }));
      alert(payload.error || "Rename failed");
      return;
    }

    setRenameTarget("");
    setRenameValue("");
    void loadDirectory(currentPath);
  }

  async function handleDownload(path: string, name: string) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120000);

    try {
      const res = await fetch(`/api/sftp/download?path=${encodeURIComponent(path)}`, {
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (!res.ok) {
        throw new Error("Download failed");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      alert("Download failed or aborted");
    }
  }

  async function handlePreview(file: FileEntry) {
    const filePath = joinPath(currentPath, file.name);

    if (isImage(file.name)) {
      const src = `/api/sftp/download?path=${encodeURIComponent(filePath)}`;
      setPreview({
        open: true,
        filePath,
        name: file.name,
        mime: "image",
        imageSrc: src,
        metadata: { size: file.size, modifyTime: file.modifyTime },
      });
      return;
    }

    if (isTextLike(file.name)) {
      const res = await fetch(`/api/sftp/download?path=${encodeURIComponent(filePath)}`);
      if (!res.ok) {
        alert("Unable to preview file");
        return;
      }
      const text = await res.text();
      setPreview({
        open: true,
        filePath,
        name: file.name,
        mime: "text",
        content: text.slice(0, 100000),
        metadata: { size: file.size, modifyTime: file.modifyTime },
      });
      return;
    }

    setPreview({
      open: true,
      filePath,
      name: file.name,
      mime: "unsupported",
      metadata: { size: file.size, modifyTime: file.modifyTime },
    });
  }

  const breadcrumbs = splitBreadcrumb(currentPath);

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900">
      <div className="mx-auto grid max-w-7xl grid-cols-1 gap-4 p-4 md:grid-cols-[260px_1fr_340px]">
        <aside className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm" data-test-id="directory-tree">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-500">Directory Tree</h2>
          <button
            className="mb-2 w-full rounded-md bg-slate-900 px-3 py-2 text-left text-sm text-white"
            onClick={() => void loadDirectory("/upload")}
          >
            /upload
          </button>
          {directories.map((dir) => (
            <button
              key={dir.name}
              className="mb-2 w-full rounded-md border border-slate-200 px-3 py-2 text-left text-sm hover:bg-slate-50"
              onClick={() => void loadDirectory(joinPath(currentPath, dir.name))}
            >
              {dir.name}
            </button>
          ))}
        </aside>

        <main className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm" data-test-id="file-list-view">
          <div className="mb-4 flex flex-wrap items-center gap-3" data-test-id="breadcrumbs">
            <button className="rounded bg-slate-200 px-2 py-1 text-xs" onClick={() => void loadDirectory("/")}>root</button>
            {breadcrumbs.map((crumb, idx) => {
              const crumbPath = `/${breadcrumbs.slice(0, idx + 1).join("/")}`;
              return (
                <button
                  key={`${crumb}-${idx}`}
                  className="rounded bg-slate-100 px-2 py-1 text-xs hover:bg-slate-200"
                  onClick={() => void loadDirectory(crumbPath)}
                >
                  {crumb}
                </button>
              );
            })}
          </div>

          <div className="mb-4 flex items-center gap-3">
            <label className="rounded-md bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700">
              Upload File
              <input
                type="file"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleUpload(file);
                }}
              />
            </label>
            <button
              className="rounded-md bg-slate-800 px-3 py-2 text-sm text-white"
              onClick={() => {
                const parent = currentPath.split("/").slice(0, -1).join("/") || "/";
                void loadDirectory(parent);
              }}
            >
              Up One Level
            </button>
          </div>

          {uploadProgress !== null && (
            <div className="mb-4">
              <div className="mb-1 text-xs text-slate-600">Uploading: {uploadProgress}%</div>
              <progress data-test-id="upload-progress-bar" className="h-3 w-full" max={100} value={uploadProgress} />
            </div>
          )}

          {error && <div className="mb-4 rounded bg-rose-100 p-3 text-sm text-rose-800">{error}</div>}

          {isLoading ? (
            <div className="space-y-2">
              <div className="h-8 animate-pulse rounded bg-slate-200" />
              <div className="h-8 animate-pulse rounded bg-slate-200" />
              <div className="h-8 animate-pulse rounded bg-slate-200" />
            </div>
          ) : (
            <div className="space-y-2">
              {directories.map((entry) => (
                <div key={`d-${entry.name}`} className="flex items-center justify-between rounded border border-slate-200 p-3" data-test-id="dir-item">
                  <button className="font-medium text-sky-700" onClick={() => void loadDirectory(joinPath(currentPath, entry.name))}>
                    {entry.name}/
                  </button>
                  <div className="flex items-center gap-2">
                    <button className="rounded bg-rose-600 px-2 py-1 text-xs text-white" onClick={() => void handleDelete(joinPath(currentPath, entry.name))}>
                      Delete
                    </button>
                  </div>
                </div>
              ))}

              {files.map((entry) => (
                <div key={`f-${entry.name}`} className="flex flex-wrap items-center justify-between gap-2 rounded border border-slate-200 p-3" data-test-id="file-item">
                  <div>
                    <div className="font-medium">{entry.name}</div>
                    <div className="text-xs text-slate-500">{formatBytes(entry.size)} • {new Date(entry.modifyTime).toLocaleString()}</div>
                  </div>

                  <div className="flex items-center gap-2">
                    {renameTarget === entry.name ? (
                      <>
                        <input
                          value={renameValue}
                          onChange={(e) => setRenameValue(e.target.value)}
                          className="rounded border border-slate-300 px-2 py-1 text-sm"
                          placeholder="new name"
                        />
                        <button className="rounded bg-amber-600 px-2 py-1 text-xs text-white" onClick={() => void handleRename(entry.name)}>
                          Save
                        </button>
                        <button className="rounded bg-slate-300 px-2 py-1 text-xs" onClick={() => setRenameTarget("")}>
                          Cancel
                        </button>
                      </>
                    ) : (
                      <>
                        <button className="rounded bg-slate-800 px-2 py-1 text-xs text-white" onClick={() => void handleDownload(joinPath(currentPath, entry.name), entry.name)}>
                          Download
                        </button>
                        <button className="rounded bg-indigo-600 px-2 py-1 text-xs text-white" onClick={() => void handlePreview(entry)}>
                          Preview
                        </button>
                        <button
                          className="rounded bg-amber-600 px-2 py-1 text-xs text-white"
                          onClick={() => {
                            setRenameTarget(entry.name);
                            setRenameValue(entry.name);
                          }}
                        >
                          Rename
                        </button>
                        <button className="rounded bg-rose-600 px-2 py-1 text-xs text-white" onClick={() => void handleDelete(joinPath(currentPath, entry.name))}>
                          Delete
                        </button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </main>

        <aside className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm" data-test-id="preview-panel">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">Preview</h2>

          {!preview.open && <p className="text-sm text-slate-500">Select a file and click Preview.</p>}

          {preview.open && (
            <div className="space-y-3">
              <div>
                <div className="text-sm font-medium">{preview.name}</div>
                <div className="text-xs text-slate-500">{preview.filePath}</div>
              </div>

              {preview.mime === "text" && (
                <pre data-test-id="preview-text" className="max-h-96 overflow-auto rounded border border-slate-200 bg-slate-50 p-3 text-xs">
                  {preview.content}
                </pre>
              )}

              {preview.mime === "image" && preview.imageSrc && (
                <Image
                  data-test-id="preview-image"
                  src={preview.imageSrc}
                  alt={preview.name}
                  width={1200}
                  height={900}
                  unoptimized
                  className="max-h-96 h-auto w-full rounded border border-slate-200 object-contain"
                />
              )}

              {preview.mime === "unsupported" && (
                <div data-test-id="preview-unsupported" className="rounded border border-slate-200 bg-slate-50 p-3 text-sm">
                  <p>Preview is not supported for this file type.</p>
                  {preview.metadata && (
                    <>
                      <p className="mt-2 text-xs text-slate-600">Size: {formatBytes(preview.metadata.size)}</p>
                      <p className="text-xs text-slate-600">Modified: {new Date(preview.metadata.modifyTime).toLocaleString()}</p>
                    </>
                  )}
                </div>
              )}

              <button
                className="rounded bg-slate-800 px-3 py-2 text-sm text-white"
                onClick={() => void handleDownload(preview.filePath, preview.name)}
              >
                Download
              </button>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
