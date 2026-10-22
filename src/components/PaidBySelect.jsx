import { useState } from 'react';
import { AlertTriangle } from 'lucide-react';

// Golden-standard "Paid By" control (originally from Update Details) — asks
// for confirmation before logging an entry under someone else's name, so this
// behaves identically everywhere a single payer is picked (Add Entry, and the
// Transaction tab's "Add related expense" / Edit forms).
const PaidBySelect = ({ approvedUsers, user, paidByUid, setPaidByUid, label = 'Paid By *', required = true, extraOption }) => {
  const [pendingChange, setPendingChange] = useState(null);

  const handleChange = (e) => {
    const newUid = e.target.value;
    if (newUid === user?.uid) { setPaidByUid(newUid); return; }
    const target = approvedUsers.find(u => u.id === newUid);
    if (target) setPendingChange(target);
    else setPaidByUid(newUid); // e.g. the "(original)" fallback option in Edit
  };

  return (
    <>
      <div className="field">
        <label className="label">{label}</label>
        <select className="select" value={paidByUid} onChange={handleChange} required={required}>
          {approvedUsers.map(u => <option key={u.id} value={u.id}>{u.name || u.email}{u.id === user?.uid ? ' (you)' : ''}</option>)}
          {extraOption}
        </select>
      </div>

      {pendingChange && (
        <div className="modal-overlay" onClick={() => setPendingChange(null)}>
          <div className="modal" style={{ maxWidth: 440 }} onClick={e => e.stopPropagation()}>
            <div style={{ padding: '24px 24px 16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                <div style={{ width: 38, height: 38, borderRadius: '50%', background: 'rgba(201,164,73,0.18)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#8a6b1a' }}><AlertTriangle size={18} /></div>
                <h3 style={{ fontSize: '1.15rem', margin: 0 }}>Logging for another user?</h3>
              </div>
              <p style={{ color: 'var(--muted)', fontSize: 14, lineHeight: 1.55, margin: '8px 0 0' }}>You're about to record this as paid by <strong style={{ color: 'var(--ink)' }}>{pendingChange.name || pendingChange.email}</strong> instead of yourself.</p>
            </div>
            <div style={{ padding: '14px 20px', display: 'flex', gap: 10, borderTop: '1px solid var(--cream-3)', background: 'var(--cream-2)' }}>
              <button className="btn btn-ghost" onClick={() => setPendingChange(null)} style={{ flex: 1 }}>Cancel</button>
              <button className="btn btn-primary" onClick={() => { setPaidByUid(pendingChange.id); setPendingChange(null); }} style={{ flex: 1 }}>Yes, log for them</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default PaidBySelect;
