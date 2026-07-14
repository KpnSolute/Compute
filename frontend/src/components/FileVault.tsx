import { useCallback, useEffect, useState } from 'react';
import { api, type ArchivedFile } from '../lib/api';
import { I } from '../lib/icons';

const CATEGORIES = ['invoice', 'menu', 'recipe', 'report', 'document', 'other'];

function fileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function FileVault() {
  const [files, setFiles] = useState<ArchivedFile[]>([]);
  const [storageReady, setStorageReady] = useState(false);
  const [category, setCategory] = useState('');
  const [search, setSearch] = useState('');
  const [uploadCategory, setUploadCategory] = useState('document');
  const [selected, setSelected] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const data = await api.getArchivedFiles({ category, search });
      setFiles(data.files);
      setStorageReady(data.storage_ready);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load files');
    }
  }, [category, search]);

  useEffect(() => { void load(); }, [load]);

  async function upload() {
    if (!selected) return;
    setBusy(true);
    try {
      await api.uploadArchivedFile(selected, uploadCategory);
      setSelected(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setBusy(false);
    }
  }

  async function remove(file: ArchivedFile) {
    if (!window.confirm(`Remove ${file.original_filename} from the active File Vault view? The retained original is not physically erased.`)) return;
    try {
      await api.deleteArchivedFile(file.id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed');
    }
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>File Vault</h1>
          <p className="muted">Original invoices, menus, recipes, reports, and operational documents.</p>
        </div>
      </div>

      {!storageReady && <div className="alert alert-warn">Archive storage is not connected to this API environment yet. Browsing metadata remains available.</div>}
      {error && <div className="alert alert-error">{error}</div>}

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-head"><h3>Upload a file</h3></div>
        <div className="card-body" style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <input type="file" onChange={(event) => setSelected(event.target.files?.[0] || null)} />
          <select className="select" value={uploadCategory} onChange={(event) => setUploadCategory(event.target.value)}>
            {CATEGORIES.map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
          <button className="btn primary" disabled={!selected || busy || !storageReady} onClick={() => void upload()}>
            {I.plus()} {busy ? 'Uploading…' : 'Upload'}
          </button>
        </div>
      </div>

      <div className="card">
        <div className="card-head" style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <h3 style={{ marginRight: 'auto' }}>Stored files</h3>
          <input className="input" placeholder="Search filename" value={search} onChange={(event) => setSearch(event.target.value)} />
          <select className="select" value={category} onChange={(event) => setCategory(event.target.value)}>
            <option value="">All categories</option>
            {CATEGORIES.map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>File</th><th>Category</th><th>Size</th><th>Uploaded</th><th>Source</th><th>Actions</th></tr></thead>
            <tbody>
              {files.map((file) => (
                <tr key={file.id}>
                  <td><strong>{file.original_filename}</strong><div className="muted">{file.sha256.slice(0, 12)}…</div></td>
                  <td>{file.category}</td>
                  <td>{fileSize(file.size_bytes)}</td>
                  <td>{new Date(file.uploaded_at).toLocaleString()}</td>
                  <td>{file.source}</td>
                  <td>
                    <button className="btn sm" onClick={() => void api.downloadArchivedFile(file).catch((err) => setError(err.message))}>{I.download()} Download</button>{' '}
                    <button className="btn sm danger" onClick={() => void remove(file)}>{I.del()} Remove</button>
                  </td>
                </tr>
              ))}
              {!files.length && <tr><td colSpan={6} className="muted">No archived files match this view.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
