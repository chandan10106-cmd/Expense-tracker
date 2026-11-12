import { useMemo, useState } from 'react';
import { collection, doc, setDoc, updateDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useAuth } from '../lib/AuthContext';
import { useBucket } from '../lib/BucketContext';
import { useTransactions } from '../lib/TransactionsContext';
import { formatWithCommas, parseToNumber } from '../lib/numberUtils';
import { processProofFiles, MAX_IMAGES_PER_TXN } from '../lib/fileUtils';
import { ProofViewer } from './TransactionDetails';
import { topupTotal, topupBalances } from '../lib/topups';
import { Plus, Pencil, Trash2, X, Wallet, Upload, Paperclip } from 'lucide-react';

const formatINR = (n) => new Intl.NumberFormat('en-IN').format(n || 0);
const formatDate = (d) => { try { return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).replace(/ /g, '-'); } catch { return d; } };

const TopupModal = ({ existing, approvedUsers, onClose, onSave }) => {
  const today = new Date().toISOString().split('T')[0];
  const [date, setDate] = useState(existing?.date || today);
  const [fromUid, setFromUid] = useState(existing?.fromUid || '');
  const [rows, setRows] = useState(
    existing?.recipients?.length
      ? existing.recipients.map(r => ({ uid: r.uid, amount: formatWithCommas(String(r.amount || '')) }))
      : [{ uid: '', amount: '' }]
  );
  const [note, setNote] = useState(existing?.note || '');
  const [keptProofs, setKeptProofs] = useState(Array.isArray(existing?.proofs) ? existing.proofs : []);
  const [newFiles, setNewFiles] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const proofCount = keptProofs.length + newFiles.length;

  // Users who aren't in this bucket any more can still appear on an older top-up.
  const userOptions = useMemo(() => {
    const list = [...approvedUsers];
    const known = new Set(list.map(u => u.id));
    if (existing) {
      if (existing.fromUid && !known.has(existing.fromUid)) { list.push({ id: existing.fromUid, name: existing.fromName, email: existing.fromEmail }); known.add(existing.fromUid); }
      (existing.recipients || []).forEach(r => { if (r.uid && !known.has(r.uid)) { list.push({ id: r.uid, name: r.name, email: r.email }); known.add(r.uid); } });
    }
    return list;
  }, [approvedUsers, existing]);
  const userById = (id) => userOptions.find(u => u.id === id);

  const setRow = (i, patch) => setRows(prev => prev.map((r, idx) => idx === i ? { ...r, ...patch } : r));
  const total = rows.reduce((s, r) => s + (parseToNumber(r.amount) || 0), 0);

  const handleSubmit = async (e) => {
    e.preventDefault(); setError('');
    if (!date) return setError('Date is required');
    if (!fromUid) return setError('Select who is giving the top-up');
    if (rows.length === 0) return setError('Add at least one recipient');
    const uids = rows.map(r => r.uid);
    if (uids.some(u => !u)) return setError('Select a recipient on every row');
    if (uids.includes(fromUid)) return setError('The funder cannot also be a recipient');
    if (new Set(uids).size !== uids.length) return setError('Each recipient can only appear once');
    if (rows.some(r => !(parseToNumber(r.amount) > 0))) return setError('Every recipient needs an amount greater than zero');

    let proofs = keptProofs;
    if (newFiles.length > 0) {
      setSaving(true);
      try { proofs = [...keptProofs, ...(await processProofFiles(newFiles))]; }
      catch (err) { setSaving(false); return setError(err.message || 'Could not read the proof files'); }
      setSaving(false);
    }

    const from = userById(fromUid);
    onSave({
      date,
      fromUid, fromName: from?.name || from?.email || 'Unknown', fromEmail: from?.email || null,
      recipients: rows.map(r => {
        const u = userById(r.uid);
        return { uid: r.uid, name: u?.name || u?.email || 'Unknown', email: u?.email || null, amount: parseToNumber(r.amount) };
      }),
      note: note.trim(),
      proofs
    });
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal edit-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div style={{ fontFamily: 'Fraunces, serif', fontSize: 18, fontWeight: 600 }}>{existing ? 'Edit Top-up' : 'New Top-up'}</div>
          <button className="btn btn-ghost" onClick={onClose} style={{ padding: '8px 12px' }}><X size={14} /></button>
        </div>
        <form onSubmit={handleSubmit} className="edit-form">
          <div className="edit-form-body">
            {error && <div className="alert alert-error" style={{ marginBottom: 16 }}>{error}</div>}
            <div className="alert" style={{ background: 'var(--cream-2)', color: 'var(--muted)', marginBottom: 16, fontSize: 13 }}>
              ℹ️ Each recipient's payments in this bucket from this date on are counted against their top-up automatically. They still show as the payer on the transaction, but the dashboard credits that money to the funder. Once the top-up is used up, payments count as the recipient's own again.
            </div>
            <div className="form-grid">
              <div className="field"><label className="label">Date *</label><input className="input" type="date" lang="en-GB" value={date} onChange={e => setDate(e.target.value)} required /></div>
              <div className="field">
                <label className="label">From (funder) *</label>
                <select className="select" value={fromUid} onChange={e => setFromUid(e.target.value)} required>
                  <option value="">Select…</option>
                  {userOptions.map(u => <option key={u.id} value={u.id}>{u.name || u.email}</option>)}
                </select>
              </div>
            </div>

            <div className="field">
              <label className="label">To (recipients) * <span style={{ color: 'var(--muted)', fontWeight: 400, textTransform: 'none', letterSpacing: 0, fontSize: 11 }}>· total ₹{formatINR(total)}</span></label>
              {rows.map((r, i) => (
                <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
                  <select className="select" value={r.uid} onChange={e => setRow(i, { uid: e.target.value })} style={{ flex: '2 1 160px' }}>
                    <option value="">Select recipient…</option>
                    {userOptions.filter(u => u.id !== fromUid).map(u => <option key={u.id} value={u.id}>{u.name || u.email}</option>)}
                  </select>
                  <input className="input mono" type="text" inputMode="numeric" placeholder="Amount ₹" value={r.amount} onChange={e => setRow(i, { amount: formatWithCommas(e.target.value) })} style={{ flex: '1 1 110px' }} />
                  {rows.length > 1 && (
                    <button type="button" className="btn btn-ghost" onClick={() => setRows(prev => prev.filter((_, idx) => idx !== i))} style={{ padding: '8px 12px' }} title="Remove recipient"><X size={14} /></button>
                  )}
                </div>
              ))}
              <button type="button" className="btn btn-ghost" onClick={() => setRows(prev => [...prev, { uid: '', amount: '' }])} style={{ padding: '8px 14px', fontSize: 13 }}><Plus size={13} /> Add recipient</button>
            </div>

            <div className="field">
              <label className="label">Note (optional)</label>
              <textarea className="textarea" value={note} onChange={e => setNote(e.target.value.slice(0, 300))} maxLength="300" placeholder="e.g. Sent via UPI for site expenses" />
            </div>

            <div className="field">
              <label className="label">Proof (optional · up to {MAX_IMAGES_PER_TXN} files)</label>
              {proofCount > 0 && (
                <div className="file-chip-list">
                  {keptProofs.map((p, i) => (
                    <div key={`k${i}`} className="file-chip">
                      <span className="file-chip-name" title={p.name}>{p.name || `Proof ${i + 1}`}</span>
                      {p.sizeKB ? <span className="file-chip-size">{p.sizeKB}KB</span> : null}
                      <button type="button" onClick={() => setKeptProofs(prev => prev.filter((_, idx) => idx !== i))} className="file-chip-remove"><X size={12} /></button>
                    </div>
                  ))}
                  {newFiles.map((f, i) => (
                    <div key={`n${i}`} className="file-chip">
                      <span className="file-chip-name" title={f.name}>{f.name}</span>
                      <span className="file-chip-size">{(f.size / 1024).toFixed(0)}KB</span>
                      <button type="button" onClick={() => setNewFiles(prev => prev.filter((_, idx) => idx !== i))} className="file-chip-remove"><X size={12} /></button>
                    </div>
                  ))}
                </div>
              )}
              {proofCount < MAX_IMAGES_PER_TXN && (
                <label className="file-upload">
                  <input type="file" accept="image/*,application/pdf" multiple onChange={e => {
                    const incoming = Array.from(e.target.files || []);
                    if (proofCount + incoming.length > MAX_IMAGES_PER_TXN) { setError(`Max ${MAX_IMAGES_PER_TXN} files.`); return; }
                    setNewFiles(prev => [...prev, ...incoming]); e.target.value = '';
                  }} />
                  <Upload size={20} />
                  <div className="file-upload-label">Click to upload</div>
                </label>
              )}
            </div>
          </div>
          <div className="edit-form-footer">
            <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Preparing files…' : existing ? 'Save Changes' : 'Add Top-up'}</button>
          </div>
        </form>
      </div>
    </div>
  );
};

