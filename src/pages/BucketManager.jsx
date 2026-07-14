import { useEffect, useState } from 'react';
import { collection, getDocs, addDoc, updateDoc, deleteDoc, doc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useAuth } from '../lib/AuthContext';
import { Plus, Trash2, Users, X, Folder } from 'lucide-react';

const BUCKET_COLORS = ['#b8451f', '#c9a449', '#4a6b3a', '#6b4d8a', '#2e5a6b', '#8a4a2e', '#5a6b4a', '#3d5a8a'];

const MembersModal = ({ bucket, allUsers, onSave, onClose, saving }) => {
  const [selected, setSelected] = useState(Array.isArray(bucket.members) ? [...bucket.members] : []);
  const toggle = (uid) => setSelected(prev => prev.includes(uid) ? prev.filter(id => id !== uid) : [...prev, uid]);
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 480 }} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <div style={{ fontFamily: 'Fraunces, serif', fontSize: 18, fontWeight: 600 }}>Manage Members</div>
            <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 2 }}>{bucket.name}</div>
          </div>
          <button className="btn btn-ghost" onClick={onClose} style={{ padding: '8px 12px' }}><X size={14} /></button>
        </div>
        <div style={{ padding: '16px 20px', maxHeight: 360, overflowY: 'auto' }}>
          {allUsers.map(u => (
            <div key={u.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', borderRadius: 6, marginBottom: 6, background: selected.includes(u.id) ? 'rgba(74,107,58,0.08)' : 'var(--cream-2)', border: `1px solid ${selected.includes(u.id) ? 'var(--green)' : 'var(--cream-3)'}`, cursor: 'pointer' }} onClick={() => toggle(u.id)}>
              <input type="checkbox" checked={selected.includes(u.id)} onChange={() => toggle(u.id)} style={{ width: 16, height: 16 }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: 14 }}>{u.name || u.email}</div>
                <div style={{ fontSize: 12, color: 'var(--muted)' }}>{u.email}</div>
              </div>
            </div>
          ))}
        </div>
        <div style={{ padding: '14px 20px', borderTop: '1px solid var(--cream-3)', display: 'flex', gap: 10 }}>
          <button className="btn btn-ghost" onClick={onClose} style={{ flex: 1 }}>Cancel</button>
          <button className="btn btn-primary" onClick={() => onSave(selected)} disabled={saving} style={{ flex: 1 }}>{saving ? 'Saving…' : 'Save Members'}</button>
        </div>
      </div>
    </div>
  );
};

