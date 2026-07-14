import { useEffect, useState, useMemo, useRef } from 'react';
import { collection, getDocs, doc, updateDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useAuth } from '../lib/AuthContext';
import { useBucket } from '../lib/BucketContext';
import { downloadDataUrl, processProofFiles, MAX_IMAGES_PER_TXN } from '../lib/fileUtils';
import {
  Eye, Download, X, Search, Trash2, Pencil, Upload, CheckCircle2,
  ChevronLeft, ChevronRight, Filter, RotateCcw, Info, Plus,
  List, Clock, FileSpreadsheet, FileText
} from 'lucide-react';
import * as XLSX from 'xlsx';

const PAYMENT_MODES = ['Cash', 'UPI', 'Card', 'NetBanking'];
const formatINR = (n) => new Intl.NumberFormat('en-IN').format(n || 0);
const formatDate = (d) => { try { return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }); } catch { return d; } };
const formatDateTime = (d) => { try { return new Date(d).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch { return d; } };

const getProofsArray = (t) => {
  if (Array.isArray(t.proofs) && t.proofs.length > 0) return t.proofs;
  if (t.proofData) return [{ dataUrl: t.proofData, type: t.proofType, name: t.proofName }];
  if (t.proofUrl) return [{ dataUrl: t.proofUrl, type: t.proofType, name: t.proofName }];
  return [];
};

const formatPaidBy = (t) => {
  if (t.isSplit && Array.isArray(t.splitDetails) && t.splitDetails.length > 0) return t.splitDetails.map(s => s.name).join(', ');
  return t.paidByName || '—';
};

const formatMode = (t) => {
  if (t.isSplit && Array.isArray(t.splitDetails) && t.splitDetails.length > 0) {
    const modes = [...new Set(t.splitDetails.map(s => s.mode).filter(Boolean))];
    return modes.join(', ') || t.mode || '—';
  }
  return t.mode || '—';
};

const getDescription = (t) => t.description || t.paidTo || '';

const READ_MORE_THRESHOLD = 60;
const DescriptionCell = ({ text }) => {
  const [expanded, setExpanded] = useState(false);
  if (!text) return null;
  if (text.length <= READ_MORE_THRESHOLD) return <div style={{ whiteSpace: 'normal', wordBreak: 'break-word' }}>{text}</div>;
  return (
    <div style={{ whiteSpace: 'normal', wordBreak: 'break-word' }}>
      {expanded ? text : text.slice(0, READ_MORE_THRESHOLD) + '…'}{' '}
      <button type="button" onClick={e => { e.stopPropagation(); setExpanded(v => !v); }} style={{ background: 'transparent', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontSize: 12, fontWeight: 600, padding: 0, textDecoration: 'underline', textUnderlineOffset: 2 }}>
        {expanded ? 'Read less' : 'Read more'}
      </button>
    </div>
  );
};

// Pinch-to-zoom image viewer
const ZoomableImage = ({ src, alt }) => {
  const [scale, setScale] = useState(1);
  const [lastDist, setLastDist] = useState(null);
  const imgRef = useRef(null);

  const getDist = (touches) => {
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.sqrt(dx * dx + dy * dy);
  };

  const onTouchStart = (e) => { if (e.touches.length === 2) setLastDist(getDist(e.touches)); };
  const onTouchMove = (e) => {
    if (e.touches.length === 2 && lastDist) {
      const newDist = getDist(e.touches);
      const delta = newDist / lastDist;
      setScale(s => Math.min(Math.max(s * delta, 0.5), 5));
      setLastDist(newDist);
      e.preventDefault();
    }
  };
  const onTouchEnd = () => setLastDist(null);
  const onWheel = (e) => { setScale(s => Math.min(Math.max(s - e.deltaY * 0.002, 0.5), 5)); e.preventDefault(); };
  const onDoubleClick = () => setScale(s => s > 1 ? 1 : 2.5);

  return (
    <div style={{ overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', height: '100%', cursor: scale > 1 ? 'grab' : 'zoom-in' }}>
      <img
        ref={imgRef}
        src={src}
        alt={alt}
        style={{ maxWidth: '100%', maxHeight: '65vh', objectFit: 'contain', transform: `scale(${scale})`, transition: lastDist ? 'none' : 'transform 0.2s ease', transformOrigin: 'center' }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onWheel={onWheel}
        onDoubleClick={onDoubleClick}
        draggable={false}
      />
    </div>
  );
};

const ProofViewer = ({ txn, onClose }) => {
  const proofs = getProofsArray(txn);
  const [idx, setIdx] = useState(0);
  if (!proofs.length) return null;
  const current = proofs[idx];
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal proof-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontFamily: 'Fraunces, serif', fontSize: 16, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{current.name || `Proof ${idx + 1}`}</div>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{idx + 1} of {proofs.length} · ₹{formatINR(txn.amount)} · {formatDate(txn.date)}
              {current.type !== 'application/pdf' && <span style={{ marginLeft: 8, color: 'var(--muted)', fontSize: 10 }}>Pinch or scroll to zoom · Double-tap to fit</span>}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="btn btn-ghost" onClick={() => downloadDataUrl(current.dataUrl, current.name)} style={{ padding: '6px 10px' }}><Download size={13} /></button>
            <button className="btn btn-ghost" onClick={onClose} style={{ padding: '6px 10px' }}><X size={13} /></button>
          </div>
        </div>
        <div className="modal-content carousel-content">
          {proofs.length > 1 && <button className="carousel-arrow carousel-arrow-left" onClick={() => setIdx(i => (i - 1 + proofs.length) % proofs.length)}><ChevronLeft size={20} /></button>}
          <div className="carousel-frame">
            {current.type === 'application/pdf'
              ? <iframe src={current.dataUrl} title={current.name} style={{ width: '80vw', maxWidth: 800, height: '65vh', border: 'none', borderRadius: 4 }} />
              : <ZoomableImage src={current.dataUrl} alt={current.name} />
            }
          </div>
          {proofs.length > 1 && <button className="carousel-arrow carousel-arrow-right" onClick={() => setIdx(i => (i + 1) % proofs.length)}><ChevronRight size={20} /></button>}
        </div>
        {proofs.length > 1 && (
          <div className="carousel-dots">
            {proofs.map((_, i) => <button key={i} className={`carousel-dot ${i === idx ? 'active' : ''}`} onClick={() => setIdx(i)} />)}
          </div>
        )}
      </div>
    </div>
  );
};

const DetailRow = ({ label, value, mono }) => (
  <div className="detail-row">
    <div className="detail-label">{label}</div>
    <div className={`detail-value ${mono ? 'mono' : ''}`}>{value || <span style={{ color: 'var(--muted)', fontStyle: 'italic' }}>—</span>}</div>
  </div>
);

const InfoModal = ({ txn, onClose, onViewProofs }) => {
  const proofs = getProofsArray(txn);
  const isSplitTxn = txn.isSplit && Array.isArray(txn.splitDetails) && txn.splitDetails.length > 0;
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal info-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <div style={{ fontFamily: 'Fraunces, serif', fontSize: 18, fontWeight: 600 }}>Transaction Details</div>
            <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12, color: 'var(--accent)', marginTop: 2, fontWeight: 600 }}>{txn.txnId || '—'}</div>
          </div>
          <button className="btn btn-ghost" onClick={onClose} style={{ padding: '8px 12px' }}><X size={14} /></button>
        </div>
        <div className="info-modal-body">
          <DetailRow label="Transaction ID" value={txn.txnId} mono />
          <DetailRow label="Bucket" value={txn.bucketName} />
          <DetailRow label="Date" value={formatDate(txn.date)} />
          <DetailRow label="Total Amount" value={`₹${formatINR(txn.amount)}`} />
          {isSplitTxn ? (
            <DetailRow label="Paid By" value={
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {txn.splitDetails.map((s, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, padding: '6px 10px', background: 'var(--cream-2)', borderRadius: 4 }}>
                    <span style={{ fontWeight: 600 }}>{s.name}</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      {s.mode && <span className={`mode-pill ${(s.mode || '').toLowerCase()}`} style={{ fontSize: 10 }}>{s.mode}</span>}
                      <span style={{ fontFamily: 'JetBrains Mono, monospace', fontWeight: 600 }}>₹{formatINR(s.amount)}</span>
                    </div>
                  </div>
                ))}
              </div>
            } />
          ) : (
            <>
              <DetailRow label="Paid By" value={txn.paidByName} />
              {txn.paidByEmail && <DetailRow label="Paid By (email)" value={txn.paidByEmail} />}
              <DetailRow label="Mode of Payment" value={txn.mode} />
            </>
          )}
          <DetailRow label="Description" value={<span style={{ whiteSpace: 'normal', wordBreak: 'break-word' }}>{getDescription(txn)}</span>} />
          <DetailRow label="Proofs" value={proofs.length > 0 ? <button className="btn-link" onClick={() => onViewProofs(txn)} style={{ padding: 0 }}>View {proofs.length} file{proofs.length > 1 ? 's' : ''}</button> : 'No proof attached'} />
          {isSplitTxn && txn.createdByName && <DetailRow label="Entered by" value={txn.createdByName} />}
          {!isSplitTxn && txn.createdByName && txn.createdByUid !== txn.paidByUid && <DetailRow label="Entered by" value={`${txn.createdByName} (on behalf)`} />}
          <DetailRow label="Created at" value={formatDateTime(txn.createdAt)} />
          {txn.updatedAt && <DetailRow label="Last updated" value={formatDateTime(txn.updatedAt)} />}
        </div>
      </div>
    </div>
  );
};

