import { useState } from 'react';
import { signInWithEmailAndPassword, createUserWithEmailAndPassword, updateProfile } from 'firebase/auth';
import { doc, setDoc } from 'firebase/firestore';
import { auth, db, isPrimaryAdmin } from '../lib/firebase';
import { ArrowRight } from 'lucide-react';

const AuthPage = () => {
  const [mode, setMode] = useState('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e) => {
    e.preventDefault(); setError(''); setLoading(true);
    try { await signInWithEmailAndPassword(auth, email.trim(), password); }
    catch (err) { setError(prettyError(err)); }
    finally { setLoading(false); }
  };

  const handleSignup = async (e) => {
    e.preventDefault(); setError('');
    if (!name.trim()) return setError('Name is required');
    if (password.length < 6) return setError('Password must be at least 6 characters');
    setLoading(true);
    try {
      const cred = await createUserWithEmailAndPassword(auth, email.trim(), password);
      await updateProfile(cred.user, { displayName: name.trim() });
      const isPrimary = isPrimaryAdmin(email.trim());
      await setDoc(doc(db, 'users', cred.user.uid), {
        name: name.trim(), email: email.trim().toLowerCase(),
        status: isPrimary ? 'approved' : 'pending',
        role: isPrimary ? 'admin' : 'member',
        isPrimary, createdAt: new Date().toISOString()
      });
    } catch (err) { setError(prettyError(err)); }
    finally { setLoading(false); }
  };

  return (
    <div className="auth-shell">
      <aside className="auth-aside">
        <div className="auth-mark">— Ledger</div>
        <div>
          <h1 className="auth-headline">Every<br />rupee<br /><em>accounted.</em></h1>
        </div>
        <div className="auth-tagline">A quiet ledger for thoughtful spending.</div>
      </aside>
      <main className="auth-main">
        <div className="auth-form">
          <div className="auth-tabs">
            <button type="button" className={`auth-tab ${mode === 'login' ? 'active' : ''}`} onClick={() => { setMode('login'); setError(''); }}>Sign In</button>
            <button type="button" className={`auth-tab ${mode === 'signup' ? 'active' : ''}`} onClick={() => { setMode('signup'); setError(''); }}>Create Account</button>
          </div>
          {error && <div className="alert alert-error">{error}</div>}
          {mode === 'login' && (
            <form onSubmit={handleLogin}>
              <div className="field"><label className="label">Email</label><input className="input" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" required /></div>
              <div className="field"><label className="label">Password</label><input className="input" type="password" value={password} onChange={e => setPassword(e.target.value)} required /></div>
              <button className="btn btn-primary" style={{ width: '100%' }} disabled={loading}>{loading ? 'Signing in…' : 'Sign In'} <ArrowRight size={14} /></button>
            </form>
          )}
          {mode === 'signup' && (
            <form onSubmit={handleSignup}>
              <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 24 }}>After signing up, an admin needs to approve your account.</p>
              <div className="field"><label className="label">Full Name *</label><input className="input" value={name} onChange={e => setName(e.target.value)} placeholder="Your name" required /></div>
              <div className="field"><label className="label">Email *</label><input className="input" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" required /></div>
              <div className="field"><label className="label">Password * (min 6 characters)</label><input className="input" type="password" value={password} onChange={e => setPassword(e.target.value)} required /></div>
              <button className="btn btn-primary" style={{ width: '100%' }} disabled={loading}>{loading ? 'Creating account…' : 'Create Account'} <ArrowRight size={14} /></button>
            </form>
          )}
        </div>
      </main>
    </div>
  );
};

const prettyError = (err) => {
  const map = {
    'auth/invalid-credential': 'Invalid email or password',
    'auth/wrong-password': 'Invalid email or password',
    'auth/user-not-found': 'No account found with this email',
    'auth/email-already-in-use': 'An account already exists with this email',
    'auth/weak-password': 'Password is too weak',
    'auth/invalid-email': 'Invalid email format',
    'auth/too-many-requests': 'Too many attempts. Try again later.'
  };
  return map[err?.code] || err?.message || 'Something went wrong';
};

export default AuthPage;
