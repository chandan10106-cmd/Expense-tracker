import { useState, useEffect } from 'react';
import { formatWithCommas, parseToNumber } from './numberUtils';

// Shared split-payment logic — Update Details is the golden standard for this
// behaviour, so both the main "Add Entry" form and the Transaction tab's
// "Add related expense" form drive their split UI off this same hook instead
// of maintaining two slightly different copies.
export const useSplitPayment = ({ amount, setAmount, user }) => {
  const [isSplit, setIsSplit] = useState(false);
  const [selectedUsers, setSelectedUsers] = useState([]);
  const [splitAmounts, setSplitAmounts] = useState({});
  const [splitModes, setSplitModes] = useState({});
  const [lastEditedField, setLastEditedField] = useState(null);
  const [invalidSplitUsers, setInvalidSplitUsers] = useState([]);
  const [invalidSplitModes, setInvalidSplitModes] = useState([]);

  // Amount field drives the split — divide evenly, remainder to the first person.
  useEffect(() => {
    if (isSplit && lastEditedField === 'total' && amount && selectedUsers.length > 0) {
      const total = parseToNumber(amount);
      const perPerson = Math.floor(total / selectedUsers.length);
      const remainder = total - (perPerson * selectedUsers.length);
      const newAmounts = {};
      selectedUsers.forEach((id, idx) => { newAmounts[id] = idx === 0 ? perPerson + remainder : perPerson; });
      setSplitAmounts(prev => ({ ...prev, ...newAmounts }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [amount, isSplit, lastEditedField]);

  // Split entries drive the amount field back — keeps the two in sync either way.
  useEffect(() => {
    if (isSplit && lastEditedField === 'split') {
      const sum = selectedUsers.reduce((s, uid) => s + (parseInt(splitAmounts[uid]) || 0), 0);
      setAmount(sum > 0 ? formatWithCommas(String(sum)) : '');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [splitAmounts, selectedUsers, isSplit, lastEditedField]);

  // Call this whenever the (non-split) amount field changes — keeps the split
  // panel in sync, which only happens if `lastEditedField` is tracked here too.
  const handleAmountChange = (value) => {
    setAmount(formatWithCommas(value));
    setLastEditedField('total');
  };

  const toggleSplit = (checked) => {
    setIsSplit(checked);
    if (checked) {
      const initialSelected = user?.uid ? [user.uid] : [];
      setSelectedUsers(initialSelected);
      if (amount && initialSelected.length > 0) setSplitAmounts(prev => ({ ...prev, [initialSelected[0]]: parseToNumber(amount) }));
      setLastEditedField(amount ? 'total' : null);
      setInvalidSplitUsers([]); setInvalidSplitModes([]);
    } else {
      setSelectedUsers([]); setSplitAmounts({}); setSplitModes({});
      setLastEditedField(null);
      setInvalidSplitUsers([]); setInvalidSplitModes([]);
    }
  };

  const toggleUserInSplit = (uid) => {
    const isCurrentlySelected = selectedUsers.includes(uid);
    const nextSelected = isCurrentlySelected ? selectedUsers.filter(id => id !== uid) : [...selectedUsers, uid];
    setSelectedUsers(nextSelected);
    if (isCurrentlySelected) {
      setInvalidSplitUsers(prev => prev.filter(id => id !== uid));
      setInvalidSplitModes(prev => prev.filter(id => id !== uid));
    }
    if (!isCurrentlySelected && lastEditedField === 'total' && amount && nextSelected.length > 0) {
      const total = parseToNumber(amount);
      const perPerson = Math.floor(total / nextSelected.length);
      const remainder = total - (perPerson * nextSelected.length);
      const newAmounts = { ...splitAmounts };
      nextSelected.forEach((id, idx) => { newAmounts[id] = idx === 0 ? perPerson + remainder : perPerson; });
      setSplitAmounts(newAmounts);
    }
  };

  const handleSplitAmountChange = (uid, value) => {
    setSplitAmounts(prev => ({ ...prev, [uid]: value }));
    setLastEditedField('split');
    if (value && parseInt(value) > 0) setInvalidSplitUsers(prev => prev.filter(id => id !== uid));
  };

  const handleSplitModeChange = (uid, value) => {
    setSplitModes(prev => ({ ...prev, [uid]: value }));
    if (value) setInvalidSplitModes(prev => prev.filter(id => id !== uid));
  };

  const splitTotal = selectedUsers.reduce((s, uid) => s + (parseInt(splitAmounts[uid]) || 0), 0);
  const splitValid = isSplit ? (selectedUsers.length > 0 && splitTotal > 0 && (!amount || splitTotal === parseToNumber(amount))) : true;
  const allModesSelected = isSplit ? selectedUsers.every(uid => splitModes[uid]) : true;

  // Validates the split portion of the form; returns an error string, or null
  // if valid. Also marks which rows are invalid so the UI can flag them.
  const validateSplit = (approvedUsers) => {
    if (!isSplit) return null;
    if (selectedUsers.length === 0) return 'Select at least one person for the split';
    if (splitTotal <= 0) return 'Enter at least one split amount';
    const emptyAmounts = selectedUsers.filter(uid => !splitAmounts[uid] || parseInt(splitAmounts[uid]) <= 0);
    if (emptyAmounts.length > 0) return `Enter an amount for: ${emptyAmounts.map(uid => approvedUsers.find(u => u.id === uid)?.name || uid).join(', ')}`;
    if (amount && splitTotal !== parseToNumber(amount)) return `Split amounts (₹${splitTotal}) must add up to ₹${amount}`;
    const emptyModes = selectedUsers.filter(uid => !splitModes[uid]);
    if (emptyModes.length > 0) return `Select a payment mode for: ${emptyModes.map(uid => approvedUsers.find(u => u.id === uid)?.name || uid).join(', ')}`;
    return null;
  };

  const markInvalid = () => {
    setInvalidSplitUsers(selectedUsers.filter(uid => !splitAmounts[uid] || parseInt(splitAmounts[uid]) <= 0));
    setInvalidSplitModes(selectedUsers.filter(uid => !splitModes[uid]));
  };

  // Builds the splitDetails array + primary mode to store on the transaction doc.
  const buildSplitData = (approvedUsers) => {
    const splitDetails = selectedUsers.map(uid => {
      const u = approvedUsers.find(x => x.id === uid);
      return { uid, name: u?.name || u?.email || 'Unknown', email: u?.email, amount: parseInt(splitAmounts[uid] || 0), mode: splitModes[uid] || '' };
    });
    const modeCounts = {};
    splitDetails.forEach(s => { if (s.mode) modeCounts[s.mode] = (modeCounts[s.mode] || 0) + 1; });
    const primaryMode = Object.keys(modeCounts).sort((a, b) => modeCounts[b] - modeCounts[a])[0] || '';
    return { splitDetails, primaryMode };
  };

  const resetSplit = () => {
    setIsSplit(false); setSelectedUsers([]); setSplitAmounts({}); setSplitModes({});
    setLastEditedField(null); setInvalidSplitUsers([]); setInvalidSplitModes([]);
  };

  return {
    isSplit, toggleSplit, handleAmountChange,
    selectedUsers, toggleUserInSplit,
    splitAmounts, handleSplitAmountChange,
    splitModes, handleSplitModeChange,
    invalidSplitUsers, invalidSplitModes,
    splitTotal, splitValid, allModesSelected,
    validateSplit, markInvalid, buildSplitData, resetSplit
  };
};
