import { useState, useEffect } from 'react';
import { collection, addDoc, getDocs, query, where } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useAuth } from '../lib/AuthContext';
import { useBucket } from '../lib/BucketContext';
import { useTransactions } from '../lib/TransactionsContext';
import { processProofFiles, MAX_IMAGES_PER_TXN } from '../lib/fileUtils';
import { parseToNumber } from '../lib/numberUtils';
import { PAYMENT_MODES, getNextTxnId } from '../lib/txnUtils';
import { useSplitPayment } from '../lib/useSplitPayment';
import SplitPanel from '../components/SplitPanel';
import PaidBySelect from '../components/PaidBySelect';
import { Upload, CheckCircle2, X, AlertTriangle } from 'lucide-react';

const UpdateDetails = ({ onSaved }) => {
  const { user, profile } = useAuth();
  const { activeBucket } = useBucket();
  const { approvedUsers, applyAdd } = useTransactions();

  const today = new Date().toISOString().split('T')[0];
  const [date, setDate] = useState(today);
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [mode, setMode] = useState('');
  const formatInputDate = (value) => {
    if (!value) return '';
    try {
      const d = new Date(value);
      if (Number.isNaN(d.getTime())) return value;
      return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).replace(/ /g, '-');
    } catch {
      return value;
    }
  };
  const [proofFiles, setProofFiles] = useState([]);

  const split = useSplitPayment({ amount, setAmount, user });
  const { isSplit, splitTotal, resetSplit, validateSplit, markInvalid, buildSplitData, handleAmountChange } = split;

  const [paidByUid, setPaidByUid] = useState(user?.uid || '');
  const [duplicateWarning, setDuplicateWarning] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [successInfo, setSuccessInfo] = useState(null);

  const selectedUser = approvedUsers.find(u => u.id === paidByUid) || { id: user?.uid, name: profile?.name || user?.displayName || user?.email || '—', email: user?.email };

  useEffect(() => {
    if (successInfo) { const t = setTimeout(() => setSuccessInfo(null), 10000); return () => clearTimeout(t); }
  }, [successInfo]);

  const handleFileChange = (e) => {
    const newFiles = Array.from(e.target.files || []);
    const combined = [...proofFiles, ...newFiles];
    if (combined.length > MAX_IMAGES_PER_TXN) { setError(`Max ${MAX_IMAGES_PER_TXN} files.`); return; }
    setError(''); setProofFiles(combined); e.target.value = '';
  };

  const checkForDuplicate = async () => {
    try {
      const finalAmount = isSplit ? splitTotal : parseToNumber(amount);
      // Narrow the read to same bucket + same date only, then match in memory.
      // Far fewer docs than scanning the whole collection.
      let snap;
      try {
        const q = query(
          collection(db, 'transactions'),
          where('bucketId', '==', activeBucket.id),
          where('date', '==', date)
        );
        snap = await getDocs(q);
      } catch (qerr) {
        snap = await getDocs(collection(db, 'transactions'));
      }
      const duplicate = snap.docs.find(d => {
        const t = d.data();
        return !t.deleted &&
          t.bucketId === activeBucket.id &&
          t.date === date &&
          t.amount === finalAmount &&
          (t.paidTo || t.description || '').toLowerCase() === description.trim().toLowerCase();
      });
      return duplicate ? duplicate.data() : null;
    } catch (e) { return null; }
  };

  const validate = () => {
    if (!date) return 'Date is required';
    if (!isSplit) {
      if (!amount || !/^[\d,]+$/.test(String(amount))) return 'Amount must be a positive integer';
      if (parseToNumber(amount) <= 0) return 'Amount must be greater than zero';
    }
    if (!description.trim()) return 'Description is required';
    if (description.length > 300) return 'Description must be 300 characters or fewer';
    if (!isSplit && !mode) return 'Mode of payment is required';
    if (!isSplit && !paidByUid) return 'Paid By is required';
    return validateSplit(approvedUsers);
  };

  const doSave = async () => {
    setSaving(true);
    setDuplicateWarning(null);
    try {
      let proofs = [];
      if (proofFiles.length > 0) proofs = await processProofFiles(proofFiles);
      const { sequence, id: txnId } = await getNextTxnId();
      const finalAmount = isSplit ? splitTotal : parseToNumber(amount);

      const baseData = {
        txnId, txnSequence: sequence,
        bucketId: activeBucket.id, bucketName: activeBucket.name,
        createdByUid: user.uid, createdByName: profile?.name || user?.displayName || user?.email,
        date, amount: finalAmount,
        paidTo: description.trim(),
        description: description.trim(),
        proofs, deleted: false,
        createdAt: new Date().toISOString(),
        year: new Date(date).getFullYear(),
        month: new Date(date).getMonth() + 1
      };

      let data;
      if (isSplit) {
        const { splitDetails, primaryMode } = buildSplitData(approvedUsers);
        data = { ...baseData, isSplit: true, splitDetails, mode: primaryMode, paidByUid: null, paidByName: 'Split Payment', paidByEmail: null };
      } else {
        data = { ...baseData, isSplit: false, mode, paidByUid: selectedUser.id, paidByName: selectedUser.name || selectedUser.email, paidByEmail: selectedUser.email };
      }
      const ref = await addDoc(collection(db, 'transactions'), data);
      applyAdd({ id: ref.id, ...data });

      setAmount(''); setDescription(''); setMode(''); setProofFiles([]); setDate(today);
      setPaidByUid(user?.uid || ''); resetSplit();
      setSuccessInfo({ txnId });
    } catch (err) {
      setError(err.message || 'Failed to save transaction');
    } finally { setSaving(false); }
  };

  const handleSubmit = async (e) => {
    e.preventDefault(); setError('');
    const v = validate();
    if (v) {
      setError(v);
      if (isSplit) markInvalid();
      return;
    }
    // Check for duplicates
    const duplicate = await checkForDuplicate();
    if (duplicate) {
      setDuplicateWarning(duplicate);
      return;
    }
    await doSave();
  };

  return (
    <div>
      <div className="section-head">
        <div className="section-title-block">
          <span className="section-eyebrow">New entry — {activeBucket.name}</span>
          <h2>Add New Transaction</h2>
        </div>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      <form onSubmit={handleSubmit} className="card form-card">
        <div className="form-grid">
          <div className="field">
            <label className="label">Date *</label>
            <input className="input" type="date" lang="en-GB" value={date} onChange={e => setDate(e.target.value)} required />
            <div style={{ marginTop: 6, fontSize: 12, color: 'var(--muted)' }}>Selected date: {formatInputDate(date)}</div>
          </div>
          <div className="field">
            <label className="label">Amount (INR) * {isSplit && <span style={{ color: 'var(--muted)', fontWeight: 400, textTransform: 'none', letterSpacing: 0, fontSize: 11 }}>(auto-syncs)</span>}</label>
            <input className="input mono" type="text" inputMode="numeric" value={amount} onChange={e => handleAmountChange(e.target.value)} placeholder="0" required={!isSplit} />
          </div>
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
          <label className="label">Description * <span style={{ color: 'var(--muted)', fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>({description.length}/300)</span></label>
          <textarea className="textarea" value={description} onChange={e => setDescription(e.target.value.slice(0, 300))} placeholder="Recipient name & description of transaction" maxLength="300" required />
        </div>

        <div className="field">
          <label className="label">Proof (optional · up to {MAX_IMAGES_PER_TXN} files)</label>
          {proofFiles.length > 0 && (
            <div className="file-chip-list">
              {proofFiles.map((f, i) => (
                <div key={i} className="file-chip">
                  <span className="file-chip-name" title={f.name}>{f.name}</span>
                  <span className="file-chip-size">{(f.size / 1024).toFixed(0)}KB</span>
                  <button type="button" onClick={() => setProofFiles(prev => prev.filter((_, idx) => idx !== i))} className="file-chip-remove"><X size={12} /></button>
                </div>
              ))}
            </div>
          )}
          {proofFiles.length < MAX_IMAGES_PER_TXN && (
            <label className="file-upload">
              <input type="file" accept="image/*,application/pdf" multiple onChange={handleFileChange} />
              <Upload size={20} />
              <div className="file-upload-label">{proofFiles.length === 0 ? `Click to upload (up to ${MAX_IMAGES_PER_TXN})` : `Add more · ${MAX_IMAGES_PER_TXN - proofFiles.length} remaining`}</div>
            </label>
          )}
        </div>

        <button type="submit" className="btn btn-primary" disabled={saving} style={{ width: '100%', padding: '14px' }}>{saving ? 'Saving…' : 'Save Transaction'}</button>
      </form>

      {/* Duplicate warning */}
      {duplicateWarning && (
        <div className="modal-overlay" onClick={() => setDuplicateWarning(null)}>
          <div className="modal" style={{ maxWidth: 460 }} onClick={e => e.stopPropagation()}>
            <div style={{ padding: '24px 24px 16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                <div style={{ width: 38, height: 38, borderRadius: '50%', background: 'rgba(201,164,73,0.18)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#8a6b1a' }}><AlertTriangle size={18} /></div>
                <h3 style={{ fontSize: '1.15rem', margin: 0 }}>Possible duplicate</h3>
              </div>
              <p style={{ color: 'var(--muted)', fontSize: 14, lineHeight: 1.55 }}>A transaction with the same date, amount, and description already exists:</p>
              <div style={{ background: 'var(--cream-2)', borderRadius: 6, padding: '10px 14px', margin: '12px 0', fontSize: 13 }}>
                <div style={{ fontWeight: 600 }}>{duplicateWarning.paidTo || duplicateWarning.description}</div>
                <div style={{ color: 'var(--muted)', marginTop: 2 }}>₹{new Intl.NumberFormat('en-IN').format(duplicateWarning.amount)} · {duplicateWarning.txnId}</div>
              </div>
              <p style={{ color: 'var(--muted)', fontSize: 13 }}>Are you sure you want to save this as a new transaction?</p>
            </div>
            <div style={{ padding: '14px 20px', display: 'flex', gap: 10, borderTop: '1px solid var(--cream-3)', background: 'var(--cream-2)' }}>
              <button className="btn btn-ghost" onClick={() => setDuplicateWarning(null)} style={{ flex: 1 }}>Cancel</button>
              <button className="btn btn-primary" onClick={doSave} disabled={saving} style={{ flex: 1 }}>{saving ? 'Saving…' : 'Save Anyway'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Success popup */}
      {successInfo && (
        <div className="modal-overlay" onClick={() => setSuccessInfo(null)}>
          <div className="modal success-modal" onClick={e => e.stopPropagation()}>
            <button onClick={() => setSuccessInfo(null)} style={{ position: 'absolute', top: 12, right: 12, background: 'transparent', border: 'none', cursor: 'pointer', padding: 6, borderRadius: 4, color: 'var(--muted)' }}><X size={16} /></button>
            <div style={{ padding: '32px 28px 24px', textAlign: 'center' }}>
              <div style={{ width: 56, height: 56, borderRadius: '50%', background: 'rgba(74,107,58,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--green)', margin: '0 auto 16px' }}><CheckCircle2 size={28} /></div>
              <h3 style={{ fontSize: '1.4rem', marginBottom: 8 }}>Transaction Saved</h3>
              <p style={{ color: 'var(--muted)', fontSize: 14, marginBottom: 12 }}>Your entry has been recorded successfully.</p>
              <div style={{ display: 'inline-block', padding: '6px 14px', background: 'var(--cream-2)', border: '1px solid var(--cream-3)', borderRadius: 4, fontFamily: 'JetBrains Mono, monospace', fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>{successInfo.txnId}</div>
              <div style={{ marginTop: 20, display: 'flex', gap: 10, justifyContent: 'center' }}>
                <button className="btn btn-ghost" onClick={() => setSuccessInfo(null)}>Add another</button>
                {onSaved && <button className="btn btn-primary" onClick={() => { setSuccessInfo(null); onSaved(); }}>View transactions</button>}
              </div>
              <div style={{ marginTop: 14, fontSize: 11, color: 'var(--muted)' }}>Closes automatically in 10 seconds</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default UpdateDetails;
