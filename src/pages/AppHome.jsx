import { useState, useEffect } from 'react';
import { signOut } from 'firebase/auth';
import { auth, db } from '../lib/firebase';
import { useAuth } from '../lib/AuthContext';
import { useBucket } from '../lib/BucketContext';
import { collection, getDocs } from 'firebase/firestore';
import UpdateDetails from './UpdateDetails';
import Dashboard from './Dashboard';
import TransactionDetails from './TransactionDetails';
import AdminPanel from './AdminPanel';
import PendingApproval from './PendingApproval';
import { LogOut, FilePlus, BarChart3, Receipt, Users, ChevronDown, Folder, WifiOff } from 'lucide-react';

const AppHome = () => {
  const { user, profile, isAdmin, isApproved } = useAuth();
  const { activeBucket, clearBucket } = useBucket();
  const [tab, setTab] = useState('dashboard');
  const [pendingCount, setPendingCount] = useState(0);
  const [isOffline, setIsOffline] = useState(!navigator.onLine);

  // Track online/offline
  useEffect(() => {
    const onOnline = () => setIsOffline(false);
    const onOffline = () => setIsOffline(true);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => { window.removeEventListener('online', onOnline); window.removeEventListener('offline', onOffline); };
  }, []);

  // Load pending user count for admin badge
  useEffect(() => {
    if (!isAdmin) return;
    const load = async () => {
      try {
        const snap = await getDocs(collection(db, 'users'));
        const pending = snap.docs.filter(d => (d.data().status || 'pending') === 'pending').length;
        setPendingCount(pending);
      } catch (e) { console.error(e); }
    };
    load();
  }, [isAdmin]);

  if (!isApproved) return <PendingApproval />;

  return (
    <div className="app-shell">
      {isOffline && (
        <div style={{ background: '#6b6357', color: '#f4ede0', padding: '8px 16px', fontSize: 12, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'center' }}>
          <WifiOff size={14} /> You are offline — showing cached data
        </div>
      )}

      <header className="app-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div className="app-brand">— Ledger<em>.</em></div>
          {activeBucket && (
            <button className="bucket-switcher-btn" onClick={clearBucket} title="Switch bucket" style={{ '--bucket-color': activeBucket.color || '#b8451f' }}>
              <Folder size={13} />
              <span className="bucket-switcher-name">{activeBucket.name}</span>
              <ChevronDown size={12} />
            </button>
          )}
        </div>
        <div className="app-user">
          <div className="user-badge">
            <span>{profile?.name || user?.displayName || user?.email}</span>
            {isAdmin && <span className="admin-tag">Admin</span>}
          </div>
          <button className="btn btn-logout" onClick={() => signOut(auth)}>
            <LogOut size={14} /> <span className="logout-text">Sign out</span>
          </button>
        </div>
      </header>

      {/* Desktop top tabs */}
      <nav className="app-tabs desktop-only">
        <button className={`app-tab ${tab === 'dashboard' ? 'active' : ''}`} onClick={() => setTab('dashboard')}><BarChart3 size={14} /> <span className="tab-text">Dashboard</span></button>
        <button className={`app-tab ${tab === 'update' ? 'active' : ''}`} onClick={() => setTab('update')}><FilePlus size={14} /> <span className="tab-text">Update Details</span></button>
        <button className={`app-tab ${tab === 'transactions' ? 'active' : ''}`} onClick={() => setTab('transactions')}><Receipt size={14} /> <span className="tab-text">Transactions</span></button>
        {isAdmin && (
          <button className={`app-tab ${tab === 'admin' ? 'active' : ''}`} onClick={() => setTab('admin')}>
            <Users size={14} /> <span className="tab-text">Admin</span>
            {pendingCount > 0 && <span className="pending-badge">{pendingCount}</span>}
          </button>
        )}
      </nav>

      <main className="app-content" style={{ paddingBottom: 80 }}>
        {tab === 'dashboard' && <Dashboard onAddEntry={() => setTab('update')} />}
        {tab === 'update' && <UpdateDetails onSaved={() => setTab('transactions')} />}
        {tab === 'transactions' && <TransactionDetails onAddEntry={() => setTab('update')} />}
        {tab === 'admin' && isAdmin && <AdminPanel onPendingChange={setPendingCount} />}
      </main>

      {/* Mobile bottom nav */}
      <nav className="mobile-bottom-nav mobile-only">
        <button className={`bottom-nav-btn ${tab === 'dashboard' ? 'active' : ''}`} onClick={() => setTab('dashboard')}>
          <BarChart3 size={20} />
          <span>Dashboard</span>
        </button>
        <button className={`bottom-nav-btn ${tab === 'update' ? 'active' : ''}`} onClick={() => setTab('update')}>
          <FilePlus size={20} />
          <span>Add Entry</span>
        </button>
        <button className={`bottom-nav-btn ${tab === 'transactions' ? 'active' : ''}`} onClick={() => setTab('transactions')}>
          <Receipt size={20} />
          <span>Transactions</span>
        </button>
        {isAdmin && (
          <button className={`bottom-nav-btn ${tab === 'admin' ? 'active' : ''}`} onClick={() => setTab('admin')} style={{ position: 'relative' }}>
            <Users size={20} />
            {pendingCount > 0 && <span className="bottom-nav-badge">{pendingCount}</span>}
            <span>Admin</span>
          </button>
        )}
      </nav>
    </div>
  );
};

export default AppHome;