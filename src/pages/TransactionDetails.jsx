import { useEffect, useState, useMemo, useRef, Fragment } from 'react';
import { collection, doc, updateDoc, addDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useAuth } from '../lib/AuthContext';
import { useBucket } from '../lib/BucketContext';
import { useTransactions } from '../lib/TransactionsContext';
import { useSplitPayment } from '../lib/useSplitPayment';
import SplitPanel from '../components/SplitPanel';
import PaidBySelect from '../components/PaidBySelect';
import { downloadDataUrl, processProofFiles, MAX_IMAGES_PER_TXN } from '../lib/fileUtils';
import { PAYMENT_MODES, getNextTxnId } from '../lib/txnUtils';
import {
  Eye, Download, X, Search, Trash2, Pencil, Upload, CheckCircle2,
  ChevronLeft, ChevronRight, ChevronDown, Filter, RotateCcw, Info, Plus,
  Link, Star, StarOff, List, Clock, FileSpreadsheet, FileText, Pin, PinOff
} from 'lucide-react';
import { formatWithCommas, parseToNumber } from '../lib/numberUtils';
import * as XLSX from 'xlsx';

// Escapes regex special characters so a raw search string can be used inside a RegExp.
const escapeRegExp = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Wraps every case-insensitive occurrence of `query` inside `text` in a <mark>,
// so a match is visually obvious wherever it shows up in the table/timeline/cards.
const Highlight = ({ text, query }) => {
  const str = text === null || text === undefined ? '' : String(text);
  const q = (query || '').trim();
  if (!q || !str) return <>{str}</>;
  const parts = str.split(new RegExp(`(${escapeRegExp(q)})`, 'ig'));
  return (
    <>
      {parts.map((part, i) => part.toLowerCase() === q.toLowerCase()
        ? <mark key={i} className="search-highlight">{part}</mark>
        : part)}
    </>
  );
};