// Admin-only: create, edit and remove top-ups for the active bucket.
const TopupManager = () => {
  const { user, profile } = useAuth();
  const { activeBucket } = useBucket();
  const { approvedUsers, topups, topupAllocation, trackWrite, applyTopupAdd, applyTopupUpdate, applyTopupRemove } = useTransactions();
  const [editing, setEditing] = useState(null); // null | 'new' | topup
  const [viewingProofs, setViewingProofs] = useState(null);

  const sorted = useMemo(() => [...topups].sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.createdAt || '').localeCompare(a.createdAt || '')), [topups]);

  const handleSave = (fields) => {
    const by = { uid: user.uid, name: profile?.name || user?.displayName || user?.email };
    if (editing === 'new') {
      const ref = doc(collection(db, 'topups'));
      const data = {
        ...fields,
        bucketId: activeBucket.id, bucketName: activeBucket.name,
        createdByUid: by.uid, createdByName: by.name, createdAt: new Date().toISOString(),
        deleted: false
      };
      applyTopupAdd({ id: ref.id, ...data });
      trackWrite(setDoc(ref, data), { label: 'New top-up', onFail: () => applyTopupRemove(ref.id) });
    } else {
      const previous = editing;
      const updates = { ...fields, updatedByUid: by.uid, updatedByName: by.name, updatedAt: new Date().toISOString() };
      applyTopupUpdate(previous.id, updates);
      trackWrite(updateDoc(doc(db, 'topups', previous.id), updates), {
        label: 'Top-up changes',
        onFail: () => applyTopupUpdate(previous.id, previous)
      });
    }
    setEditing(null);
  };

  const handleDelete = (tp) => {
    if (!confirm(`Remove this top-up from ${tp.fromName} (₹${formatINR(topupTotal(tp))} on ${formatDate(tp.date)})?\n\nPayments it covered will count as the recipients' own money again.`)) return;
    applyTopupRemove(tp.id);
    trackWrite(updateDoc(doc(db, 'topups', tp.id), { deleted: true, deletedAt: new Date().toISOString(), deletedByUid: user.uid }), {
      label: 'Removing top-up',
      onFail: () => applyTopupAdd(tp)
    });
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
        <div style={{ fontSize: 13, color: 'var(--muted)' }}>Top-ups in <strong style={{ color: 'var(--ink)' }}>{activeBucket.name}</strong>. Only admins can add or change these.</div>
        <button className="btn btn-primary" onClick={() => setEditing('new')}><Plus size={14} /> New Top-up</button>
      </div>

      {sorted.length === 0 ? (
        <div className="empty-state card"><Wallet size={22} style={{ color: 'var(--muted)' }} /><h3>No top-ups yet</h3><p>Record money one person gives another to spend on their behalf.</p></div>
      ) : (
        <div className="table-wrap">
          <table className="txn-table">
            <thead><tr><th>Date</th><th>From</th><th>To</th><th style={{ textAlign: 'right' }}>Given</th><th style={{ textAlign: 'right' }}>Used</th><th style={{ textAlign: 'right' }}>Remaining</th><th style={{ textAlign: 'center' }}>Actions</th></tr></thead>
            <tbody>
              {sorted.map(tp => {
                const balances = topupBalances(tp, topupAllocation.usedBy);
                const used = balances.reduce((s, b) => s + b.used, 0);
                const total = topupTotal(tp);
                return (
                  <tr key={tp.id}>
                    <td style={{ whiteSpace: 'nowrap' }}>{formatDate(tp.date)}</td>
                    <td>{tp.fromName}{tp.note && <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{tp.note}</div>}</td>
                    <td>
                      {balances.map(b => (
                        <div key={b.uid} style={{ fontSize: 13, whiteSpace: 'nowrap' }}>
                          {b.name} <span className="mono" style={{ fontSize: 11, color: 'var(--muted)' }}>₹{formatINR(b.used)} / ₹{formatINR(b.amount)} used</span>
                        </div>
                      ))}
                    </td>
                    <td className="amount-cell" style={{ textAlign: 'right' }}>₹{formatINR(total)}</td>
                    <td className="amount-cell" style={{ textAlign: 'right' }}>₹{formatINR(used)}</td>
                    <td className="amount-cell" style={{ textAlign: 'right', color: total - used > 0 ? 'var(--green)' : 'var(--muted)' }}>₹{formatINR(total - used)}</td>
                    <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
                      {tp.proofs?.length > 0 && (
                        <><button className="btn-action btn-icon" onClick={() => setViewingProofs(tp)} title={`View ${tp.proofs.length} proof file${tp.proofs.length > 1 ? 's' : ''}`}><Paperclip size={11} /> {tp.proofs.length}</button>{' '}</>
                      )}
                      <button className="btn-action btn-edit" onClick={() => setEditing(tp)} title="Edit top-up"><Pencil size={11} /> Edit</button>{' '}
                      <button className="btn-action btn-delete btn-icon-only" onClick={() => handleDelete(tp)} title="Remove top-up"><Trash2 size={12} /></button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {viewingProofs && <ProofViewer txn={{ proofs: viewingProofs.proofs, amount: topupTotal(viewingProofs), date: viewingProofs.date }} onClose={() => setViewingProofs(null)} />}
      {editing && <TopupModal existing={editing === 'new' ? null : editing} approvedUsers={approvedUsers} onClose={() => setEditing(null)} onSave={handleSave} />}
    </div>
  );
};

export default TopupManager;