const EditModal = ({ txn, onClose, onSaved, approvedUsers }) => {
  const existingProofs = getProofsArray(txn);
  const isSplitTxn = txn.isSplit && Array.isArray(txn.splitDetails);
  const [date, setDate] = useState(txn.date || '');
  const [amount, setAmount] = useState(String(txn.amount || ''));
  const [description, setDescription] = useState(getDescription(txn));
  const [mode, setMode] = useState(txn.mode || '');
  const [paidByUid, setPaidByUid] = useState(txn.paidByUid || '');
  const [keptProofs, setKeptProofs] = useState(existingProofs);
  const [newFiles, setNewFiles] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const totalProofCount = keptProofs.length + newFiles.length;
  const selectedUser = approvedUsers.find(u => u.id === paidByUid) || { id: paidByUid, name: txn.paidByName, email: txn.paidByEmail };

  const handleSave = async (e) => {
    e.preventDefault(); setError('');
    if (!date) return setError('Date is required');
    if (!amount || parseInt(amount) <= 0) return setError('Amount must be positive');
    if (!description.trim()) return setError('Description is required');
    if (!isSplitTxn && !mode) return setError('Mode is required');
    setSaving(true);
    try {
      let newProcessed = [];
      if (newFiles.length > 0) newProcessed = await processProofFiles(newFiles);
      const finalProofs = [...keptProofs, ...newProcessed];
      const parsedDate = new Date(date);
      const updates = {
        date, amount: parseInt(amount),
        paidTo: description.trim(), description: description.trim(),
        proofs: finalProofs, proofData: null, proofType: null, proofName: null, proofUrl: null,
        year: parsedDate.getFullYear(), month: parsedDate.getMonth() + 1,
        updatedAt: new Date().toISOString()
      };
      if (!isSplitTxn) {
        updates.mode = mode;
        updates.paidByUid = selectedUser.id;
        updates.paidByName = selectedUser.name || selectedUser.email || txn.paidByName;
        updates.paidByEmail = selectedUser.email || txn.paidByEmail;
      }
      await updateDoc(doc(db, 'transactions', txn.id), updates);
      onSaved({ ...txn, ...updates });
    } catch (err) { setError(err.message || 'Failed to save'); }
    finally { setSaving(false); }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal edit-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <div style={{ fontFamily: 'Fraunces, serif', fontSize: 18, fontWeight: 600 }}>Edit Transaction</div>
            <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{txn.txnId || ''}</div>
          </div>
          <button className="btn btn-ghost" onClick={onClose} style={{ padding: '8px 12px' }}><X size={14} /></button>
        </div>
        <form onSubmit={handleSave} className="edit-form">
          <div className="edit-form-body">
            {error && <div className="alert alert-error" style={{ marginBottom: 16 }}>{error}</div>}
            {isSplitTxn && <div className="alert" style={{ background: 'var(--cream-2)', color: 'var(--muted)', marginBottom: 16, fontSize: 13 }}>ℹ️ Split transactions: per-user contributions are locked.</div>}
            {!isSplitTxn && (
              <div className="field">
                <label className="label">Paid By</label>
                <select className="select" value={paidByUid} onChange={e => setPaidByUid(e.target.value)}>
                  {approvedUsers.map(u => <option key={u.id} value={u.id}>{u.name || u.email}</option>)}
                  {!approvedUsers.some(u => u.id === paidByUid) && paidByUid && <option value={paidByUid}>{txn.paidByName} (original)</option>}
                </select>
              </div>
            )}
            <div className="form-grid">
              <div className="field"><label className="label">Date *</label><input className="input" type="date" value={date} onChange={e => setDate(e.target.value)} required /></div>
              <div className="field"><label className="label">Amount (INR) *</label><input className="input mono" type="text" inputMode="numeric" value={amount} onChange={e => setAmount(e.target.value.replace(/\D/g, ''))} required /></div>
            </div>
            <div className="field">
              <label className="label">Description * ({description.length}/300)</label>
              <textarea className="textarea" value={description} onChange={e => setDescription(e.target.value.slice(0, 300))} maxLength="300" required />
            </div>
            {!isSplitTxn && (
              <div className="field">
                <label className="label">Mode of Payment *</label>
                <select className="select" value={mode} onChange={e => setMode(e.target.value)} required>
                  <option value="">Select…</option>
                  {PAYMENT_MODES.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
            )}
            <div className="field">
              <label className="label">Proofs ({totalProofCount}/{MAX_IMAGES_PER_TXN})</label>
              {keptProofs.length > 0 && (
                <div className="file-chip-list">
                  {keptProofs.map((p, i) => (
                    <div key={`kept-${i}`} className="file-chip">
                      <span className="file-chip-name">📎 {p.name || `proof ${i + 1}`}</span>
                      <button type="button" onClick={() => setKeptProofs(prev => prev.filter((_, idx) => idx !== i))} className="file-chip-remove"><X size={12} /></button>
                    </div>
                  ))}
                </div>
              )}
              {newFiles.length > 0 && (
                <div className="file-chip-list">
                  {newFiles.map((f, i) => (
                    <div key={`new-${i}`} className="file-chip file-chip-new">
                      <span className="file-chip-name">+ {f.name}</span>
                      <span className="file-chip-size">{(f.size / 1024).toFixed(0)}KB</span>
                      <button type="button" onClick={() => setNewFiles(prev => prev.filter((_, idx) => idx !== i))} className="file-chip-remove"><X size={12} /></button>
                    </div>
                  ))}
                </div>
              )}
              {totalProofCount < MAX_IMAGES_PER_TXN && (
                <label className="file-upload">
                  <input type="file" accept="image/*,application/pdf" multiple onChange={e => {
                    const incoming = Array.from(e.target.files || []);
                    if (totalProofCount + incoming.length > MAX_IMAGES_PER_TXN) { setError(`Max ${MAX_IMAGES_PER_TXN} files.`); return; }
                    setNewFiles(prev => [...prev, ...incoming]); e.target.value = '';
                  }} />
                  <Upload size={20} />
                  <div className="file-upload-label">Add files · {MAX_IMAGES_PER_TXN - totalProofCount} remaining</div>
                </label>
              )}
            </div>
          </div>
          <div className="edit-form-footer">
            <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save Changes'}</button>
          </div>
        </form>
      </div>
    </div>
  );
};

const FilterPanel = ({ filters, setFilters, paidByOptions, onReset }) => (
  <div className="filter-panel">
    <div className="filter-panel-grid">
      <div className="field" style={{ marginBottom: 0 }}><label className="label">Date — from</label><input className="input" type="date" value={filters.dateFrom} onChange={e => setFilters(f => ({ ...f, dateFrom: e.target.value }))} /></div>
      <div className="field" style={{ marginBottom: 0 }}><label className="label">Date — to</label><input className="input" type="date" value={filters.dateTo} onChange={e => setFilters(f => ({ ...f, dateTo: e.target.value }))} /></div>
      <div className="field" style={{ marginBottom: 0 }}>
        <label className="label">Paid by</label>
        <select className="select" value={filters.paidBy} onChange={e => setFilters(f => ({ ...f, paidBy: e.target.value }))}>
          <option value="">— All users —</option>
          {paidByOptions.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
      </div>
      <div className="field" style={{ marginBottom: 0 }}>
        <label className="label">Mode</label>
        <select className="select" value={filters.mode} onChange={e => setFilters(f => ({ ...f, mode: e.target.value }))}>
          <option value="">— All modes —</option>
          {PAYMENT_MODES.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
      </div>
      <div className="field" style={{ marginBottom: 0 }}><label className="label">Amount — min (₹)</label><input className="input mono" type="text" inputMode="numeric" placeholder="500" value={filters.amountMin} onChange={e => setFilters(f => ({ ...f, amountMin: e.target.value.replace(/\D/g, '') }))} /></div>
      <div className="field" style={{ marginBottom: 0 }}><label className="label">Amount — max (₹)</label><input className="input mono" type="text" inputMode="numeric" placeholder="600" value={filters.amountMax} onChange={e => setFilters(f => ({ ...f, amountMax: e.target.value.replace(/\D/g, '') }))} /></div>
    </div>
    <div className="filter-panel-actions"><button className="btn btn-ghost" onClick={onReset} style={{ padding: '8px 14px', fontSize: 13 }}><RotateCcw size={13} /> Reset all</button></div>
  </div>
);

// Timeline view — grouped by month
const TimelineView = ({ transactions, onView, onEdit, onDelete, onInfo, isAdmin, deleting }) => {
  const grouped = useMemo(() => {
    const map = new Map();
    transactions.forEach(t => {
      const key = `${t.year || new Date(t.date).getFullYear()}-${String(t.month || new Date(t.date).getMonth() + 1).padStart(2, '0')}`;
      const label = new Date(t.date).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
      if (!map.has(key)) map.set(key, { label, items: [], total: 0 });
      map.get(key).items.push(t);
      map.get(key).total += t.amount || 0;
    });
    return Array.from(map.entries()).sort((a, b) => b[0].localeCompare(a[0]));
  }, [transactions]);

  return (
    <div className="timeline-wrap">
      {grouped.map(([key, group]) => (
        <div key={key} className="timeline-month">
          <div className="timeline-month-header">
            <div className="timeline-month-label">{group.label}</div>
            <div className="timeline-month-total">₹{formatINR(group.total)}</div>
          </div>
          <div className="timeline-items">
            {group.items.map(t => {
              const proofs = getProofsArray(t);
              return (
                <div key={t.id} className="timeline-item">
                  <div className="timeline-dot" />
                  <div className="timeline-item-card">
                    <div className="timeline-item-top">
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                        <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10, color: 'var(--accent)', fontWeight: 600 }}>{t.txnId || ''}</div>
                        <div style={{ fontSize: 12, color: 'var(--muted)' }}>{formatDate(t.date)}</div>
                      </div>
                      <div style={{ fontFamily: 'Fraunces, serif', fontWeight: 700, fontSize: 16 }}>₹{formatINR(t.amount)}</div>
                    </div>
                    <div style={{ fontSize: 14, margin: '6px 0', wordBreak: 'break-word' }}><DescriptionCell text={getDescription(t)} /></div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
                      <span className={`mode-pill ${(t.mode || '').toLowerCase()}`}>{formatMode(t)}</span>
                      <span style={{ fontSize: 12, color: 'var(--muted)' }}>· {formatPaidBy(t)}</span>
                    </div>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {proofs.length > 0
                        ? <button className="view-btn" onClick={() => onView(t)}><Eye size={12} /> View {proofs.length > 1 ? `(${proofs.length})` : ''}</button>
                        : <span className="no-proof" style={{ fontSize: 11 }}>no proof</span>}
                      <button className="info-btn" onClick={() => onInfo(t)} title="Details"><Info size={13} /></button>
                      <button className="btn-action btn-edit" onClick={() => onEdit(t)}><Pencil size={11} /> Edit</button>
                      {isAdmin && <button className="btn-action btn-delete btn-icon-only" onClick={() => onDelete(t)} disabled={deleting === t.id} title="Delete">{deleting === t.id ? '…' : <Trash2 size={13} />}</button>}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
};

// Mobile card
const TxnCard = ({ t, canDelete, onView, onEdit, onDelete, onInfo, deleting }) => {
  const proofs = getProofsArray(t);
  return (
    <div className="txn-card">
      <div className="txn-card-row">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <div className="txn-card-id">{t.txnId || ''}</div>
          <div className="txn-card-date">{formatDate(t.date)}</div>
        </div>
        <div className="txn-card-amount">₹{formatINR(t.amount)}</div>
      </div>
      <div className="txn-card-paidto"><DescriptionCell text={getDescription(t)} /></div>
      <div className="txn-card-row" style={{ marginTop: 6 }}>
        <div className="txn-card-meta">
          <span className={`mode-pill ${(t.mode || '').toLowerCase()}`}>{formatMode(t)}</span>
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>· {formatPaidBy(t)}</span>
        </div>
      </div>
      <div className="txn-card-actions">
        {proofs.length > 0 ? <button className="view-btn" onClick={() => onView(t)}><Eye size={12} /> {proofs.length > 1 ? `View (${proofs.length})` : 'View'}</button> : <span className="no-proof">no proof</span>}
        <div style={{ display: 'flex', gap: 6, marginLeft: 'auto' }}>
          <button className="info-btn" onClick={() => onInfo(t)} title="Details"><Info size={13} /></button>
          <button className="btn-action btn-edit" onClick={() => onEdit(t)}><Pencil size={11} /> Edit</button>
          {canDelete && <button className="btn-action btn-delete btn-icon-only" onClick={() => onDelete(t)} disabled={deleting === t.id} title="Delete" aria-label="Delete">{deleting === t.id ? '…' : <Trash2 size={13} />}</button>}
        </div>
      </div>
    </div>
  );
};

// Export modal
const ExportModal = ({ onClose, filtered, allTxns, bucketName }) => {
  const [scope, setScope] = useState('filtered');
  const data = scope === 'filtered' ? filtered : allTxns;

  const exportExcel = () => {
    const rows = data.map(t => ({
      'TX ID': t.txnId || '',
      'Date': t.date,
      'Paid By': formatPaidBy(t),
      'Description': getDescription(t),
      'Mode': formatMode(t),
      'Amount (₹)': t.amount,
      'Bucket': t.bucketName || bucketName
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Transactions');
    XLSX.writeFile(wb, `${bucketName}-transactions.xlsx`);
    onClose();
  };

  const exportPDF = () => {
    const formatINRLocal = (n) => new Intl.NumberFormat('en-IN').format(n || 0);
    const total = data.reduce((s, t) => s + (t.amount || 0), 0);
    const html = `
      <!DOCTYPE html><html><head><meta charset="UTF-8">
      <title>${bucketName} — Transactions</title>
      <style>
        body { font-family: Georgia, serif; color: #1a1815; padding: 32px; max-width: 900px; margin: 0 auto; }
        h1 { font-size: 24px; margin-bottom: 4px; }
        .meta { color: #6b6357; font-size: 13px; margin-bottom: 24px; }
        table { width: 100%; border-collapse: collapse; font-size: 13px; }
        th { text-align: left; padding: 8px 12px; background: #ebe1d0; border-bottom: 2px solid #ded2bd; font-size: 11px; text-transform: uppercase; letter-spacing: 0.1em; }
        td { padding: 10px 12px; border-bottom: 1px solid #ded2bd; }
        tr:last-child td { border-bottom: none; }
        .amount { font-family: monospace; text-align: right; font-weight: 600; }
        tfoot td { background: #ebe1d0; font-weight: 700; }
        @media print { body { padding: 0; } }
      </style></head><body>
      <h1>${bucketName} — Transactions</h1>
      <div class="meta">Exported on ${new Date().toLocaleDateString('en-IN')} · ${data.length} transactions · Total: ₹${formatINRLocal(total)}</div>
      <table>
        <thead><tr><th>TX ID</th><th>Date</th><th>Paid By</th><th>Description</th><th>Mode</th><th style="text-align:right">Amount</th></tr></thead>
        <tbody>
          ${data.map(t => `<tr>
            <td style="font-family:monospace;font-size:11px;color:#b8451f">${t.txnId || '—'}</td>
            <td>${formatDate(t.date)}</td>
            <td>${formatPaidBy(t)}</td>
            <td>${getDescription(t)}</td>
            <td>${formatMode(t)}</td>
            <td class="amount">₹${formatINRLocal(t.amount)}</td>
          </tr>`).join('')}
        </tbody>
        <tfoot><tr><td colspan="5">Total</td><td class="amount">₹${formatINRLocal(total)}</td></tr></tfoot>
      </table>
      </body></html>`;
    const win = window.open('', '_blank');
    win.document.write(html);
    win.document.close();
    win.print();
    onClose();
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 440 }} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div style={{ fontFamily: 'Fraunces, serif', fontSize: 18, fontWeight: 600 }}>Export Transactions</div>
          <button className="btn btn-ghost" onClick={onClose} style={{ padding: '8px 12px' }}><X size={14} /></button>
        </div>
        <div style={{ padding: '20px' }}>
          <div className="field">
            <label className="label">What to export</label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderRadius: 6, border: `2px solid ${scope === 'filtered' ? 'var(--accent)' : 'var(--cream-3)'}`, cursor: 'pointer', background: scope === 'filtered' ? 'rgba(184,69,31,0.04)' : 'var(--cream-2)' }}>
                <input type="radio" name="scope" value="filtered" checked={scope === 'filtered'} onChange={() => setScope('filtered')} style={{ accentColor: 'var(--accent)' }} />
                <div>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>Current view ({filtered.length} transactions)</div>
                  <div style={{ fontSize: 12, color: 'var(--muted)' }}>Respects active search and filters</div>
                </div>
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderRadius: 6, border: `2px solid ${scope === 'all' ? 'var(--accent)' : 'var(--cream-3)'}`, cursor: 'pointer', background: scope === 'all' ? 'rgba(184,69,31,0.04)' : 'var(--cream-2)' }}>
                <input type="radio" name="scope" value="all" checked={scope === 'all'} onChange={() => setScope('all')} style={{ accentColor: 'var(--accent)' }} />
                <div>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>All transactions ({allTxns.length} transactions)</div>
                  <div style={{ fontSize: 12, color: 'var(--muted)' }}>Complete bucket history</div>
                </div>
              </label>
            </div>
          </div>
        </div>
        <div style={{ padding: '14px 20px', borderTop: '1px solid var(--cream-3)', display: 'flex', gap: 10 }}>
          <button className="btn btn-ghost" onClick={onClose} style={{ flex: 1 }}>Cancel</button>
          <button className="btn btn-ghost" onClick={exportExcel} style={{ flex: 1 }}><FileSpreadsheet size={14} /> Excel</button>
          <button className="btn btn-primary" onClick={exportPDF} style={{ flex: 1 }}><FileText size={14} /> PDF</button>
        </div>
      </div>
    </div>
  );
};

const TransactionDetails = ({ onAddEntry }) => {
  const { user, profile, isAdmin } = useAuth();
  const { activeBucket } = useBucket();
  const [txns, setTxns] = useState([]);
  const [approvedUsers, setApprovedUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [viewing, setViewing] = useState(null);
  const [editing, setEditing] = useState(null);
  const [info, setInfo] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [viewMode, setViewMode] = useState('table'); // 'table' | 'timeline'
  const [showExport, setShowExport] = useState(false);
  const emptyFilters = { dateFrom: '', dateTo: '', paidBy: '', mode: '', amountMin: '', amountMax: '' };
  const [filters, setFilters] = useState(emptyFilters);

  const load = async () => {
    setLoading(true);
    try {
      const snap = await getDocs(collection(db, 'transactions'));
      const all = snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter(t => t.bucketId === activeBucket.id && !t.deleted)
        .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
      setTxns(all);
      const usnap = await getDocs(collection(db, 'users'));
      setApprovedUsers(usnap.docs.map(d => ({ id: d.id, ...d.data() })).filter(u => u.status === 'approved' || u.isPrimary));
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [activeBucket]);

  const paidByOptions = useMemo(() => {
    const s = new Set();
    txns.forEach(t => {
      if (t.isSplit && Array.isArray(t.splitDetails)) t.splitDetails.forEach(d => d.name && s.add(d.name));
      else if (t.paidByName) s.add(t.paidByName);
    });
    return Array.from(s).sort();
  }, [txns]);

  const activeFilterCount = useMemo(() => Object.values(filters).filter(v => v !== '').length, [filters]);

  const filtered = useMemo(() => txns.filter(t => {
    if (search) {
      const s = search.toLowerCase();
      if (!((t.txnId || '').toLowerCase().includes(s) || (formatPaidBy(t) || '').toLowerCase().includes(s) || (getDescription(t) || '').toLowerCase().includes(s) || (formatMode(t) || '').toLowerCase().includes(s) || (t.date || '').includes(s) || String(t.amount || '').includes(s))) return false;
    }
    if (filters.dateFrom && t.date < filters.dateFrom) return false;
    if (filters.dateTo && t.date > filters.dateTo) return false;
    if (filters.paidBy) {
      if (t.isSplit && Array.isArray(t.splitDetails)) { if (!t.splitDetails.some(d => d.name === filters.paidBy)) return false; }
      else if (t.paidByName !== filters.paidBy) return false;
    }
    if (filters.mode) {
      if (t.isSplit && Array.isArray(t.splitDetails)) { if (!t.splitDetails.some(d => d.mode === filters.mode)) return false; }
      else if (t.mode !== filters.mode) return false;
    }
    if (filters.amountMin !== '' && (t.amount || 0) < parseInt(filters.amountMin)) return false;
    if (filters.amountMax !== '' && (t.amount || 0) > parseInt(filters.amountMax)) return false;
    return true;
  }), [txns, search, filters]);

  const filteredTotal = useMemo(() => filtered.reduce((s, t) => s + (t.amount || 0), 0), [filtered]);

  const handleDelete = async (txn) => {
    if (!isAdmin) return;
    if (!confirm(`Delete ${txn.txnId}?\n\n${getDescription(txn)}\n₹${formatINR(txn.amount)} on ${formatDate(txn.date)}\n\nTransaction will be moved to the Recycle Bin.`)) return;
    setDeleting(txn.id);
    try {
      await updateDoc(doc(db, 'transactions', txn.id), {
        deleted: true,
        deletedAt: new Date().toISOString(),
        deletedBy: user.uid,
        deletedByName: profile?.name || user.email
      });
      setTxns(prev => prev.filter(t => t.id !== txn.id));
    } catch (e) { alert('Failed: ' + e.message); }
    finally { setDeleting(null); }
  };

  const handleSaved = (updated) => {
    setTxns(prev => prev.map(t => t.id === updated.id ? updated : t));
    setEditing(null); setSaveSuccess(true);
    setTimeout(() => setSaveSuccess(false), 3500);
  };

  if (loading) return <div className="loading-shell"><div className="spinner"></div></div>;

  return (
    <div>
      <div className="section-head">
        <div className="section-title-block">
          <span className="section-eyebrow">All entries — {activeBucket.name}</span>
          <h2>Transaction Details</h2>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn btn-ghost" onClick={() => setShowExport(true)} style={{ padding: '10px 14px' }}>
            <Download size={14} /> Export
          </button>
          {onAddEntry && <button className="btn btn-primary" onClick={onAddEntry}><Plus size={14} /> Add an Entry</button>}
        </div>
      </div>

      <div className="txn-toolbar">
        <div style={{ position: 'relative', flex: 1, minWidth: 0 }}>
          <Search size={16} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--muted)' }} />
          <input className="input" placeholder="Search by TX ID, description, user…" value={search} onChange={e => setSearch(e.target.value)} style={{ paddingLeft: 36, width: '100%' }} />
        </div>
        <button className={`btn ${showFilters || activeFilterCount > 0 ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setShowFilters(s => !s)} style={{ padding: '11px 16px', whiteSpace: 'nowrap' }}>
          <Filter size={14} /> Filters
          {activeFilterCount > 0 && <span style={{ background: 'rgba(255,255,255,0.25)', padding: '1px 7px', borderRadius: 10, fontSize: 11, fontWeight: 700, marginLeft: 2 }}>{activeFilterCount}</span>}
        </button>
        <div style={{ display: 'flex', border: '1px solid var(--cream-3)', borderRadius: 4, overflow: 'hidden' }}>
          <button onClick={() => setViewMode('table')} title="Table view" style={{ padding: '10px 12px', background: viewMode === 'table' ? 'var(--ink)' : 'transparent', color: viewMode === 'table' ? 'var(--cream)' : 'var(--muted)', border: 'none', cursor: 'pointer' }}><List size={15} /></button>
          <button onClick={() => setViewMode('timeline')} title="Timeline view" style={{ padding: '10px 12px', background: viewMode === 'timeline' ? 'var(--ink)' : 'transparent', color: viewMode === 'timeline' ? 'var(--cream)' : 'var(--muted)', border: 'none', cursor: 'pointer' }}><Clock size={15} /></button>
        </div>
      </div>

      {showFilters && <FilterPanel filters={filters} setFilters={setFilters} paidByOptions={paidByOptions} onReset={() => setFilters(emptyFilters)} />}
      {saveSuccess && <div className="alert alert-success"><CheckCircle2 size={16} style={{ display: 'inline', verticalAlign: -3, marginRight: 6 }} />Transaction updated successfully.</div>}
      {!isAdmin && <div className="read-only-banner">🔒 You can add and edit transactions. Only administrators can delete entries.</div>}
      {(activeFilterCount > 0 || search) && filtered.length > 0 && (
        <div className="filter-summary">Showing <strong>{filtered.length}</strong> of {txns.length} transactions · Total: <strong>₹{formatINR(filteredTotal)}</strong></div>
      )}

      {filtered.length === 0 ? (
        <div className="empty-state card"><h3>No transactions found</h3><p>{txns.length === 0 ? 'Add a transaction to get started.' : 'Try adjusting your search or filters.'}</p></div>
      ) : viewMode === 'timeline' ? (
        <TimelineView transactions={filtered} onView={setViewing} onEdit={setEditing} onDelete={handleDelete} onInfo={setInfo} isAdmin={isAdmin} deleting={deleting} />
      ) : (
        <>
          <div className="table-wrap desktop-only">
            <table className="txn-table">
              <thead>
                <tr><th>TX ID</th><th>Date</th><th>Paid By</th><th>Description</th><th>Mode</th><th style={{ textAlign: 'right' }}>Amount</th><th>Proof</th><th style={{ textAlign: 'center' }}>Actions</th></tr>
              </thead>
              <tbody>
                {filtered.map(t => {
                  const proofs = getProofsArray(t);
                  return (
                    <tr key={t.id}>
                      <td className="mono" style={{ fontSize: 12, color: 'var(--accent)', fontWeight: 600, whiteSpace: 'nowrap' }}>{t.txnId || '—'}</td>
                      <td className="mono" style={{ whiteSpace: 'nowrap', fontSize: 13 }}>{formatDate(t.date)}</td>
                      <td style={{ maxWidth: 200 }}>{formatPaidBy(t)}</td>
                      <td style={{ maxWidth: 320 }}><DescriptionCell text={getDescription(t)} /></td>
                      <td>
                        {t.isSplit && Array.isArray(t.splitDetails)
                          ? <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>{[...new Set(t.splitDetails.map(s => s.mode).filter(Boolean))].map(m => <span key={m} className={`mode-pill ${m.toLowerCase()}`} style={{ fontSize: 10 }}>{m}</span>)}</div>
                          : <span className={`mode-pill ${(t.mode || '').toLowerCase()}`}>{t.mode}</span>}
                      </td>
                      <td className="amount-cell" style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>₹{formatINR(t.amount)}</td>
                      <td>{proofs.length > 0 ? <button className="view-btn" onClick={() => setViewing(t)}><Eye size={12} /> View {proofs.length > 1 ? `(${proofs.length})` : ''}</button> : <span className="no-proof">none</span>}</td>
                      <td>
                        <div style={{ display: 'flex', gap: 4, justifyContent: 'center', alignItems: 'center' }}>
                          <button className="info-btn" onClick={() => setInfo(t)} title="View all details"><Info size={13} /></button>
                          <button className="btn-action btn-edit" onClick={() => setEditing(t)}><Pencil size={11} /> Edit</button>
                          {isAdmin && <button className="btn-action btn-delete btn-icon-only" onClick={() => handleDelete(t)} disabled={deleting === t.id} title="Move to Recycle Bin" aria-label="Delete">{deleting === t.id ? '…' : <Trash2 size={13} />}</button>}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="mobile-only txn-card-list">
            {filtered.map(t => <TxnCard key={t.id} t={t} canDelete={isAdmin} onView={setViewing} onEdit={setEditing} onDelete={handleDelete} onInfo={setInfo} deleting={deleting} />)}
          </div>
        </>
      )}

      {viewing && <ProofViewer txn={viewing} onClose={() => setViewing(null)} />}
      {editing && <EditModal txn={editing} approvedUsers={approvedUsers} onClose={() => setEditing(null)} onSaved={handleSaved} />}
      {info && <InfoModal txn={info} onClose={() => setInfo(null)} onViewProofs={t => { setInfo(null); setViewing(t); }} />}
      {showExport && <ExportModal onClose={() => setShowExport(false)} filtered={filtered} allTxns={txns} bucketName={activeBucket.name} />}
    </div>
  );
};

export default TransactionDetails;