const BucketManager = () => {
  const { user, profile } = useAuth();
  const [buckets, setBuckets] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [editingMembers, setEditingMembers] = useState(null);
  const [saving, setSaving] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newColor, setNewColor] = useState(BUCKET_COLORS[0]);

  useEffect(() => {
    const load = async () => {
      try {
        const [bsnap, usnap] = await Promise.all([getDocs(collection(db, 'buckets')), getDocs(collection(db, 'users'))]);
        setBuckets(bsnap.docs.map(d => ({ id: d.id, ...d.data() })));
        setUsers(usnap.docs.map(d => ({ id: d.id, ...d.data() })).filter(u => u.status === 'approved' || u.isPrimary));
      } catch (e) { console.error(e); }
      finally { setLoading(false); }
    };
    load();
  }, []);

  const handleCreate = async () => {
    if (!newName.trim()) return alert('Bucket name is required');
    setSaving(true);
    try {
      const ref = await addDoc(collection(db, 'buckets'), { name: newName.trim(), description: newDesc.trim(), color: newColor, members: [], createdBy: user.uid, createdByName: profile?.name || user.email, createdAt: new Date().toISOString() });
      setBuckets(prev => [...prev, { id: ref.id, name: newName.trim(), description: newDesc.trim(), color: newColor, members: [] }]);
      setNewName(''); setNewDesc(''); setNewColor(BUCKET_COLORS[0]); setCreating(false);
    } catch (e) { alert('Failed: ' + e.message); }
    finally { setSaving(false); }
  };

  const handleDelete = async (bucket) => {
    if (!confirm(`Delete bucket "${bucket.name}"?\n\nTransactions will NOT be deleted but become unassigned.`)) return;
    try { await deleteDoc(doc(db, 'buckets', bucket.id)); setBuckets(prev => prev.filter(b => b.id !== bucket.id)); }
    catch (e) { alert('Failed: ' + e.message); }
  };

  const handleUpdateMembers = async (bucket, newMembers) => {
    setSaving(true);
    try { await updateDoc(doc(db, 'buckets', bucket.id), { members: newMembers }); setBuckets(prev => prev.map(b => b.id === bucket.id ? { ...b, members: newMembers } : b)); setEditingMembers(null); }
    catch (e) { alert('Failed: ' + e.message); }
    finally { setSaving(false); }
  };

  if (loading) return <div className="loading-shell"><div className="spinner"></div></div>;

  return (
    <div>
      <div className="section-head">
        <div className="section-title-block">
          <span className="section-eyebrow">Workspace management</span>
          <h2>Buckets</h2>
        </div>
        <button className="btn btn-primary" onClick={() => setCreating(true)}><Plus size={14} /> New Bucket</button>
      </div>

      {creating && (
        <div className="card" style={{ marginBottom: 24, padding: 20 }}>
          <h3 style={{ marginBottom: 16, fontSize: '1.1rem' }}>New Bucket</h3>
          <div className="form-grid">
            <div className="field" style={{ marginBottom: 0 }}><label className="label">Name *</label><input className="input" placeholder="e.g. House Construction" value={newName} onChange={e => setNewName(e.target.value)} /></div>
            <div className="field" style={{ marginBottom: 0 }}><label className="label">Description</label><input className="input" placeholder="Optional description" value={newDesc} onChange={e => setNewDesc(e.target.value)} /></div>
          </div>
          <div className="field" style={{ marginTop: 14 }}>
            <label className="label">Colour</label>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {BUCKET_COLORS.map(c => <button key={c} type="button" onClick={() => setNewColor(c)} style={{ width: 28, height: 28, borderRadius: '50%', background: c, border: newColor === c ? '3px solid var(--ink)' : '3px solid transparent', cursor: 'pointer', padding: 0 }} />)}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
            <button className="btn btn-ghost" onClick={() => setCreating(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={handleCreate} disabled={saving}>{saving ? 'Creating…' : 'Create Bucket'}</button>
          </div>
        </div>
      )}

      {buckets.length === 0 && !creating ? (
        <div className="empty-state card"><h3>No buckets yet</h3><p>Create your first bucket to start organising transactions.</p></div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {buckets.map((b, i) => {
            const memberUsers = users.filter(u => Array.isArray(b.members) && b.members.includes(u.id));
            return (
              <div key={b.id} className="card" style={{ padding: '18px 20px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
                  <div style={{ width: 40, height: 40, borderRadius: 8, background: b.color || BUCKET_COLORS[i % BUCKET_COLORS.length], display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', flexShrink: 0 }}><Folder size={20} /></div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 15 }}>{b.name}</div>
                    {b.description && <div style={{ fontSize: 13, color: 'var(--muted)' }}>{b.description}</div>}
                    <div style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {memberUsers.length === 0 ? <span style={{ fontSize: 12, color: 'var(--muted)', fontStyle: 'italic' }}>No members assigned</span> : memberUsers.map(u => <span key={u.id} style={{ fontSize: 11, padding: '2px 8px', background: 'var(--cream-2)', borderRadius: 10, border: '1px solid var(--cream-3)', fontWeight: 600 }}>{u.name || u.email}</span>)}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button className="btn btn-ghost" onClick={() => setEditingMembers(b)} style={{ padding: '8px 12px', fontSize: 13 }}><Users size={13} /> Members</button>
                    <button className="btn-action btn-delete btn-icon-only" onClick={() => handleDelete(b)} title="Delete bucket"><Trash2 size={13} /></button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {editingMembers && <MembersModal bucket={editingMembers} allUsers={users} onSave={(m) => handleUpdateMembers(editingMembers, m)} onClose={() => setEditingMembers(null)} saving={saving} />}
    </div>
  );
};

export default BucketManager;