const formatINR = (n) => new Intl.NumberFormat('en-IN').format(n || 0);
const formatDate = (d) => {
  if (!d) return '';
  try {
    const date = new Date(d);
    if (Number.isNaN(date.getTime())) return d;
    return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).replace(/ /g, '-');
  } catch {
    return d;
  }
};
const formatDateTime = (d) => { try { return new Date(d).toLocaleString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch { return d; } };

const getProofsArray = (t) => {
  if (Array.isArray(t.proofs) && t.proofs.length > 0) return t.proofs;
  if (t.proofData) return [{ dataUrl: t.proofData, type: t.proofType, name: t.proofName }];
  if (t.proofUrl) return [{ dataUrl: t.proofUrl, type: t.proofType, name: t.proofName }];
  return [];
};

// A "parent" is any transaction that has one or more child transactions linked to it.
const isParentTxn = (t) => (t.childCount || 0) > 0;
const getChildrenOf = (list, parentId) => {
  if (!parentId) return [];
  // Resolve both possible identifiers for the parent: its document id and txnId
  const parent = list.find(x => x.id === parentId);
  const parentDocId = parent ? parent.id : parentId;
  const parentTxnId = parent ? parent.txnId : (typeof parentId === 'string' && parentId.startsWith('TX_') ? parentId : null);
  return list.filter(t => {
    if (!t.isChild) return false;
    // Match any combination: child's parentId or parentTxnId may contain either the parent's doc id or txnId (legacy data)
    return (
      t.parentId === parentDocId ||
      (parentTxnId && t.parentTxnId === parentTxnId) ||
      (parentTxnId && t.parentId === parentTxnId) ||
      (t.parentTxnId === parentDocId)
    );
  }).sort((a, b) => (a.date || '').localeCompare(b.date || ''));
};

// A single transaction (parent or child) matches a search term if the term shows
// up in any of its searchable fields — used both to filter the list and to decide
// which children should surface when only a child (not its parent) matches.
const txnMatchesSearch = (t, searchLower) => {
  if (!searchLower) return true;
  return (
    (t.txnId || '').toLowerCase().includes(searchLower) ||
    (formatPaidBy(t) || '').toLowerCase().includes(searchLower) ||
    (getDescription(t) || '').toLowerCase().includes(searchLower) ||
    (formatMode(t) || '').toLowerCase().includes(searchLower) ||
    (t.date || '').includes(searchLower) ||
    String(t.amount || '').includes(searchLower)
  );
};

const NO_FILTERS = { dateFrom: '', dateTo: '', paidBy: '', mode: '', amountMin: '', amountMax: '' };
const hasActiveFilters = (filters) => Object.values(filters || NO_FILTERS).some(v => v !== '');

// A single transaction (parent or child) matches the date/paid-by/mode/amount
// filters — used the same way as txnMatchesSearch, so a child paid by someone (or
// dated, or moded) differently from its parent can still surface its parent.
const txnMatchesFilters = (t, filters) => {
  if (!filters) return true;
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
};

const txnMatchesAll = (t, searchLower, filters) => txnMatchesSearch(t, searchLower) && txnMatchesFilters(t, filters);

// Children to actually render under an expanded parent. Outside of an active
// search/filter, that's every child; while one is active, only the children that
// themselves match — so expanding a parent that only matched because of one child
// (a different payer, a different date, …) doesn't dump every unrelated sibling
// into view too.
const getVisibleChildren = (allTxns, parentId, searchLower, filters) => {
  const children = getChildrenOf(allTxns, parentId);
  if (!searchLower && !hasActiveFilters(filters)) return children;
  return children.filter(c => txnMatchesAll(c, searchLower, filters));
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
const DescriptionCell = ({ text, query }) => {
  const [expanded, setExpanded] = useState(false);
  if (!text) return null;
  // While searching, a match might sit past the truncation point — auto-expand
  // so the highlighted term is actually visible instead of hidden behind "Read more".
  const forceExpanded = expanded || (query && text.toLowerCase().includes(query.trim().toLowerCase()) && text.length > READ_MORE_THRESHOLD);
  if (text.length <= READ_MORE_THRESHOLD) return <div style={{ whiteSpace: 'normal', wordBreak: 'break-word' }}><Highlight text={text} query={query} /></div>;
  return (
    <div style={{ whiteSpace: 'normal', wordBreak: 'break-word' }}>
      <Highlight text={forceExpanded ? text : text.slice(0, READ_MORE_THRESHOLD) + '…'} query={query} />{' '}
      <button type="button" onClick={e => { e.stopPropagation(); setExpanded(v => !v); }} style={{ background: 'transparent', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontSize: 12, fontWeight: 600, padding: 0, textDecoration: 'underline', textUnderlineOffset: 2 }}>
        {forceExpanded ? 'Read less' : 'Read more'}
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

const InfoModal = ({ txn, childrenList, onClose, onViewProofs, onTogglePin }) => {
  const proofs = getProofsArray(txn);
  const isSplitTxn = txn.isSplit && Array.isArray(txn.splitDetails) && txn.splitDetails.length > 0;
  const parentFlag = (childrenList && childrenList.length > 0) || (txn.childCount || 0) > 0;
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal info-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <div style={{ fontFamily: 'Fraunces, serif', fontSize: 18, fontWeight: 600 }}>Transaction Details</div>
            <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12, color: 'var(--accent)', marginTop: 2, fontWeight: 600 }}>{txn.txnId || '—'}</div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {!txn.isChild && onTogglePin && (
              <button className={`btn-action btn-icon-only pin-toggle ${txn.isPinned ? 'active' : ''}`} onClick={() => onTogglePin(txn)} title={txn.isPinned ? 'Unpin from top' : 'Pin to top'}>
                {txn.isPinned ? <Pin size={16} /> : <PinOff size={14} />}
              </button>
            )}
            <button className="btn btn-ghost" onClick={onClose} style={{ padding: '8px 12px' }}><X size={14} /></button>
          </div>
        </div>
        <div className="info-modal-body">
          <DetailRow label="Transaction ID" value={txn.txnId} mono />
          {txn.isChild && txn.parentTxnId && <DetailRow label="Parent transaction" value={<span className="mono">{txn.parentTxnId}</span>} />}
          <DetailRow label="Bucket" value={txn.bucketName} />
          <DetailRow label="Date" value={formatDate(txn.date)} />
          <DetailRow label="Amount" value={`₹${formatINR(txn.amount)}`} />
          {parentFlag && <DetailRow label="Combined total" value={
            <span className="combined-total-badge">₹{formatINR(txn.combinedTotal)}</span>
          } />}
          {parentFlag && <DetailRow label="Related expenses" value={`${txn.childCount} linked`} />}
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
          {parentFlag && childrenList.length > 0 && (
            <DetailRow label={`Related expenses (${childrenList.length})`} value={
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {childrenList.map(c => (
                  <div key={c.id} style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '8px 10px', background: 'var(--cream-2)', borderRadius: 4 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
                      <span style={{ fontWeight: 600 }}>{getDescription(c)}</span>
                      <span style={{ fontFamily: 'JetBrains Mono, monospace', fontWeight: 600 }}>₹{formatINR(c.amount)}</span>
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--muted)' }}>{c.txnId} · {formatDate(c.date)} · {formatPaidBy(c)}</div>
                  </div>
                ))}
              </div>
            } />
          )}
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
  const { user } = useAuth();
  const existingProofs = getProofsArray(txn);
  const isSplitTxn = txn.isSplit && Array.isArray(txn.splitDetails);
  const [date, setDate] = useState(txn.date || '');
  const [amount, setAmount] = useState(formatWithCommas(String(txn.amount || '')));
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
        date, amount: parseToNumber(amount),
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
            {txn.isChild && txn.parentTxnId && <div className="alert" style={{ background: 'var(--cream-2)', color: 'var(--muted)', marginBottom: 16, fontSize: 13 }}>ℹ️ This is a related expense under <strong>{txn.parentTxnId}</strong>. Changing its amount will update that transaction's combined total.</div>}
            {!isSplitTxn && (
              <PaidBySelect
                approvedUsers={approvedUsers} user={user} paidByUid={paidByUid} setPaidByUid={setPaidByUid}
                label="Paid By" required={false}
                extraOption={!approvedUsers.some(u => u.id === paidByUid) && paidByUid ? <option value={paidByUid}>{txn.paidByName} (original)</option> : null}
              />
            )}
            <div className="form-grid">
              <div className="field"><label className="label">Date *</label><input className="input" type="date" lang="en-GB" value={date} onChange={e => setDate(e.target.value)} required /></div>
              <div className="field"><label className="label">Amount (INR) *</label><input className="input mono" type="text" inputMode="numeric" value={amount} onChange={e => setAmount(formatWithCommas(e.target.value))} required /></div>
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

// Create a new, fully independent transaction linked to a parent — used for "related expenses"
const AddChildModal = ({ parent, approvedUsers, user, profile, activeBucket, onClose, onCreated }) => {
  const today = new Date().toISOString().split('T')[0];
  const [date, setDate] = useState(today);
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [mode, setMode] = useState('');
  const [paidByUid, setPaidByUid] = useState(user?.uid || '');
  const [files, setFiles] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const split = useSplitPayment({ amount, setAmount, user });
  const { isSplit, splitTotal, validateSplit, markInvalid, buildSplitData, handleAmountChange } = split;

  const selectedUser = approvedUsers.find(u => u.id === paidByUid) || { id: user?.uid, name: profile?.name || user?.displayName || user?.email, email: user?.email };

  const handleSubmit = async (e) => {
    e.preventDefault(); setError('');
    if (!date) return setError('Date is required');
    if (!isSplit) {
      if (!amount || parseInt(amount) <= 0) return setError('Amount must be positive');
      if (!mode) return setError('Mode is required');
    }
    if (!description.trim()) return setError('Description is required');
    const splitErr = validateSplit(approvedUsers);
    if (splitErr) { markInvalid(); return setError(splitErr); }
    setSaving(true);
    try {
      let proofs = [];
      if (files.length > 0) proofs = await processProofFiles(files);
      const { sequence, id: txnId } = await getNextTxnId();
      const parsedDate = new Date(date);
      const finalAmount = isSplit ? splitTotal : parseToNumber(amount);
      const baseData = {
        txnId, txnSequence: sequence,
        bucketId: activeBucket.id, bucketName: activeBucket.name,
        createdByUid: user.uid, createdByName: profile?.name || user?.displayName || user?.email,
        date, amount: finalAmount,
        paidTo: description.trim(), description: description.trim(),
        proofs, deleted: false,
        createdAt: new Date().toISOString(),
        year: parsedDate.getFullYear(), month: parsedDate.getMonth() + 1,
        isChild: true, parentId: parent.id, parentTxnId: parent.txnId
      };
      let data;
      if (isSplit) {
        const { splitDetails, primaryMode } = buildSplitData(approvedUsers);
        data = { ...baseData, isSplit: true, splitDetails, mode: primaryMode, paidByUid: null, paidByName: 'Split Payment', paidByEmail: null };
      } else {
        data = { ...baseData, isSplit: false, mode, paidByUid: selectedUser.id, paidByName: selectedUser.name || selectedUser.email, paidByEmail: selectedUser.email };
      }
      const ref = await addDoc(collection(db, 'transactions'), data);
      onCreated({ id: ref.id, ...data });
    } catch (err) { setError(err.message || 'Failed to save'); }
    finally { setSaving(false); }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal edit-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <div style={{ fontFamily: 'Fraunces, serif', fontSize: 18, fontWeight: 600 }}>Add Related Expense</div>
            <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>Linked under {parent.txnId || ''}</div>
          </div>
          <button className="btn btn-ghost" onClick={onClose} style={{ padding: '8px 12px' }}><X size={14} /></button>
        </div>
        <form onSubmit={handleSubmit} className="edit-form">
          <div className="edit-form-body">
            {error && <div className="alert alert-error" style={{ marginBottom: 16 }}>{error}</div>}
            <div className="alert" style={{ background: 'var(--cream-2)', color: 'var(--muted)', marginBottom: 16, fontSize: 13 }}>ℹ️ This creates its own transaction (own date, payer, proof) that counts independently in reports, and adds its amount to {parent.txnId}'s combined total in this list.</div>
            <div className="form-grid">
              <div className="field"><label className="label">Date *</label><input className="input" type="date" lang="en-GB" value={date} onChange={e => setDate(e.target.value)} required />
                <div style={{ marginTop: 6, fontSize: 12, color: 'var(--muted)' }}>Selected date: {formatDate(date)}</div>
              </div>
              <div className="field"><label className="label">Amount (INR) * {isSplit && <span style={{ color: 'var(--muted)', fontWeight: 400, textTransform: 'none', letterSpacing: 0, fontSize: 11 }}>(auto-syncs)</span>}</label><input className="input mono" type="text" inputMode="numeric" value={amount} onChange={e => handleAmountChange(e.target.value)} required={!isSplit} /></div>
            </div>

            <SplitPanel split={split} approvedUsers={approvedUsers} user={user} amount={amount} />

            {!isSplit && (
              <PaidBySelect approvedUsers={approvedUsers} user={user} paidByUid={paidByUid} setPaidByUid={setPaidByUid} />
            )}
            {!isSplit && (
              <div className="field">
                <label className="label">Mode of Payment *</label>
                <select className="select" value={mode} onChange={e => setMode(e.target.value)} required>
                  <option value="">Select…</option>
                  {PAYMENT_MODES.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
            )}
            <div className="field">
              <label className="label">Description * ({description.length}/300)</label>
              <textarea className="textarea" value={description} onChange={e => setDescription(e.target.value.slice(0, 300))} maxLength="300" required />
            </div>
            <div className="field">
              <label className="label">Proof (optional · up to {MAX_IMAGES_PER_TXN} files)</label>
              {files.length > 0 && (
                <div className="file-chip-list">
                  {files.map((f, i) => (
                    <div key={i} className="file-chip">
                      <span className="file-chip-name" title={f.name}>{f.name}</span>
                      <span className="file-chip-size">{(f.size / 1024).toFixed(0)}KB</span>
                      <button type="button" onClick={() => setFiles(prev => prev.filter((_, idx) => idx !== i))} className="file-chip-remove"><X size={12} /></button>
                    </div>
                  ))}
                </div>
              )}
              {files.length < MAX_IMAGES_PER_TXN && (
                <label className="file-upload">
                  <input type="file" accept="image/*,application/pdf" multiple onChange={e => {
                    const incoming = Array.from(e.target.files || []);
                    if (files.length + incoming.length > MAX_IMAGES_PER_TXN) { setError(`Max ${MAX_IMAGES_PER_TXN} files.`); return; }
                    setFiles(prev => [...prev, ...incoming]); e.target.value = '';
                  }} />
                  <Upload size={20} />
                  <div className="file-upload-label">Click to upload</div>
                </label>
              )}
            </div>
          </div>
          <div className="edit-form-footer">
            <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Add Expense'}</button>
          </div>
        </form>
      </div>
    </div>
  );
};

const LinkToFavoriteModal = ({ txn, favoriteTxns, onClose, onSelect }) => {
  const [selectedParent, setSelectedParent] = useState(favoriteTxns[0]?.id || '');
  const [error, setError] = useState('');

  if (!txn) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal edit-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <div style={{ fontFamily: 'Fraunces, serif', fontSize: 18, fontWeight: 600 }}>Link to Favorite Transaction</div>
            <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>Attach {txn.txnId || ''} as a related expense to a favorite transaction.</div>
          </div>
          <button className="btn btn-ghost" onClick={onClose} style={{ padding: '8px 12px' }}><X size={14} /></button>
        </div>
        <form onSubmit={e => {
          e.preventDefault();
          if (!selectedParent) { setError('Select a favorite transaction'); return; }
          const parent = favoriteTxns.find(t => t.id === selectedParent);
          if (!parent) { setError('Selected transaction is invalid'); return; }
          onSelect(parent);
        }} className="edit-form">
          <div className="edit-form-body">
            {error && <div className="alert alert-error" style={{ marginBottom: 16 }}>{error}</div>}
            <div className="field">
              <label className="label">Favorite transaction *</label>
              <select className="select" value={selectedParent} onChange={e => setSelectedParent(e.target.value)} required>
                <option value="">Select…</option>
                {favoriteTxns.map(fav => (
                  <option key={fav.id} value={fav.id}>{fav.txnId} · ₹{formatINR(fav.amount)} · {getDescription(fav).slice(0, 40)}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label className="label">Child transaction</label>
              <div style={{ padding: '10px 12px', border: '1px solid var(--cream-3)', borderRadius: 'var(--radius)', background: 'rgba(255,252,245,0.6)' }}>
                <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>{txn.txnId}</div>
                <div style={{ fontSize: 14, fontWeight: 600 }}>₹{formatINR(txn.amount)}</div>
                <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 2 }}>{getDescription(txn)}</div>
              </div>
            </div>
          </div>
          <div className="edit-form-footer">
            <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary">Link as Child</button>
          </div>
        </form>
      </div>
    </div>
  );
};

const FilterPanel = ({ filters, setFilters, paidByOptions, onReset }) => (
  <div className="filter-panel">
    <div className="filter-panel-grid">
      <div className="field" style={{ marginBottom: 0 }}><label className="label">Date — from</label><input className="input" type="date" lang="en-GB" value={filters.dateFrom} onChange={e => setFilters(f => ({ ...f, dateFrom: e.target.value }))} /></div>
      <div className="field" style={{ marginBottom: 0 }}><label className="label">Date — to</label><input className="input" type="date" lang="en-GB" value={filters.dateTo} onChange={e => setFilters(f => ({ ...f, dateTo: e.target.value }))} /></div>
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

// Timeline view — grouped by month. Children are nested inside their parent's card, not
// re-bucketed by their own month, so the group stays anchored to the parent's date.
const TimelineView = ({ transactions, allTxns, expandedIds, onToggleExpand, onView, onEdit, onDelete, onInfo, onAddChild, onToggleFavorite, onLinkToFavorite, onRemoveFromParent, favoriteParents, isAdmin, deleting, search, filters }) => {
  const searchLower = (search || '').toLowerCase();
  const grouped = useMemo(() => {
    const map = new Map();
    transactions.forEach(t => {
      const key = `${t.year || new Date(t.date).getFullYear()}-${String(t.month || new Date(t.date).getMonth() + 1).padStart(2, '0')}`;
      const label = new Date(t.date).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
      if (!map.has(key)) map.set(key, { label, items: [], total: 0 });
      // A related expense counts toward its parent month's total too, not just the parent's own amount.
      const childSum = getChildrenOf(allTxns, t.id).reduce((s, c) => s + (c.amount || 0), 0);
      map.get(key).items.push(t);
      map.get(key).total += (t.amount || 0) + childSum;
    });
    return Array.from(map.entries()).sort((a, b) => b[0].localeCompare(a[0]));
  }, [transactions, allTxns]);

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
              const allChildren = getChildrenOf(allTxns, t.id);
              const children = getVisibleChildren(allTxns, t.id, searchLower, filters);
              const parentFlag = allChildren.length > 0 || (t.childCount || 0) > 0;
              const expanded = expandedIds.has(t.id);
              return (
                <div key={t.id} className="timeline-item">
                  <div className="timeline-dot" />
                  <div className="timeline-item-card">
                    <div className="timeline-item-top">
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                        <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10, color: 'var(--accent)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}>
                          {t.isPinned && <Pin size={11} />}
                          <Highlight text={t.txnId || ''} query={search} />
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--muted)' }}>{formatDate(t.date)}</div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontFamily: 'Fraunces, serif', fontWeight: 700, fontSize: 16 }}>₹{formatINR(t.amount)}</div>
                        {parentFlag && <div className="combined-total-badge">₹{formatINR(t.combinedTotal)} total</div>}
                      </div>
                    </div>
                    <div style={{ fontSize: 14, margin: '6px 0', wordBreak: 'break-word' }}><DescriptionCell text={getDescription(t)} query={search} /></div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
                      <span className={`mode-pill ${(t.mode || '').toLowerCase()}`}><Highlight text={formatMode(t)} query={search} /></span>
                      <span style={{ fontSize: 12, color: 'var(--muted)' }}>· <Highlight text={formatPaidBy(t)} query={search} /></span>
                    </div>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {proofs.length > 0
                        ? <button className="view-btn" onClick={() => onView(t)}><Eye size={12} /> View {proofs.length > 1 ? `(${proofs.length})` : ''}</button>
                        : <span className="no-proof" style={{ fontSize: 11 }}>no proof</span>}
                      <button className="info-btn" onClick={() => onInfo(t)} title="Details"><Info size={13} /></button>
                      <button className={`btn-action btn-icon-only star-toggle ${t.isFavorite ? 'active' : ''}`} onClick={() => onToggleFavorite(t)} title={t.isFavorite ? 'Unfavorite' : 'Favorite'}>
                        {t.isFavorite ? <Star size={16} /> : <StarOff size={14} />}
                      </button>
                      {!t.isChild && !t.isFavorite && favoriteParents.length > 0 && (
                        <button className="btn-action btn-icon-only" onClick={() => onLinkToFavorite(t)} title="Link to favorite transaction"><Link size={16} /></button>
                      )}
                      <button className="btn-action btn-items" onClick={() => onAddChild(t)} title="Add related expense"><Plus size={11} /> Add</button>
                      <button className="btn-action btn-edit btn-icon-only" onClick={() => onEdit(t)} title="Edit"><Pencil size={11} /></button>
                      {isAdmin && <button className="btn-action btn-delete btn-icon-only" onClick={() => onDelete(t)} disabled={deleting === t.id} title="Delete">{deleting === t.id ? '…' : <Trash2 size={13} />}</button>}
                      {parentFlag && (
                        <button className="btn-action btn-items" onClick={() => onToggleExpand(t.id)}>
                          {expanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />} {children.length} related
                        </button>
                      )}
                    </div>
                    {parentFlag && expanded && (
                      <div className="timeline-children">
                        {children.map(c => {
                          const cProofs = getProofsArray(c);
                          return (
                            <div key={c.id} className="timeline-child-card">
                              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                                <div style={{ minWidth: 0 }}>
                                  <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10, color: 'var(--accent)', fontWeight: 600 }}>↳ <Highlight text={c.txnId} query={search} /></div>
                                  <div style={{ fontSize: 12, color: 'var(--muted)' }}>{formatDate(c.date)}</div>
                                </div>
                                <div style={{ fontWeight: 700, fontFamily: 'JetBrains Mono, monospace' }}>₹{formatINR(c.amount)}</div>
                              </div>
                              <div style={{ fontSize: 13, margin: '4px 0', wordBreak: 'break-word' }}><DescriptionCell text={getDescription(c)} query={search} /></div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                                <span className={`mode-pill ${(c.mode || '').toLowerCase()}`} style={{ fontSize: 10 }}><Highlight text={c.mode} query={search} /></span>
                                <span style={{ fontSize: 11, color: 'var(--muted)' }}>· <Highlight text={formatPaidBy(c)} query={search} /></span>
                                {cProofs.length > 0
                                  ? <button className="view-btn" onClick={() => onView(c)}><Eye size={11} /> View</button>
                                  : <span className="no-proof" style={{ fontSize: 10 }}>no proof</span>}
                                <div style={{ display: 'flex', gap: 4, marginLeft: 'auto' }}>
                                  <button className="btn-action btn-edit" onClick={() => onEdit(c)}><Pencil size={10} /></button>
                                  {onRemoveFromParent && <button className="btn-action btn-icon-only" onClick={() => onRemoveFromParent(c)} title="Remove from parent"><RotateCcw size={12} /></button>}
                                  {isAdmin && <button className="btn-action btn-delete btn-icon-only" onClick={() => onDelete(c)} disabled={deleting === c.id} title="Delete"><Trash2 size={11} /></button>}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
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
const TxnCard = ({ t, allTxns, expanded, onToggleExpand, canDelete, onView, onEdit, onDelete, onInfo, onAddChild, onToggleFavorite, onLinkToFavorite, onRemoveFromParent, favoriteParents, deleting, search, filters }) => {
  const searchLower = (search || '').toLowerCase();
  const proofs = getProofsArray(t);
  const allChildren = getChildrenOf(allTxns, t.id);
  const children = getVisibleChildren(allTxns, t.id, searchLower, filters);
  const parentFlag = allChildren.length > 0 || (t.childCount || 0) > 0;
  return (
    <div className="txn-card">
      <div className="txn-card-row">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <div className="txn-card-id" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            {t.isPinned && <Pin size={12} style={{ color: 'var(--accent)' }} />}
            <Highlight text={t.txnId || ''} query={search} />
          </div>
          <div className="txn-card-date">{formatDate(t.date)}</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div className="txn-card-amount">₹{formatINR(t.amount)}</div>
          {parentFlag && <div className="combined-total-badge">₹{formatINR(t.combinedTotal)} total</div>}
        </div>
      </div>
      <div className="txn-card-paidto"><DescriptionCell text={getDescription(t)} query={search} /></div>
      <div className="txn-card-row" style={{ marginTop: 6 }}>
        <div className="txn-card-meta">
          <span className={`mode-pill ${(t.mode || '').toLowerCase()}`}><Highlight text={formatMode(t)} query={search} /></span>
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>· <Highlight text={formatPaidBy(t)} query={search} /></span>
        </div>
      </div>
      <div className="txn-card-actions">
        {proofs.length > 0 ? <button className="view-btn" onClick={() => onView(t)}><Eye size={12} /> {proofs.length > 1 ? `View (${proofs.length})` : 'View'}</button> : <span className="no-proof">no proof</span>}
          <div style={{ display: 'flex', gap: 6, marginLeft: 'auto', flexWrap: 'wrap' }}>
          <button className="info-btn" onClick={() => onInfo(t)} title="Details"><Info size={13} /></button>
          {t.isChild ? (
            onRemoveFromParent && <button className="btn-action btn-icon-only" onClick={() => onRemoveFromParent(t)} title="Remove from parent"><RotateCcw size={14} /></button>
          ) : (
            <>
              <button className={`btn-action btn-icon-only star-toggle ${t.isFavorite ? 'active' : ''}`} onClick={() => onToggleFavorite(t)} title={t.isFavorite ? 'Unfavorite' : 'Favorite'}>
                {t.isFavorite ? <Star size={16} /> : <StarOff size={14} />}
              </button>
              {!t.isFavorite && favoriteParents.length > 0 && (
                <button className="btn-action btn-icon-only" onClick={() => onLinkToFavorite(t)} title="Link to favorite transaction"><Link size={16} /></button>
              )}
              <button className="btn-action btn-items" onClick={() => onAddChild(t)} title="Add related expense"><Plus size={11} /> Add</button>
            </>
          )}
          <button className="btn-action btn-edit btn-icon-only" onClick={() => onEdit(t)} title="Edit"><Pencil size={11} /></button>
          {canDelete && <button className="btn-action btn-delete btn-icon-only" onClick={() => onDelete(t)} disabled={deleting === t.id} title="Delete" aria-label="Delete">{deleting === t.id ? '…' : <Trash2 size={13} />}</button>}
        </div>
      </div>
      {parentFlag && (
        <button className="btn-action btn-items" style={{ marginTop: 8, width: '100%', justifyContent: 'center' }} onClick={() => onToggleExpand(t.id)}>
          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />} {children.length} related expense{children.length !== 1 ? 's' : ''}
        </button>
      )}
      {parentFlag && expanded && (
        <div className="txn-card-children">
          {children.map(c => (
            <div key={c.id} className="txn-card-child">
              <div className="txn-card-row">
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <div className="txn-card-id">↳ <Highlight text={c.txnId} query={search} /></div>
                  <div className="txn-card-date">{formatDate(c.date)}</div>
                </div>
                <div className="txn-card-amount">₹{formatINR(c.amount)}</div>
              </div>
              <div className="txn-card-paidto"><DescriptionCell text={getDescription(c)} query={search} /></div>
              <div className="txn-card-row" style={{ marginTop: 4 }}>
                <div className="txn-card-meta">
                  <span className={`mode-pill ${(c.mode || '').toLowerCase()}`}><Highlight text={formatMode(c)} query={search} /></span>
                  <span style={{ fontSize: 11, color: 'var(--muted)' }}>· <Highlight text={formatPaidBy(c)} query={search} /></span>
                </div>
              </div>
              <div className="txn-card-actions">
                {getProofsArray(c).length > 0 ? <button className="view-btn" onClick={() => onView(c)}><Eye size={11} /> View</button> : <span className="no-proof">no proof</span>}
                <div style={{ display: 'flex', gap: 6, marginLeft: 'auto' }}>
                  <button className="btn-action btn-edit" onClick={() => onEdit(c)}><Pencil size={10} /></button>
                  {onRemoveFromParent && <button className="btn-action btn-icon-only" onClick={() => onRemoveFromParent(c)} title="Remove from parent"><RotateCcw size={11} /></button>}
                  {canDelete && <button className="btn-action btn-delete btn-icon-only" onClick={() => onDelete(c)} disabled={deleting === c.id} title="Delete"><Trash2 size={11} /></button>}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// Desktop table row — shared by top-level transactions and their nested child rows
const TxnRow = ({ t, isChildRow, expanded, hasChildren, onToggleExpand, onView, onEdit, onDelete, onInfo, onAddChild, onToggleFavorite, onLinkToFavorite, onRemoveFromParent, favoriteParents, isAdmin, deleting, search }) => {
  const proofs = getProofsArray(t);
  const parentFlag = !isChildRow && (hasChildren || (t.childCount || 0) > 0);
  return (
    <tr className={isChildRow ? 'txn-row-child' : ''}>
      <td className="mono" style={{ fontSize: 12, color: 'var(--accent)', fontWeight: 600, whiteSpace: 'nowrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, paddingLeft: isChildRow ? 16 : 0 }}>
          {parentFlag && (
            <button type="button" className="expand-toggle" onClick={() => onToggleExpand(t.id)} title={expanded ? 'Collapse' : 'Expand'}>
              {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
            </button>
          )}
          {isChildRow && <span style={{ color: 'var(--muted)' }}>↳</span>}
          {!isChildRow && t.isPinned && <Pin size={12} style={{ color: 'var(--accent)' }} />}
          <Highlight text={t.txnId || '—'} query={search} />
        </div>
      </td>
      <td className="mono" style={{ whiteSpace: 'nowrap', fontSize: 13 }}>{formatDate(t.date)}</td>
      <td style={{ maxWidth: 200 }}><Highlight text={formatPaidBy(t)} query={search} /></td>
      <td style={{ maxWidth: 320 }}><DescriptionCell text={getDescription(t)} query={search} /></td>
      <td>
        {t.isSplit && Array.isArray(t.splitDetails)
          ? <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>{[...new Set(t.splitDetails.map(s => s.mode).filter(Boolean))].map(m => <span key={m} className={`mode-pill ${m.toLowerCase()}`} style={{ fontSize: 10 }}><Highlight text={m} query={search} /></span>)}</div>
          : <span className={`mode-pill ${(t.mode || '').toLowerCase()}`}><Highlight text={t.mode} query={search} /></span>}
      </td>
      <td className="amount-cell" style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
        ₹{formatINR(t.amount)}
        {parentFlag && <div className="combined-total-badge">₹{formatINR(t.combinedTotal)} total</div>}
      </td>
      <td>{proofs.length > 0 ? <button className="view-btn" onClick={() => onView(t)}><Eye size={12} /> View {proofs.length > 1 ? `(${proofs.length})` : ''}</button> : <span className="no-proof">none</span>}</td>
      <td>
        <div style={{ display: 'flex', gap: 4, justifyContent: 'center', alignItems: 'center', flexWrap: 'wrap' }}>
          <button className="info-btn" onClick={() => onInfo(t)} title="View all details"><Info size={13} /></button>
          {t.isChild ? (
            onRemoveFromParent && <button className="btn-action btn-icon-only" onClick={() => onRemoveFromParent(t)} title="Remove from parent"><RotateCcw size={14} /></button>
          ) : (
            <>
              <button className={`btn-action btn-icon-only star-toggle ${t.isFavorite ? 'active' : ''}`} onClick={() => onToggleFavorite(t)} title={t.isFavorite ? 'Unfavorite' : 'Favorite'}>
                {t.isFavorite ? <Star size={16} /> : <StarOff size={14} />}
              </button>
              {!t.isFavorite && favoriteParents.length > 0 && (
                <button className="btn-action btn-icon-only" onClick={() => onLinkToFavorite(t)} title="Link to favorite transaction"><Link size={16} /></button>
              )}
              <button className="btn-action btn-items" onClick={() => onAddChild(t)} title="Add related expense"><Plus size={11} /> Add</button>
            </>
          )}
          <button className="btn-action btn-edit btn-icon-only" onClick={() => onEdit(t)} title="Edit"><Pencil size={11} /></button>
          {isAdmin && <button className="btn-action btn-delete btn-icon-only" onClick={() => onDelete(t)} disabled={deleting === t.id} title="Move to Recycle Bin" aria-label="Delete">{deleting === t.id ? '…' : <Trash2 size={13} />}</button>}
        </div>
      </td>
    </tr>
  );
};

// Export modal
// Flattens a list of top-level transactions back out with each one's children placed
// immediately after it — regardless of scope, so the parent/child relationship reads
// as a group rather than children being scattered wherever their own createdAt lands.
const buildExportRows = (topLevelList, allTxns) => {
  const result = [];
  topLevelList.forEach(t => { result.push(t); result.push(...getChildrenOf(allTxns, t.id)); });
  return result;
};

const exportRelationshipLabel = (t) => {
  if (t.isChild) return `Related to ${t.parentTxnId || '—'}`;
  if ((t.childCount || 0) > 0) return `Parent · ${t.childCount} related`;
  return '';
};

const ExportModal = ({ onClose, filteredTopLevel, allTxns, bucketName }) => {
  const [scope, setScope] = useState('filtered');
  const allTopLevel = useMemo(() => allTxns.filter(t => !t.isChild), [allTxns]);
  const data = useMemo(() => buildExportRows(scope === 'filtered' ? filteredTopLevel : allTopLevel, allTxns), [scope, filteredTopLevel, allTopLevel, allTxns]);
  const filteredCount = useMemo(() => buildExportRows(filteredTopLevel, allTxns).length, [filteredTopLevel, allTxns]);

  const exportExcel = () => {
    const rows = data.map(t => ({
      'TX ID': `${t.isChild ? '↳ ' : ''}${t.txnId || ''}`,
      'Relationship': exportRelationshipLabel(t),
      'Date': t.date,
      'Paid By': formatPaidBy(t),
      'Description': getDescription(t),
      'Mode': formatMode(t),
      'Amount (₹)': t.amount || 0,
      'Combined Total (₹)': (!t.isChild && (t.childCount || 0) > 0) ? (t.combinedTotal || 0) : '',
      'Bucket': t.bucketName || bucketName
    }));
    const total = data.reduce((s, t) => s + (t.amount || 0), 0);
    rows.push({ 'TX ID': '', 'Relationship': '', 'Date': '', 'Paid By': '', 'Description': 'TOTAL (parent + related expenses)', 'Mode': '', 'Amount (₹)': total, 'Combined Total (₹)': '', 'Bucket': '' });
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
        body { font-family: Georgia, serif; color: #1a1815; padding: 32px; max-width: 960px; margin: 0 auto; }
        h1 { font-size: 24px; margin-bottom: 4px; }
        .meta { color: #6b6357; font-size: 13px; margin-bottom: 24px; }
        table { width: 100%; border-collapse: collapse; font-size: 13px; }
        th { text-align: left; padding: 8px 12px; background: #ebe1d0; border-bottom: 2px solid #ded2bd; font-size: 11px; text-transform: uppercase; letter-spacing: 0.1em; }
        td { padding: 10px 12px; border-bottom: 1px solid #ded2bd; }
        tr:last-child td { border-bottom: none; }
        tr.row-parent td { font-weight: 700; }
        tr.row-child td { background: #faf6ee; color: #4a443b; font-style: italic; }
        .amount { font-family: monospace; text-align: right; font-weight: 600; }
        .relationship { font-size: 11px; color: #6b6357; font-style: normal; }
        tfoot td { background: #ebe1d0; font-weight: 700; }
        @media print { body { padding: 0; } }
      </style></head><body>
      <h1>${bucketName} — Transactions</h1>
      <div class="meta">Exported on ${new Date().toLocaleDateString('en-IN')} · ${data.length} transactions (parent + related expenses) · Total: ₹${formatINRLocal(total)}</div>
      <table>
        <thead><tr><th>TX ID</th><th>Relationship</th><th>Date</th><th>Paid By</th><th>Description</th><th>Mode</th><th style="text-align:right">Amount</th><th style="text-align:right">Combined Total</th></tr></thead>
        <tbody>
          ${data.map(t => {
            const isParentWithChildren = !t.isChild && (t.childCount || 0) > 0;
            const rowClass = t.isChild ? 'row-child' : (isParentWithChildren ? 'row-parent' : '');
            return `<tr class="${rowClass}">
            <td style="font-family:monospace;font-size:11px;color:#b8451f">${t.isChild ? '&nbsp;&nbsp;↳ ' : ''}${t.txnId || '—'}</td>
            <td class="relationship">${exportRelationshipLabel(t)}</td>
            <td>${formatDate(t.date)}</td>
            <td>${formatPaidBy(t)}</td>
            <td>${getDescription(t)}</td>
            <td>${formatMode(t)}</td>
            <td class="amount">₹${formatINRLocal(t.amount)}</td>
            <td class="amount">${isParentWithChildren ? `₹${formatINRLocal(t.combinedTotal)}` : ''}</td>
          </tr>`;
          }).join('')}
        </tbody>
        <tfoot><tr><td colspan="6">Total (parent + related expenses)</td><td class="amount">₹${formatINRLocal(total)}</td><td></td></tr></tfoot>
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
            <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8 }}>Related expenses are grouped right under their parent transaction, and the total adds up every parent and related expense together.</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderRadius: 6, border: `2px solid ${scope === 'filtered' ? 'var(--accent)' : 'var(--cream-3)'}`, cursor: 'pointer', background: scope === 'filtered' ? 'rgba(184,69,31,0.04)' : 'var(--cream-2)' }}>
                <input type="radio" name="scope" value="filtered" checked={scope === 'filtered'} onChange={() => setScope('filtered')} style={{ accentColor: 'var(--accent)' }} />
                <div>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>Current view ({filteredCount} rows)</div>
                  <div style={{ fontSize: 12, color: 'var(--muted)' }}>Respects active search and filters</div>
                </div>
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderRadius: 6, border: `2px solid ${scope === 'all' ? 'var(--accent)' : 'var(--cream-3)'}`, cursor: 'pointer', background: scope === 'all' ? 'rgba(184,69,31,0.04)' : 'var(--cream-2)' }}>
                <input type="radio" name="scope" value="all" checked={scope === 'all'} onChange={() => setScope('all')} style={{ accentColor: 'var(--accent)' }} />
                <div>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>All transactions ({allTxns.length} rows)</div>
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

// "Recent Activity" — the most recently saved transactions, flattened across
// parents and children (a freshly added related expense should be just as
// visible here as a freshly added standalone one), plus a day-by-day count of
// how many entries were saved over the last week.
const RecentActivityPanel = ({ allTxns, onOpenInfo }) => {
  const recent = useMemo(() => {
    return allTxns
      .map(t => ({ t, activityAt: t.updatedAt || t.createdAt }))
      .filter(x => x.activityAt)
      .sort((a, b) => (b.activityAt || '').localeCompare(a.activityAt || ''))
      .slice(0, 5)
      .map(x => x.t);
  }, [allTxns]);

  // Counts AND sums every transaction saved that day — parent and child alike,
  // since a related expense is just as much "saved on that date" as its parent.
  const dailyCounts = useMemo(() => {
    const stats = new Map();
    allTxns.forEach(t => {
      const activityAt = t.updatedAt || t.createdAt;
      if (!activityAt) return;
      const dateKey = String(activityAt).split('T')[0];
      const prev = stats.get(dateKey) || { count: 0, total: 0 };
      prev.count += 1;
      prev.total += t.amount || 0;
      stats.set(dateKey, prev);
    });
    const days = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = d.toISOString().split('T')[0];
      const s = stats.get(key) || { count: 0, total: 0 };
      days.push({ key, count: s.count, total: s.total });
    }
    return days;
  }, [allTxns]);

  if (recent.length === 0) return null;
  const latest = recent[0];
  const latestActivityAt = latest.updatedAt || latest.createdAt;

  return (
    <div className="card recent-activity-card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
        <div style={{ fontFamily: 'Fraunces, serif', fontWeight: 600, fontSize: 15 }}>Recent Activity</div>
        <div style={{ fontSize: 12, color: 'var(--muted)' }}>Last saved {formatDateTime(latestActivityAt)}</div>
      </div>
      <div className="recent-activity-grid">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {recent.map(t => (
            <button key={t.id} type="button" onClick={() => onOpenInfo(t)} className="recent-activity-row">
              <span className="mono" style={{ color: 'var(--accent)', fontWeight: 600, fontSize: 11, whiteSpace: 'nowrap' }}>{t.isChild ? '↳ ' : ''}{t.txnId}</span>
              <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 13 }}>{getDescription(t)}</span>
              <span style={{ fontSize: 12, color: 'var(--muted)', whiteSpace: 'nowrap' }}>{formatPaidBy(t)}</span>
              <span className="mono" style={{ fontWeight: 600, fontSize: 13, whiteSpace: 'nowrap' }}>₹{formatINR(t.amount)}</span>
            </button>
          ))}
        </div>
        <div className="recent-activity-days">
          <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--muted)', marginBottom: 6 }}>Saved in last 7 days</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {dailyCounts.map(({ key, count, total }) => (
              <div key={key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, fontSize: 12, opacity: count === 0 ? 0.5 : 1 }}>
                <span>{formatDate(key)}</span>
                <span style={{ textAlign: 'right' }}>
                  <span className="mono" style={{ fontWeight: 600 }}>{count}</span>
                  {count > 0 && <span className="mono" style={{ color: 'var(--muted)', marginLeft: 6, fontSize: 11 }}>₹{formatINR(total)}</span>}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

const TransactionDetails = ({ onAddEntry }) => {
  const { user, profile, isAdmin } = useAuth();
  const { activeBucket } = useBucket();
  const { txns, loading, approvedUsers, applyAdd, applyUpdate, applyRemove } = useTransactions();
  const [search, setSearch] = useState('');
  const [viewing, setViewing] = useState(null);
  const [editing, setEditing] = useState(null);
  const [info, setInfo] = useState(null);
  const [addChildFor, setAddChildFor] = useState(null);
  const [linkToFavoriteFor, setLinkToFavoriteFor] = useState(null);
  const [expandedIds, setExpandedIds] = useState(new Set());
  const [deleting, setDeleting] = useState(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [viewMode, setViewMode] = useState('table'); // 'table' | 'timeline'
  const [showExport, setShowExport] = useState(false);
  const [showRecentActivity, setShowRecentActivity] = useState(false);
  const emptyFilters = { dateFrom: '', dateTo: '', paidBy: '', mode: '', amountMin: '', amountMax: '' };
  const [filters, setFilters] = useState(emptyFilters);

  // Top-level transactions are what the list shows; children only surface when their parent is expanded.
  const topLevel = useMemo(() => txns.filter(t => !t.isChild), [txns]);
  const favoriteParents = useMemo(() => topLevel.filter(t => t.isFavorite), [topLevel]);
  const sortedTopLevel = useMemo(() => {
    return [...topLevel].sort((a, b) => {
      if (a.isPinned && !b.isPinned) return -1;
      if (!a.isPinned && b.isPinned) return 1;
      if (a.isPinned && b.isPinned) {
        return (b.pinnedAt || '').localeCompare(a.pinnedAt || '') || (b.date || '').localeCompare(a.date || '');
      }
      if (a.isFavorite && !b.isFavorite) return -1;
      if (!a.isFavorite && b.isFavorite) return 1;
      if (a.isFavorite && b.isFavorite) {
        return (b.favoriteAt || '').localeCompare(a.favoriteAt || '') || (b.date || '').localeCompare(a.date || '');
      }
      return (b.date || '').localeCompare(a.date || '');
    });
  }, [topLevel]);

  const toggleExpand = (id) => setExpandedIds(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  // Auto-expand any parent whose match (search term, paid-by, date range, mode, or
  // amount filter) is only in one of its children, so the reason it showed up in
  // the results is actually visible without an extra click.
  useEffect(() => {
    if (!search && !hasActiveFilters(filters)) return;
    const s = search.toLowerCase();
    setExpandedIds(prev => {
      let changed = false;
      const next = new Set(prev);
      topLevel.forEach(t => {
        if (next.has(t.id)) return;
        if (txnMatchesAll(t, s, filters)) return;
        if (getChildrenOf(txns, t.id).some(c => txnMatchesAll(c, s, filters))) { next.add(t.id); changed = true; }
      });
      return changed ? next : prev;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, filters]);

  const recomputeParentTotals = async (parentId, currentTxns) => {
    const parent = currentTxns.find(t => t.id === parentId);
    if (!parent) return;
    const children = getChildrenOf(currentTxns, parentId);
    const childCount = children.length;
    const childTotal = children.reduce((s, c) => s + (c.amount || 0), 0);
    const combinedTotal = childCount > 0 ? (parent.amount || 0) + childTotal : 0;
    const updates = { childCount, childTotal, combinedTotal };
    try {
      await updateDoc(doc(db, 'transactions', parentId), updates);
      applyUpdate(parentId, updates);
    } catch (e) { console.error(e); }
  };

  // Scans every transaction, not just top-level ones, so someone who only ever
  // appears as the payer on a related (child) expense still shows up as a
  // selectable option here.
  const paidByOptions = useMemo(() => {
    const s = new Set();
    txns.forEach(t => {
      if (t.isSplit && Array.isArray(t.splitDetails)) t.splitDetails.forEach(d => d.name && s.add(d.name));
      else if (t.paidByName) s.add(t.paidByName);
    });
    return Array.from(s).sort();
  }, [txns]);

  const activeFilterCount = useMemo(() => Object.values(filters).filter(v => v !== '').length, [filters]);

  // A parent stays visible if it matches the search term AND every active filter
  // (date range, paid by, mode, amount) itself, OR if one of its related (child)
  // expenses does — e.g. filtering "Paid by: Bob" surfaces a parent whose only
  // connection to Bob is a related expense he paid for, not just parents Bob paid
  // directly. getVisibleChildren then narrows which children actually render.
  const filtered = useMemo(() => {
    const s = search.toLowerCase();
    return sortedTopLevel.filter(t => {
      const matchesSelf = txnMatchesAll(t, s, filters);
      const matchesChild = getChildrenOf(txns, t.id).some(c => txnMatchesAll(c, s, filters));
      return matchesSelf || matchesChild;
    });
  }, [sortedTopLevel, search, filters, txns]);

  // Matches a parent's own amount with every one of its related expenses, not just
  // the parent — so this total agrees with the per-row "combined total" badges and
  // with the Dashboard, instead of silently dropping every child's amount.
  const filteredTotal = useMemo(() => filtered.reduce((s, t) => {
    const childSum = getChildrenOf(txns, t.id).reduce((cs, c) => cs + (c.amount || 0), 0);
    return s + (t.amount || 0) + childSum;
  }, 0), [filtered, txns]);

  const handleDelete = async (txn) => {
    if (!isAdmin) return;
    if (!txn.isChild) {
      const kids = getChildrenOf(txns, txn.id);
      if (kids.length > 0) { alert(`${txn.txnId} has ${kids.length} related expense(s) linked to it. Delete or reassign those first.`); return; }
    }
    if (!confirm(`Delete ${txn.txnId}?\n\n${getDescription(txn)}\n₹${formatINR(txn.amount)} on ${formatDate(txn.date)}\n\nTransaction will be moved to the Recycle Bin.`)) return;
    setDeleting(txn.id);
    try {
      await updateDoc(doc(db, 'transactions', txn.id), {
        deleted: true,
        deletedAt: new Date().toISOString(),
        deletedBy: user.uid,
        deletedByName: profile?.name || user.email
      });
      const nextTxns = txns.filter(t => t.id !== txn.id);
      applyRemove(txn.id);
      if (txn.isChild && txn.parentId) await recomputeParentTotals(txn.parentId, nextTxns);
    } catch (e) { alert('Failed: ' + e.message); }
    finally { setDeleting(null); }
  };

  const handleSaved = (updated) => {
    const nextTxns = txns.map(t => t.id === updated.id ? updated : t);
    applyUpdate(updated.id, updated);
    setEditing(null); setSaveSuccess(true);
    setTimeout(() => setSaveSuccess(false), 3500);
    if (updated.isChild && updated.parentId) recomputeParentTotals(updated.parentId, nextTxns);
    else if (isParentTxn(updated)) recomputeParentTotals(updated.id, nextTxns);
  };

  const handleChildAdded = (newChild) => {
    const nextTxns = [newChild, ...txns];
    applyAdd(newChild);
    setAddChildFor(null);
    recomputeParentTotals(newChild.parentId, nextTxns);
    setExpandedIds(prev => new Set(prev).add(newChild.parentId));
  };

  const toggleFavorite = async (txn) => {
    try {
      const updates = {
        isFavorite: !txn.isFavorite,
        favoriteByUid: !txn.isFavorite ? user.uid : null,
        favoriteByName: !txn.isFavorite ? (profile?.name || user?.displayName || user?.email) : null,
        favoriteAt: !txn.isFavorite ? new Date().toISOString() : null
      };
      await updateDoc(doc(db, 'transactions', txn.id), updates);
      applyUpdate(txn.id, updates);
    } catch (e) {
      alert('Failed to update favorite: ' + (e.message || e));
    }
  };

  const togglePin = async (txn) => {
    try {
      const updates = {
        isPinned: !txn.isPinned,
        pinnedAt: !txn.isPinned ? new Date().toISOString() : null
      };
      await updateDoc(doc(db, 'transactions', txn.id), updates);
      applyUpdate(txn.id, updates);
    } catch (e) {
      alert('Failed to update pin: ' + (e.message || e));
    }
  };

  const linkTxnToFavorite = async (txn, parent) => {
    try {
      const updates = { isChild: true, parentId: parent.id, parentTxnId: parent.txnId, updatedAt: new Date().toISOString() };
      await updateDoc(doc(db, 'transactions', txn.id), updates);
      const nextTxns = txns.map(t => t.id === txn.id ? { ...t, ...updates } : t);
      applyUpdate(txn.id, updates);
      setLinkToFavoriteFor(null);
      recomputeParentTotals(parent.id, nextTxns);
    } catch (e) {
      alert('Failed to link transaction: ' + (e.message || e));
    }
  };

  const removeChildFromParent = async (txn) => {
    if (!txn || !txn.isChild) return;
    if (!confirm(`Unlink ${txn.txnId} from ${txn.parentTxnId || 'its parent'}?\n\nIt will become a standalone transaction.`)) return;
    const prevParentId = txn.parentId;
    try {
      const updates = { isChild: false, parentId: null, parentTxnId: null, updatedAt: new Date().toISOString() };
      await updateDoc(doc(db, 'transactions', txn.id), updates);
      const nextTxns = txns.map(t => t.id === txn.id ? { ...t, ...updates } : t);
      applyUpdate(txn.id, updates);
      if (prevParentId) await recomputeParentTotals(prevParentId, nextTxns);
    } catch (e) {
      alert('Failed to remove related expense: ' + (e.message || e));
    }
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
          <button className={`btn ${showRecentActivity ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setShowRecentActivity(s => !s)} style={{ padding: '10px 14px' }} title="Recent Activity">
            <Info size={14} /> Recent Activity
          </button>
          <button className="btn btn-ghost" onClick={() => setShowExport(true)} style={{ padding: '10px 14px' }}>
            <Download size={14} /> Export
          </button>
          {onAddEntry && <button className="btn btn-primary" onClick={onAddEntry}><Plus size={14} /> Add an Entry</button>}
        </div>
      </div>

      {showRecentActivity && <RecentActivityPanel allTxns={txns} onOpenInfo={setInfo} />}

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
        <div className="filter-summary">Showing <strong>{filtered.length}</strong> of {topLevel.length} transactions · Total: <strong>₹{formatINR(filteredTotal)}</strong></div>
      )}

      {filtered.length === 0 ? (
        <div className="empty-state card"><h3>No transactions found</h3><p>{topLevel.length === 0 ? 'Add a transaction to get started.' : 'Try adjusting your search or filters.'}</p></div>
      ) : viewMode === 'timeline' ? (
        <TimelineView transactions={filtered} allTxns={txns} expandedIds={expandedIds} onToggleExpand={toggleExpand} onView={setViewing} onEdit={setEditing} onDelete={handleDelete} onInfo={setInfo} onAddChild={setAddChildFor} onToggleFavorite={toggleFavorite} onLinkToFavorite={setLinkToFavoriteFor} onRemoveFromParent={removeChildFromParent} favoriteParents={favoriteParents} isAdmin={isAdmin} deleting={deleting} search={search} filters={filters} />
      ) : (
        <>
          <div className="table-wrap desktop-only">
            <table className="txn-table">
              <thead>
                <tr><th>TX ID</th><th>Date</th><th>Paid By</th><th>Description</th><th>Mode</th><th style={{ textAlign: 'right' }}>Amount</th><th>Proof</th><th style={{ textAlign: 'center' }}>Actions</th></tr>
              </thead>
              <tbody>
                {filtered.map(t => (
                  <Fragment key={t.id}>
                    <TxnRow t={t} isChildRow={false} hasChildren={getChildrenOf(txns, t.id).length > 0 || (t.childCount || 0) > 0} expanded={expandedIds.has(t.id)} onToggleExpand={toggleExpand} onView={setViewing} onEdit={setEditing} onDelete={handleDelete} onInfo={setInfo} onAddChild={setAddChildFor} onToggleFavorite={toggleFavorite} onLinkToFavorite={setLinkToFavoriteFor} favoriteParents={favoriteParents} isAdmin={isAdmin} deleting={deleting} search={search} />
                    {(() => {
                      const children = getVisibleChildren(txns, t.id, search.toLowerCase(), filters);
                      return (expandedIds.has(t.id) && children.map(c => (
                        <TxnRow key={c.id} t={c} isChildRow onToggleExpand={toggleExpand} onView={setViewing} onEdit={setEditing} onDelete={handleDelete} onInfo={setInfo} onAddChild={setAddChildFor} onToggleFavorite={toggleFavorite} onLinkToFavorite={setLinkToFavoriteFor} onRemoveFromParent={removeChildFromParent} favoriteParents={favoriteParents} isAdmin={isAdmin} deleting={deleting} search={search} />
                      )));
                    })()}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mobile-only txn-card-list">
            {filtered.map(t => <TxnCard key={t.id} t={t} allTxns={txns} expanded={expandedIds.has(t.id)} onToggleExpand={toggleExpand} canDelete={isAdmin} onView={setViewing} onEdit={setEditing} onDelete={handleDelete} onInfo={setInfo} onAddChild={setAddChildFor} onToggleFavorite={toggleFavorite} onLinkToFavorite={setLinkToFavoriteFor} onRemoveFromParent={removeChildFromParent} favoriteParents={favoriteParents} deleting={deleting} search={search} filters={filters} />)}
          </div>
        </>
      )}

      {viewing && <ProofViewer txn={viewing} onClose={() => setViewing(null)} />}
      {editing && <EditModal txn={editing} approvedUsers={approvedUsers} onClose={() => setEditing(null)} onSaved={handleSaved} childrenList={getChildrenOf(txns, editing.id)} />}
      {info && <InfoModal txn={info} childrenList={getChildrenOf(txns, info.id)} onClose={() => setInfo(null)} onViewProofs={t => { setInfo(null); setViewing(t); }} onTogglePin={async t => { await togglePin(t); setInfo(prev => prev && prev.id === t.id ? { ...prev, isPinned: !t.isPinned } : prev); }} />}
      {addChildFor && <AddChildModal parent={addChildFor} approvedUsers={approvedUsers} user={user} profile={profile} activeBucket={activeBucket} onClose={() => setAddChildFor(null)} onCreated={handleChildAdded} />}
      {linkToFavoriteFor && <LinkToFavoriteModal txn={linkToFavoriteFor} favoriteTxns={favoriteParents} onClose={() => setLinkToFavoriteFor(null)} onSelect={parent => linkTxnToFavorite(linkToFavoriteFor, parent)} />}
      {showExport && <ExportModal onClose={() => setShowExport(false)} filteredTopLevel={filtered} allTxns={txns} bucketName={activeBucket.name} />}

      {/* debug overlay removed */}
    </div>
  );
};

export default TransactionDetails;
