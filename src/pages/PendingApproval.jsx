import { signOut } from 'firebase/auth';
import { auth } from '../lib/firebase';
import { useAuth } from '../lib/AuthContext';
import { Clock, LogOut, Ban } from 'lucide-react';

const PendingApproval = () => {
  const { user, profile } = useAuth();
  const isRejected = profile?.status === 'rejected';
  return (
    <div className="loading-shell" style={{ padding: 20 }}>
      <div className="card" style={{ maxWidth: 460, textAlign: 'center', padding: '40px 28px' }}>
        <div style={{ width: 64, height: 64, borderRadius: '50%', background: isRejected ? 'rgba(168,52,30,0.1)' : 'var(--cream-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px', color: isRejected ? 'var(--error)' : 'var(--accent)' }}>
          {isRejected ? <Ban size={28} /> : <Clock size={28} />}
        </div>
        <h2 style={{ marginBottom: 12 }}>{isRejected ? 'Access Denied' : 'Awaiting Approval'}</h2>
        <p style={{ color: 'var(--muted)', fontSize: 14, lineHeight: 1.6, marginBottom: 24 }}>
          {isRejected ? "Your account access has been revoked. Please contact an administrator." : <>Hi <strong>{profile?.name || user?.displayName}</strong>, your account has been created. An admin needs to approve your access before you can use the ledger.</>}
        </p>
        <div style={{ background: 'var(--cream-2)', padding: '12px 16px', borderRadius: 4, fontSize: 12, color: 'var(--muted)', marginBottom: 24, textAlign: 'left' }}>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 4 }}>Signed in as</div>
          <div style={{ color: 'var(--ink)', fontWeight: 600 }}>{user?.email}</div>
        </div>
        <button className="btn btn-ghost" onClick={() => signOut(auth)} style={{ width: '100%' }}><LogOut size={14} /> Sign out</button>
      </div>
    </div>
  );
};

export default PendingApproval;
