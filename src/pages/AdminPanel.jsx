import { useEffect, useState, useMemo } from 'react';
import { collection, getDocs, updateDoc, doc, arrayUnion, arrayRemove } from 'firebase/firestore';
import cache from '../lib/cache';
import { db, isPrimaryAdmin } from '../lib/firebase';
import { useAuth } from '../lib/AuthContext';
import { Check, X, ShieldCheck, ShieldOff, Clock, Crown, RefreshCw, Folder, Trash2, RotateCcw, AlertTriangle } from 'lucide-react';
import BucketManager from './BucketManager';

const formatDate = (d) => { try { return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }); } catch { return d; } };
const formatDateTime = (d) => { try { return new Date(d).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch { return d; } };
const formatINR = (n) => new Intl.NumberFormat('en-IN').format(n || 0);

const RecycleBin = () => {
  const { user, profile } = useAuth();
  const [deleted, setDeleted] = useState([]);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(null);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const snap = await getDocs(collection(db, 'transactions'));
        const all = snap.docs
          .map(d => ({ id: d.id, ...d.data() }))
          .filter(t => t.deleted === true)
          .sort((a, b) => (b.deletedAt || '').localeCompare(a.deletedAt || ''));
        setDeleted(all);
      } catch (e) { console.error(e); }
      finally { setLoading(false); }
    };
    load();
  }, []);

  const handleRestore = async (txn) => {
    setActing(txn.id);
    try {
      await updateDoc(doc(db, 'transactions', txn.id), {
        deleted: false,
        deletedAt: null,
        deletedBy: null,
        deletedByName: null,
        restoredAt: new Date().toISOString(),
        restoredBy: user.uid,
        restoredByName: profile?.name || user.email
      });
      setDeleted(prev => prev.filter(t => t.id !== txn.id));
    } catch (e) { alert('Failed to restore: ' + e.message); }
    finally { setActing(null); }
  };

  const handlePermanentDelete = async (txn) => {
    if (!confirm(`Permanently delete this transaction?\n\n${txn.paidTo || txn.description}\n₹${formatINR(txn.amount)}\n\nThis cannot be undone.`)) return;
    setActing(txn.id);
    try {
      const { deleteDoc } = await import('firebase/firestore');
      await deleteDoc(doc(db, 'transactions', txn.id));
      setDeleted(prev => prev.filter(t => t.id !== txn.id));
    } catch (e) { alert('Failed: ' + e.message); }
    finally { setActing(null); }
  };

  const isOlderThan30Days = (dateStr) => {
    if (!dateStr) return false;
    return (Date.now() - new Date(dateStr).getTime()) > 30 * 24 * 60 * 60 * 1000;
  };

  if (loading) return <div style={{ padding: 40, textAlign: 'center' }}><div className="spinner" style={{ margin: '0 auto' }} /></div>;

  if (deleted.length === 0) return (
    <div className="empty-state card">
      <h3>Recycle Bin is empty</h3>
      <p>Deleted transactions will appear here and can be restored by admins.</p>
    </div>
  );

  return (
    <div>
      <div style={{ marginBottom: 16, padding: '10px 14px', background: 'rgba(168,52,30,0.06)', border: '1px solid rgba(168,52,30,0.15)', borderRadius: 6, fontSize: 13, color: 'var(--muted)' }}>
        ℹ️ Transactions deleted over 30 days ago should be permanently removed to keep your database clean.
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {deleted.map(t => {
          const old = isOlderThan30Days(t.deletedAt);
          return (
            <div key={t.id} className="card" style={{ padding: '14px 18px', borderColor: old ? 'rgba(168,52,30,0.3)' : 'var(--cream-3)', opacity: old ? 0.85 : 1 }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
                    <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: 'var(--accent)', fontWeight: 600 }}>{t.txnId || '—'}</span>
                    <span style={{ fontSize: 12, color: 'var(--muted)' }}>{formatDate(t.date)}</span>
                    {old && <span style={{ fontSize: 10, background: 'var(--error-bg)', color: 'var(--error)', padding: '1px 6px', borderRadius: 8, fontWeight: 600 }}>30+ days</span>}
                  </div>
                  <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 2 }}>{t.paidTo || t.description || '—'}</div>
                  <div style={{ display: 'flex', gap: 12, fontSize: 12, color: 'var(--muted)', flexWrap: 'wrap' }}>
                    <span>₹{formatINR(t.amount)}</span>
                    <span>{t.bucketName}</span>
                    <span>Deleted by {t.deletedByName || '—'} on {formatDateTime(t.deletedAt)}</span>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                  <button className="btn btn-ghost" onClick={() => handleRestore(t)} disabled={acting === t.id} style={{ padding: '7px 12px', fontSize: 12 }}>
                    <RotateCcw size={13} /> Restore
                  </button>
                  <button className="btn-action btn-delete btn-icon-only" onClick={() => handlePermanentDelete(t)} disabled={acting === t.id} title="Permanently delete">
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

const AdminPanel = ({ onPendingChange }) => {
  const { user: currentUser, isPrimary } = useAuth();
  const [buckets, setBuckets] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(null);
  const [editingUserBuckets, setEditingUserBuckets] = useState(null);
  const [savingBuckets, setSavingBuckets] = useState(false);
  const [filter, setFilter] = useState('pending');
  const [adminTab, setAdminTab] = useState('users');

  const load = async () => {
    setLoading(true);
    try {
      const [all, allBuckets] = await Promise.all([
        cache.fetchWithCache('users:all', async () => {
          const snap = await getDocs(collection(db, 'users'));
          return snap.docs.map(d => ({ id: d.id, ...d.data() }));
        }, 1000 * 60 * 5),
        cache.fetchWithCache('buckets:all', async () => {
          const snap = await getDocs(collection(db, 'buckets'));
          return snap.docs.map(d => ({ id: d.id, ...d.data() }));
        }, 1000 * 60 * 5)
      ]);
      setBuckets(allBuckets);
      all.sort((a, b) => {
        const statusOrder = { pending: 0, approved: 1, rejected: 2 };
        const sa = statusOrder[a.status || 'pending'] ?? 1;
        const sb = statusOrder[b.status || 'pending'] ?? 1;
        if (sa !== sb) return sa - sb;
        return (b.createdAt || '').localeCompare(a.createdAt || '');
      });
      setUsers(all);
      const pending = all.filter(u => (u.status || 'pending') === 'pending').length;
      if (onPendingChange) onPendingChange(pending);
    } catch (e) { alert('Failed to load: ' + e.message); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => filter === 'all' ? users : users.filter(u => (u.status || 'pending') === filter), [users, filter]);
  const counts = useMemo(() => ({
    pending: users.filter(u => (u.status || 'pending') === 'pending').length,
    approved: users.filter(u => u.status === 'approved').length,
    rejected: users.filter(u => u.status === 'rejected').length,
    all: users.length
  }), [users]);

  const updateUser = async (uid, updates) => {
    setUpdating(uid);
    try {
      const p = updateDoc(doc(db, 'users', uid), updates);
      await p;
      setUsers(prev => prev.map(u => u.id === uid ? { ...u, ...updates } : u));
      const pending = users.filter(u => u.id !== uid ? (u.status || 'pending') === 'pending' : updates.status === 'pending').length;
      if (onPendingChange) onPendingChange(pending);
      return true;
    } catch (e) { alert('Failed: ' + e.message); return false; }
    finally { setUpdating(null); }
  };

  const handleApprove = (u) => updateUser(u.id, { status: 'approved' });
  const handleReject = (u) => {
    if (isPrimaryAdmin(u.email)) return alert('Primary admins cannot be rejected.');
    if (!confirm(`Revoke access for ${u.name || u.email}?`)) return;
    updateUser(u.id, { status: 'rejected' });
  };
  const handleMakeAdmin = (u) => updateUser(u.id, { role: 'admin' });
  const handleRevokeAdmin = (u) => {
    if (isPrimaryAdmin(u.email)) return alert('Primary admins cannot be demoted.');
    if (!confirm(`Revoke admin from ${u.name || u.email}?`)) return;
    updateUser(u.id, { role: 'member' });
  };

  const tabBtnStyle = (active) => ({
    padding: '10px 18px', background: 'transparent', border: 'none',
    borderBottom: active ? '2px solid var(--accent)' : '2px solid transparent',
    fontFamily: 'Manrope, sans-serif', fontWeight: 600, fontSize: 13,
    color: active ? 'var(--ink)' : 'var(--muted)',
    cursor: 'pointer', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: -1,
    display: 'flex', alignItems: 'center', gap: 6, position: 'relative'
  });

  return (
    <div>
      <div className="section-head">
        <div className="section-title-block">
          <span className="section-eyebrow">Administration</span>
          <h2>Admin</h2>
        </div>
        {adminTab === 'users' && (
          <button className="btn btn-ghost" onClick={load}><RefreshCw size={14} /> Refresh</button>
        )}
      </div>

      <div style={{ display: 'flex', borderBottom: '1px solid var(--cream-3)', marginBottom: 24, flexWrap: 'wrap' }}>
        <button style={tabBtnStyle(adminTab === 'users')} onClick={() => setAdminTab('users')}>
          Users
          {counts.pending > 0 && <span style={{ background: 'var(--error)', color: 'white', borderRadius: 10, fontSize: 10, fontWeight: 700, padding: '1px 6px', minWidth: 18, textAlign: 'center' }}>{counts.pending}</span>}
        </button>
        {isPrimary && (
          <button style={tabBtnStyle(adminTab === 'buckets')} onClick={() => setAdminTab('buckets')}>
            <Folder size={13} />Buckets
          </button>
        )}
        <button style={tabBtnStyle(adminTab === 'bin')} onClick={() => setAdminTab('bin')}>
          <Trash2 size={13} />Recycle Bin
        </button>
      </div>

      {adminTab === 'buckets' && isPrimary && <BucketManager />}
      {adminTab === 'bin' && <RecycleBin />}

      {adminTab === 'users' && (
        <>
          <div className="filter-pills">
            {['pending', 'approved', 'rejected', 'all'].map(f => (
              <button key={f} className={`filter-pill ${filter === f ? 'active' : ''}`} onClick={() => setFilter(f)}>
                {f.charAt(0).toUpperCase() + f.slice(1)} <span className="filter-count">{counts[f]}</span>
              </button>
            ))}
          </div>

          {loading ? <div className="loading-shell"><div className="spinner"></div></div> : filtered.length === 0 ? (
            <div className="empty-state card">
              <h3>No {filter !== 'all' ? filter : ''} users</h3>
              <p>{filter === 'pending' ? 'All caught up.' : 'Nothing here yet.'}</p>
            </div>
          ) : (
            <div className="user-list">
              {filtered.map(u => {
                const primary = isPrimaryAdmin(u.email);
                const isAdminRole = u.role === 'admin';
                const status = u.status || 'pending';
                const isMe = u.id === currentUser?.uid;
                return (
                  <div key={u.id} className="user-card">
                    <div className="user-card-main">
                      <div className="user-avatar">{(u.name || u.email || u.id || '?')[0].toUpperCase()}</div>
                      <div className="user-card-info">
                        <div className="user-card-name">
                          {u.name || u.email || <span style={{ color: 'var(--muted)', fontStyle: 'italic' }}>No name</span>}
                          {primary && <span className="user-tag user-tag-primary"><Crown size={10} /> Primary</span>}
                          {isAdminRole && !primary && <span className="user-tag user-tag-admin">Admin</span>}
                          {isMe && <span className="user-tag user-tag-you">You</span>}
                        </div>
                        <div className="user-card-email">{u.email}</div>
                        <div className="user-card-meta">
                          <span className={`user-status user-status-${status}`}>
                            {status === 'pending' && <Clock size={10} />}
                            {status === 'approved' && <Check size={10} />}
                            {status === 'rejected' && <X size={10} />}
                            {status}
                          </span>
                          <span style={{ color: 'var(--muted)', fontSize: 12 }}>· joined {formatDate(u.createdAt)}</span>
                        </div>
                      </div>
                    </div>
                    {/* show buckets and membership management for primary admins */}
                    <div style={{ marginTop: 8, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                      {buckets.filter(b => Array.isArray(b.members) && b.members.includes(u.id)).map(b => (
                        <span key={b.id} style={{ fontSize: 11, padding: '4px 8px', background: 'var(--cream-2)', borderRadius: 10, border: '1px solid var(--cream-3)', fontWeight: 700 }}>{b.name}</span>
                      ))}
                      {isPrimary && (
                        <button className="btn btn-ghost" onClick={() => setEditingUserBuckets(u)} style={{ padding: '6px 10px', marginLeft: 6 }}>Edit Buckets</button>
                      )}
                    </div>

                    {!primary && !isMe && (
                      <div className="user-card-actions">
                        {status === 'pending' && (
                          <>
                            <button className="btn-action btn-approve" onClick={() => handleApprove(u)} disabled={updating === u.id}><Check size={12} /> Approve</button>
                            <button className="btn-action btn-reject" onClick={() => handleReject(u)} disabled={updating === u.id}><X size={12} /> Reject</button>
                          </>
                        )}
                        {status === 'approved' && (
                          <>
                            {!isAdminRole
                              ? <button className="btn-action btn-promote" onClick={async () => {
                                  const ok = await handleMakeAdmin(u);
                                  if (ok) {
                                    if (isPrimary) {
                                      alert(`${u.name || u.email} is now an admin.\n\nAdmins are NOT automatically added to buckets — add them to the relevant buckets from Admin → Buckets.`);
                                      setAdminTab('buckets');
                                    } else {
                                      alert(`${u.name || u.email} is now an admin.\n\nThey must be added to buckets to view project data.`);
                                    }
                                  }
                                }} disabled={updating === u.id}><ShieldCheck size={12} /> Make Admin</button>
                              : <button className="btn-action btn-demote" onClick={() => handleRevokeAdmin(u)} disabled={updating === u.id}><ShieldOff size={12} /> Revoke Admin</button>}
                            <button className="btn-action btn-reject" onClick={() => handleReject(u)} disabled={updating === u.id}><X size={12} /> Revoke Access</button>
                          </>
                        )}
                        {status === 'rejected' && (
                          <button className="btn-action btn-approve" onClick={() => handleApprove(u)} disabled={updating === u.id}><Check size={12} /> Restore Access</button>
                        )}
                      </div>
                    )}
                    {primary && <div style={{ fontSize: 11, color: 'var(--muted)', fontStyle: 'italic' }}>Protected — cannot be modified</div>}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
      {editingUserBuckets && (
        <UserBucketsModal user={editingUserBuckets} buckets={buckets} onClose={() => setEditingUserBuckets(null)} onSave={async (selected) => {
          setSavingBuckets(true);
          try {
            // For each bucket, add or remove user id
            await Promise.all(buckets.map(async (b) => {
              const ref = doc(db, 'buckets', b.id);
              const has = Array.isArray(b.members) && b.members.includes(editingUserBuckets.id);
              const should = selected.includes(b.id);
              if (should && !has) await updateDoc(ref, { members: arrayUnion(editingUserBuckets.id) });
              if (!should && has) await updateDoc(ref, { members: arrayRemove(editingUserBuckets.id) });
            }));
            // reload buckets
            const bsnap = await getDocs(collection(db, 'buckets'));
            setBuckets(bsnap.docs.map(d => ({ id: d.id, ...d.data() })));
            setEditingUserBuckets(null);
          } catch (e) { alert('Failed: ' + e.message); }
          finally { setSavingBuckets(false); }
        }} saving={savingBuckets} />
      )}
    </div>
  );
};

const UserBucketsModal = ({ user, buckets, onSave, onClose, saving }) => {
  const [selected, setSelected] = useState(Array.isArray(buckets) ? buckets.filter(b => Array.isArray(b.members) && b.members.includes(user.id)).map(b => b.id) : []);
  const toggle = (id) => setSelected(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  useEffect(() => { setSelected(Array.isArray(buckets) ? buckets.filter(b => Array.isArray(b.members) && b.members.includes(user.id)).map(b => b.id) : []); }, [buckets, user]);
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 520 }} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <div style={{ fontFamily: 'Fraunces, serif', fontSize: 18, fontWeight: 600 }}>Manage Buckets for {user.name || user.email}</div>
            <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 2 }}>Toggle buckets to grant or remove access</div>
          </div>
          <button className="btn btn-ghost" onClick={onClose} style={{ padding: '8px 12px' }}><X size={14} /></button>
        </div>
        <div style={{ padding: '16px 20px', maxHeight: 360, overflowY: 'auto' }}>
          {buckets.map(b => (
            <div key={b.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', borderRadius: 6, marginBottom: 6, background: selected.includes(b.id) ? 'rgba(184,69,31,0.06)' : 'var(--cream-2)', border: `1px solid ${selected.includes(b.id) ? 'rgba(184,69,31,0.12)' : 'var(--cream-3)'}`, cursor: 'pointer' }} onClick={() => toggle(b.id)}>
              <input type="checkbox" checked={selected.includes(b.id)} onChange={() => toggle(b.id)} style={{ width: 16, height: 16 }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: 14 }}>{b.name}</div>
                {b.description && <div style={{ fontSize: 12, color: 'var(--muted)' }}>{b.description}</div>}
              </div>
            </div>
          ))}
        </div>
        <div style={{ padding: '14px 20px', borderTop: '1px solid var(--cream-3)', display: 'flex', gap: 10 }}>
          <button className="btn btn-ghost" onClick={onClose} style={{ flex: 1 }}>Cancel</button>
          <button className="btn btn-primary" onClick={() => onSave(selected)} disabled={saving} style={{ flex: 1 }}>{saving ? 'Saving…' : 'Save Memberships'}</button>
        </div>
      </div>
    </div>
  );
};

export default AdminPanel;