// Top-ups: money one user (the funder) hands to one or more other users in a
// bucket, so they can pay on the funder's behalf. Nothing is written onto the
// transactions themselves — which payments a top-up covered is worked out here
// from the bucket's top-ups and transactions, so editing a top-up amount or
// editing/deleting a transaction re-balances everything automatically.
//
// Rules:
//  - Each recipient's payments (their own single-payer transactions, and their
//    share of split ones) draw down their top-up balance automatically, in date
//    order, oldest top-up first.
//  - A payment only uses top-ups dated on or before the payment.
//  - Once the balance hits ₹0, the rest counts as the recipient's own money again.

const byDateThenCreated = (a, b) =>
  (a.date || '').localeCompare(b.date || '') || (a.createdAt || '').localeCompare(b.createdAt || '');

// Who paid how much on a transaction, keyed by user id.
const payerPortions = (t) => {
  if (t.isSplit && Array.isArray(t.splitDetails) && t.splitDetails.length > 0) {
    return t.splitDetails.map(s => ({ uid: s.uid, amount: s.amount || 0 }));
  }
  return [{ uid: t.paidByUid, amount: t.amount || 0 }];
};

export const topupTotal = (tp) => (tp.recipients || []).reduce((s, r) => s + (r.amount || 0), 0);

// Per-recipient balance of one top-up: given / used so far / remaining.
export const topupBalances = (tp, usedBy) => (tp.recipients || []).map(r => {
  const used = usedBy.get(`${tp.id}:${r.uid}`) || 0;
  return { ...r, used, remaining: Math.max(0, (r.amount || 0) - used) };
});

// Returns:
//  byTxn:  Map(txnDocId -> [{ topupId, fromUid, fromName, fromEmail, recipientUid, recipientName, amount }])
//  usedBy: Map(`${topupId}:${recipientUid}` -> amount used so far)
export const allocateTopups = (txns, topups) => {
  const byTxn = new Map();
  const usedBy = new Map();
  const credits = new Map(); // recipientUid -> [{ topup, recipient, remaining }] oldest first

  [...(topups || [])].filter(tp => !tp.deleted).sort(byDateThenCreated).forEach(tp => {
    (tp.recipients || []).forEach(r => {
      if (!r.uid || !(r.amount > 0)) return;
      if (!credits.has(r.uid)) credits.set(r.uid, []);
      credits.get(r.uid).push({ topup: tp, recipient: r, remaining: r.amount });
    });
  });
  if (credits.size === 0) return { byTxn, usedBy };

  [...(txns || [])].sort(byDateThenCreated).forEach(t => {
    payerPortions(t).forEach(p => {
      const list = credits.get(p.uid);
      if (!list) return;
      let left = p.amount;
      for (const c of list) {
        if (left <= 0) break;
        if ((c.topup.date || '') > (t.date || '')) break; // later top-ups can't fund an earlier payment
        if (c.remaining <= 0) continue;
        const take = Math.min(left, c.remaining);
        c.remaining -= take; left -= take;
        const key = `${c.topup.id}:${p.uid}`;
        usedBy.set(key, (usedBy.get(key) || 0) + take);
        if (!byTxn.has(t.id)) byTxn.set(t.id, []);
        byTxn.get(t.id).push({
          topupId: c.topup.id,
          fromUid: c.topup.fromUid, fromName: c.topup.fromName, fromEmail: c.topup.fromEmail,
          recipientUid: p.uid, recipientName: c.recipient.name,
          amount: take
        });
      }
    });
  });

  return { byTxn, usedBy };
};

// A transaction's per-person contributions for totals/charts, with any part a
// recipient paid out of a top-up credited to the funder instead.
export const getFundedContributions = (t, byTxn) => {
  const base = (t.isSplit && Array.isArray(t.splitDetails) && t.splitDetails.length > 0)
    ? t.splitDetails.map(s => ({ uid: s.uid, name: s.name || 'Unknown', email: s.email, amount: s.amount || 0 }))
    : [{ uid: t.paidByUid, name: t.paidByName || 'Unknown', email: t.paidByEmail, amount: t.amount || 0 }];
  const funded = byTxn?.get(t.id);
  if (!funded || funded.length === 0) return base;
  const result = base.map(c => ({ ...c }));
  funded.forEach(f => {
    const payer = result.find(c => c.uid === f.recipientUid);
    if (payer) payer.amount -= f.amount;
    result.push({ uid: f.fromUid, name: f.fromName || 'Unknown', email: f.fromEmail, amount: f.amount, viaTopup: true });
  });
  return result.filter(c => c.amount > 0);
};
