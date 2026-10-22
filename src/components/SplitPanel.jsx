import { Users } from 'lucide-react';
import { PAYMENT_MODES } from '../lib/txnUtils';
import { parseToNumber } from '../lib/numberUtils';

// Golden-standard split UI (originally from Update Details) — reused wherever
// a split payment can be entered, so the "Add related expense" flow in the
// Transaction tab stays in lockstep with the main Add Entry form.
const SplitPanel = ({ split, approvedUsers, user, amount }) => {
  const { isSplit, toggleSplit, selectedUsers, toggleUserInSplit, splitAmounts, handleSplitAmountChange, splitModes, handleSplitModeChange, invalidSplitUsers, invalidSplitModes, splitTotal, splitValid } = split;

  return (
    <>
      <div className="field">
        <label className="checkbox-label">
          <input type="checkbox" checked={isSplit} onChange={e => toggleSplit(e.target.checked)} />
          <Users size={14} style={{ marginLeft: 8, verticalAlign: -2 }} />
          <span style={{ marginLeft: 6 }}>Split this payment between multiple people</span>
        </label>
      </div>

      {isSplit && (
        <div className="split-panel">
          <div className="split-header">
            <div className="label" style={{ marginBottom: 8 }}>Select people, amount, and mode for each</div>
            <div style={{ fontSize: 12, color: splitValid ? 'var(--green)' : 'var(--error)', fontWeight: 600, fontFamily: 'JetBrains Mono, monospace' }}>
              Split total: ₹{splitTotal}{amount && splitTotal !== parseToNumber(amount) && ` (need ₹${amount})`}
            </div>
          </div>
          <div className="split-user-list">
            {approvedUsers.map(u => {
              const isSelected = selectedUsers.includes(u.id);
              const isAmountInvalid = invalidSplitUsers.includes(u.id);
              const isModeInvalid = invalidSplitModes.includes(u.id);
              return (
                <div key={u.id} className={`split-user-row ${isSelected ? 'selected' : ''} ${(isAmountInvalid || isModeInvalid) ? 'invalid' : ''}`}>
                  <label className="split-user-checkbox">
                    <input type="checkbox" checked={isSelected} onChange={() => toggleUserInSplit(u.id)} />
                    <span className="split-user-name">{u.name || u.email}{u.id === user?.uid ? ' (you)' : ''}</span>
                  </label>
                  {isSelected && (
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <select className={`select split-mode-select ${isModeInvalid ? 'input-error' : ''}`} value={splitModes[u.id] || ''} onChange={e => handleSplitModeChange(u.id, e.target.value)}>
                        <option value="">{isModeInvalid ? 'Required!' : 'Mode…'}</option>
                        {PAYMENT_MODES.map(m => <option key={m} value={m}>{m}</option>)}
                      </select>
                      <input className={`input split-amount-input mono ${isAmountInvalid ? 'input-error' : ''}`} type="text" inputMode="numeric" placeholder={isAmountInvalid ? 'Required!' : '0'} value={splitAmounts[u.id] || ''} onChange={e => handleSplitAmountChange(u.id, e.target.value.replace(/\D/g, ''))} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
};

export default SplitPanel;
