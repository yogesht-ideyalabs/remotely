import { useEffect, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { fetchFileList, fileDownloadUrl, uploadFile, type FileEntry, type FileTransferKind } from "../api";

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default function Files() {
  const { resourceId } = useParams();
  const [searchParams] = useSearchParams();
  const kind: FileTransferKind = searchParams.get("kind") === "ssh-agent" ? "ssh-agent" : "ssh-direct";
  const [path, setPath] = useState(".");
  const [entries, setEntries] = useState<FileEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function load(p: string) {
    if (!resourceId) return;
    setError(null);
    fetchFileList(resourceId, p, kind)
      .then((list) => {
        setEntries([...list].sort((a, b) => Number(b.isDirectory) - Number(a.isDirectory) || a.name.localeCompare(b.name)));
        setPath(p);
      })
      .catch((e) => setError(e.message));
  }

  useEffect(() => load("."), [resourceId, kind]);

  async function open(entry: FileEntry) {
    if (entry.isDirectory) {
      load(path === "." ? entry.name : `${path}/${entry.name}`);
      return;
    }
    // Open the tab synchronously (inside the user gesture) so popup
    // blockers don't kill it while the download-token request is pending,
    // then point it at the real URL once the token comes back.
    const tab = window.open("", "_blank");
    try {
      const url = await fileDownloadUrl(resourceId!, path === "." ? entry.name : `${path}/${entry.name}`, kind);
      if (tab) tab.location.href = url;
    } catch (err) {
      tab?.close();
      setError(err instanceof Error ? err.message : "download failed");
    }
  }

  function goUp() {
    if (path === ".") return;
    const parts = path.split("/");
    parts.pop();
    load(parts.length === 0 ? "." : parts.join("/"));
  }

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !resourceId) return;
    setUploading(true);
    setError(null);
    try {
      await uploadFile(resourceId, path, file, kind);
      load(path);
    } catch (err) {
      setError(err instanceof Error ? err.message : "upload failed");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  return (
    <div>
      <div className="term-toolbar">
        <Link className="back" to="/resources">
          ← back to resources
        </Link>
        <span className="hint">{resourceId} · file transfer ({kind === "ssh-agent" ? "via agent tunnel" : "SFTP"})</span>
      </div>
      <div className="section-card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <div>
            <button className="link" onClick={goUp} disabled={path === "."}>
              ↑ up
            </button>
            <span className="hint" style={{ marginLeft: 8 }}>
              /{path === "." ? "" : path}
            </span>
          </div>
          <div>
            <input ref={fileInputRef} type="file" onChange={handleUpload} disabled={uploading} style={{ display: "none" }} id="file-upload-input" />
            <label htmlFor="file-upload-input" className="secondary" style={{ cursor: "pointer", display: "inline-block", padding: "8px 14px", borderRadius: 6, border: "1px solid var(--panel-border)" }}>
              {uploading ? "Uploading..." : "Upload file"}
            </label>
          </div>
        </div>
        {error && <div className="error-banner">{error}</div>}
        {entries && (
          <table className="audit-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Size</th>
                <th>Modified</th>
              </tr>
            </thead>
            <tbody>
              {entries
                .filter((e) => e.name !== "." && e.name !== "..")
                .map((entry) => (
                  <tr key={entry.name} style={{ cursor: "pointer" }} onClick={() => open(entry)}>
                    <td>
                      {entry.isDirectory ? "📁" : "📄"} {entry.name}
                    </td>
                    <td>{entry.isDirectory ? "—" : formatSize(entry.size)}</td>
                    <td>{new Date(entry.modifiedAt).toLocaleString()}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        )}
      </div>
      <p className="hint">Every download and upload is audited by path. Click a folder to open it, a file to download it.</p>
    </div>
  );
}
