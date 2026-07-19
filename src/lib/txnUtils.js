import { collection, getDocs, query, orderBy, limit } from 'firebase/firestore';
import { db } from './firebase';

export const PAYMENT_MODES = ['Cash', 'UPI', 'Card', 'NetBanking'];

export const getNextTxnId = async () => {
  try {
    // Only fetch the single transaction with the highest sequence — fast, no full scan
    const q = query(collection(db, 'transactions'), orderBy('txnSequence', 'desc'), limit(1));
    const snap = await getDocs(q);
    const topSeq = snap.empty ? 0 : (snap.docs[0].data().txnSequence || 0);
    const next = topSeq + 1;
    return { sequence: next, id: `TX_${String(next).padStart(4, '0')}` };
  } catch (e) {
    // Fallback if the index isn't ready yet
    try {
      const snap = await getDocs(collection(db, 'transactions'));
      const sequences = snap.docs.map(d => d.data().txnSequence || 0);
      const next = (sequences.length ? Math.max(...sequences) : 0) + 1;
      return { sequence: next, id: `TX_${String(next).padStart(4, '0')}` };
    } catch (e2) {
      return { sequence: Date.now(), id: `TX_${String(Date.now()).slice(-4)}` };
    }
  }
};
