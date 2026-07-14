import { useEffect, useState } from 'react';
import { collection, getDocs, addDoc } from 'firebase/firestore';
import { db, auth } from '../lib/firebase';
import { useAuth } from '../lib/AuthContext';
import { useBucket } from '../lib/BucketContext';
import { signOut } from 'firebase/auth';
import { LogOut, Folder, ArrowRight, Settings } from 'lucide-react';

const BUCKET_COLORS = ['#b8451f', '#c9a449', '#4a6b3a', '#6b4d8a', '#2e5a6b', '#8a4a2e', '#5a6b4a', '#3d5a8a'];

const BucketPicker = () => {
  const { user, profile, isPrimary } = useAuth();
  const { setActiveBucket } = useBucket();
  const [buckets, setBuckets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newColor, setNewColor] = useState(BUCKET_COLORS[0]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const load = async () => {
      try {
        const snap = await getDocs(collection(db, 'buckets'));
        const all = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        const visible = isPrimary ? all : all.filter(b => Array.isArray(b.members) && b.members.includes(user?.uid));
        setBuckets(visible.sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || '')));
      } catch (e) { console.error(e); }
      finally { setLoading(false); }
    };
    load();
  }, [user, isPrimary]);

  const handleCreate = async () => {
    if (!newName.trim()) return alert('Bucket name is required');
    setSaving(true);
    try {
      const ref = await addDoc(collection(db, 'buckets'), {
        name: newName.trim(), description: newDesc.trim(), color: newColor,
        members: [], createdBy: user.uid, createdByName: profile?.name || user.email,
        createdAt: new Date().toISOString()
      });
      const newBucket = { id: ref.id, name: newName.trim(), description: newDesc.trim(), color: newColor, members: [] };
      setBuckets(prev => [...prev, newBucket]);
      setNewName(''); setNewDesc(''); setNewColor(BUCKET_COLORS[0]); setShowCreate(false);
    } catch (e) { alert('Failed: ' + e.message); }
    finally { setSaving(false); }
  };

  const s = {
    shell: { minHeight: '100vh', background: '#f4ede0', backgroundImage: 'radial-gradient(circle at 20% 10%, rgba(184,69,31,0.04) 0%, transparent 40%), radial-gradient(circle at 80% 80%, rgba(201,164,73,0.05) 0%, transparent 40%)' },
    header: { background: '#1a1815', color: '#f4ede0', padding: '14px 32px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
    brand: { fontFamily: 'Fraunces, serif', fontSize: 20, fontWeight: 600, letterSpacing: '-0.01em' },
    body: { maxWidth: 860, margin: '0 auto', padding: '48px 32px' },
    eyebrow: { fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.18em', color: '#b8451f', display: 'block', marginBottom: 6 },
    h2: { fontFamily: 'Fraunces, serif', fontSize: '2rem', fontWeight: 600, letterSpacing: '-0.02em', color: '#1a1815', marginBottom: 6 },
    badge: { display: 'flex', alignItems: 'center', gap: 6, padding: '5px 10px', background: 'rgba(255,255,255,0.08)', borderRadius: 20, fontSize: 12, fontWeight: 600 },
    signout: { background: 'rgba(255,255,255,0.08)', color: '#f4ede0', border: 'none', borderRadius: 4, padding: '6px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, fontFamily: 'Manrope, sans-serif' },
    grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16, marginBottom: 20 },
    emptyCard: { background: 'rgba(255,252,245,0.7)', border: '1px solid #ded2bd', borderRadius: 8, padding: '40px 24px', maxWidth: 480, textAlign: 'center' },
    createForm: { background: 'rgba(255,252,245,0.9)', border: '1px solid #ded2bd', borderRadius: 12, padding: 28, maxWidth: 520, marginTop: 20 },
    label: { display: 'block', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.12em', color: '#6b6357', marginBottom: 8 },
    input: { width: '100%', padding: '11px 14px', background: 'rgba(255,252,245,0.6)', border: '1px solid #ded2bd', borderRadius: 4, fontFamily: 'Manrope, sans-serif', fontSize: 14, color: '#1a1815', boxSizing: 'border-box' },
  };

  return (
    <div style={s.shell}>
      <header style={s.header}>
        <div style={s.brand}>— Ledger<em style={{ color: '#c9a449', fontStyle: 'italic' }}>.</em></div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={s.badge}>{profile?.name || user?.email}</div>
          <button style={s.signout} onClick={() => signOut(auth)}><LogOut size={14} /> Sign out</button>
        </div>
      </header>

      <div style={s.body}>
        <div style={{ marginBottom: 32 }}>
          <span style={s.eyebrow}>Select workspace</span>
          <h2 style={s.h2}>Which ledger?</h2>
          <p style={{ color: '#6b6357', fontSize: 14 }}>Choose a bucket to view and manage its transactions.</p>
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: 40 }}>
            <div style={{ width: 32, height: 32, border: '2px solid #ded2bd', borderTopColor: '#1a1815', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto' }} />
          </div>
        ) : buckets.length === 0 ? (
          <div style={s.emptyCard}>
            <Folder size={32} style={{ color: '#6b6357', margin: '0 auto 12px', display: 'block' }} />
            <h3 style={{ fontFamily: 'Fraunces, serif', marginBottom: 8, fontSize: '1.3rem' }}>No buckets yet</h3>
            <p style={{ color: '#6b6357', fontSize: 14, marginBottom: isPrimary ? 20 : 0 }}>
              {isPrimary ? 'Create your first bucket to start organising transactions.' : "You haven't been assigned to any buckets yet. Ask an admin to add you."}
            </p>
            {isPrimary && !showCreate && (
              <button onClick={() => setShowCreate(true)} style={{ background: '#1a1815', color: '#f4ede0', border: 'none', borderRadius: 4, padding: '10px 20px', fontSize: 14, fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 8, fontFamily: 'Manrope, sans-serif' }}>
                <Settings size={14} /> Create First Bucket
              </button>
            )}
          </div>
        ) : (
          <div style={s.grid}>
            {buckets.map((b, i) => {
              const color = b.color || BUCKET_COLORS[i % BUCKET_COLORS.length];
              return (
                <button key={b.id} onClick={() => setActiveBucket(b)}
                  style={{ display: 'flex', alignItems: 'center', gap: 16, padding: 20, background: 'rgba(255,252,245,0.85)', border: '2px solid #ded2bd', borderRadius: 8, cursor: 'pointer', textAlign: 'left', fontFamily: 'Manrope, sans-serif', position: 'relative', overflow: 'hidden', transition: 'all 0.2s ease', boxShadow: '0 1px 3px rgba(26,24,21,0.08)', width: '100%' }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = color; e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 8px 20px rgba(26,24,21,0.12)'; }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = '#ded2bd'; e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = '0 1px 3px rgba(26,24,21,0.08)'; }}
                >
                  <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 4, background: color }} />
                  <div style={{ width: 48, height: 48, borderRadius: 10, background: color, color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginLeft: 8 }}>
                    <Folder size={24} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontFamily: 'Fraunces, serif', fontSize: 17, fontWeight: 600, color: '#1a1815', marginBottom: 2 }}>{b.name}</div>
                    {b.description && <div style={{ fontSize: 12, color: '#6b6357', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.description}</div>}
                    <div style={{ fontSize: 11, color: '#6b6357', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', marginTop: 4 }}>
                      {Array.isArray(b.members) ? b.members.length : 0} member{(Array.isArray(b.members) ? b.members.length : 0) !== 1 ? 's' : ''}
                    </div>
                  </div>
                  <ArrowRight size={18} style={{ color: '#6b6357', flexShrink: 0 }} />
                </button>
              );
            })}
          </div>
        )}

        {/* Create bucket form */}
        {isPrimary && (showCreate || buckets.length > 0) && (
          <div>
            {!showCreate ? (
              <button onClick={() => setShowCreate(true)} style={{ background: 'transparent', color: '#6b6357', border: '1px dashed #ded2bd', borderRadius: 8, padding: '12px 20px', fontSize: 13, fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 8, fontFamily: 'Manrope, sans-serif' }}>
                <Settings size={13} /> Manage Buckets
              </button>
            ) : (
              <div style={s.createForm}>
                <h3 style={{ fontFamily: 'Fraunces, serif', marginBottom: 6, fontSize: '1.2rem' }}>New Bucket</h3>
                <p style={{ color: '#6b6357', fontSize: 13, marginBottom: 20 }}>You can manage members in Admin → Buckets after creating.</p>
                <div style={{ marginBottom: 14 }}>
                  <label style={s.label}>Name *</label>
                  <input style={s.input} value={newName} onChange={e => setNewName(e.target.value)} placeholder="e.g. House Construction" />
                </div>
                <div style={{ marginBottom: 14 }}>
                  <label style={s.label}>Description</label>
                  <input style={s.input} value={newDesc} onChange={e => setNewDesc(e.target.value)} placeholder="Optional description" />
                </div>
                <div style={{ marginBottom: 20 }}>
                  <label style={s.label}>Colour</label>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {BUCKET_COLORS.map(c => (
                      <button key={c} type="button" onClick={() => setNewColor(c)} style={{ width: 28, height: 28, borderRadius: '50%', background: c, border: newColor === c ? '3px solid #1a1815' : '3px solid transparent', cursor: 'pointer', padding: 0 }} />
                    ))}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 10 }}>
                  <button onClick={() => setShowCreate(false)} style={{ flex: 1, padding: 12, background: 'transparent', border: '1px solid #ded2bd', borderRadius: 4, fontFamily: 'Manrope, sans-serif', fontWeight: 600, fontSize: 14, cursor: 'pointer', color: '#1a1815' }}>Cancel</button>
                  <button onClick={handleCreate} disabled={saving} style={{ flex: 2, padding: 12, background: '#1a1815', color: '#f4ede0', border: 'none', borderRadius: 4, fontFamily: 'Manrope, sans-serif', fontWeight: 600, fontSize: 14, cursor: 'pointer' }}>
                    {saving ? 'Creating…' : 'Create Bucket'}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default BucketPicker;
