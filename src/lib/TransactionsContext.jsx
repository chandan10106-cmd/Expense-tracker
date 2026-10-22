import { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import { collection, getDocs, query, where, orderBy } from 'firebase/firestore';
import cache from './cache';
import { db } from './firebase';
import { useAuth } from './AuthContext';
import { useBucket } from './BucketContext';

// Shared across Dashboard / Update Details / Transaction Details so:
//  - all three read the exact same transaction + approved-user data (no more
//    "Add Entry" and "Transactions" scoping users differently)
//  - a save/edit/delete in one tab is reflected everywhere immediately,
//    without waiting on a cache TTL or a full remount
//  - switching tabs doesn't re-trigger a network round trip every time
const TransactionsContext = createContext(null);

const TXN_TTL = 1000 * 60 * 5; // 5 min — safe now that writes patch the cache directly
const USERS_TTL = 1000 * 60 * 5;

const fetchAllTxns = async (bucketId) => {
  try {
    const q = query(collection(db, 'transactions'), where('bucketId', '==', bucketId), where('deleted', '==', false), orderBy('createdAt', 'desc'));
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (e) {
    console.error('Indexed query failed, falling back to full collection:', e.message || e);
    const snap = await getDocs(collection(db, 'transactions'));
    return snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(t => t.bucketId === bucketId && !t.deleted);
  }
};

const fetchAllApprovedUsers = async () => {
  const snap = await getDocs(collection(db, 'users'));
  return snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(u => u.status === 'approved' || u.isPrimary);
};

export const TransactionsProvider = ({ children }) => {
  const { user, profile } = useAuth();
  const { activeBucket } = useBucket();
  const [txns, setTxns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [allApprovedUsers, setAllApprovedUsers] = useState([]);

  const txnKey = activeBucket?.id ? `txns:bucket:${activeBucket.id}` : null;

  const load = useCallback(async (bypassCache = false) => {
    if (!activeBucket || !activeBucket.id) { setTxns([]); setLoading(false); return; }
    setLoading(true);
    try {
      const key = `txns:bucket:${activeBucket.id}`;
      if (bypassCache) cache.invalidateCache(key);
      const [all, users] = await Promise.all([
        cache.fetchWithCache(key, () => fetchAllTxns(activeBucket.id), TXN_TTL),
        cache.fetchWithCache('users:all-approved', fetchAllApprovedUsers, USERS_TTL)
      ]);
      setTxns(all);
      setAllApprovedUsers(users);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, [activeBucket]);

  useEffect(() => { load(); }, [load]);

  // Approved users scoped to THIS bucket's membership — matches the original
  // Update Details behaviour exactly, so every screen's Paid By / Split list agrees.
  const approvedUsers = useMemo(() => {
    const bucketMembers = Array.isArray(activeBucket?.members) ? activeBucket.members : [];
    const scoped = allApprovedUsers.filter(u => u.isPrimary || bucketMembers.includes(u.id));
    if (user?.uid && !scoped.some(u => u.id === user.uid)) {
      scoped.push({ id: user.uid, name: profile?.name || user.displayName || user.email, email: user.email });
    }
    return scoped;
  }, [allApprovedUsers, activeBucket, user, profile]);

  // Keep both the cache entry and in-memory state in sync so every mounted
  // consumer of this context sees the change instantly — this is what avoids
  // the "saved but it won't show up until I refresh" symptom.
  const patchCache = useCallback((updater) => {
    if (!txnKey) return;
    cache.updateCache(txnKey, updater, TXN_TTL);
  }, [txnKey]);

  const applyAdd = useCallback((txn) => {
    setTxns(prev => [txn, ...prev]);
    patchCache(prev => [txn, ...(prev || [])]);
  }, [patchCache]);

  const applyUpdate = useCallback((id, updates) => {
    setTxns(prev => prev.map(t => t.id === id ? { ...t, ...updates } : t));
    patchCache(prev => (prev || []).map(t => t.id === id ? { ...t, ...updates } : t));
  }, [patchCache]);

  const applyRemove = useCallback((id) => {
    setTxns(prev => prev.filter(t => t.id !== id));
    patchCache(prev => (prev || []).filter(t => t.id !== id));
  }, [patchCache]);

  const reload = useCallback(() => load(true), [load]);

  const value = {
    txns, loading, approvedUsers,
    applyAdd, applyUpdate, applyRemove, reload
  };

  return <TransactionsContext.Provider value={value}>{children}</TransactionsContext.Provider>;
};

export const useTransactions = () => useContext(TransactionsContext);
