import { createContext, useContext, useEffect, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, onSnapshot, setDoc, getDoc } from 'firebase/firestore';
import { auth, db, isPrimaryAdmin } from './firebase';

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let profileUnsub = null;
    const authUnsub = onAuthStateChanged(auth, async (firebaseUser) => {
      if (profileUnsub) { profileUnsub(); profileUnsub = null; }
      if (firebaseUser) {
        setUser(firebaseUser);
        try {
          const profileRef = doc(db, 'users', firebaseUser.uid);
          const snap = await getDoc(profileRef);
          if (!snap.exists() && isPrimaryAdmin(firebaseUser.email)) {
            await setDoc(profileRef, {
              name: firebaseUser.displayName || 'Admin',
              email: firebaseUser.email,
              status: 'approved',
              role: 'admin',
              isPrimary: true,
              createdAt: new Date().toISOString()
            });
          }
        } catch (e) { console.warn('Profile bootstrap warning:', e); }

        profileUnsub = onSnapshot(
          doc(db, 'users', firebaseUser.uid),
          (snap) => {
            if (snap.exists()) setProfile({ id: snap.id, ...snap.data() });
            else setProfile(null);
            setLoading(false);
          },
          (err) => { console.error('Profile subscribe error:', err); setLoading(false); }
        );
      } else {
        setUser(null);
        setProfile(null);
        setLoading(false);
      }
    });
    return () => { authUnsub(); if (profileUnsub) profileUnsub(); };
  }, []);

  const isAdmin = profile?.role === 'admin' || isPrimaryAdmin(user?.email);
  const isApproved = profile?.status === 'approved' || isPrimaryAdmin(user?.email);
  const isPrimary = isPrimaryAdmin(user?.email);

  return (
    <AuthContext.Provider value={{ user, profile, loading, isAdmin, isApproved, isPrimary }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
