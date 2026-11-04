// ============================================================
// REPLACE THIS WITH YOUR OWN FIREBASE CONFIG
// Get it from: Firebase Console -> Project Settings -> Your apps
// ============================================================

import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: "AIzaSyBpD7WqQQ5YDwsw4CZFbPqriNHQEaccy_4",
  authDomain: "ledger-app-ac45b.firebaseapp.com",
  projectId: "ledger-app-ac45b",
  storageBucket: "ledger-app-ac45b.firebasestorage.app",
  messagingSenderId: "204920930717",
  appId: "1:204920930717:web:08443e495e3d910352af74",
  measurementId: "G-C2MDG11EF1"
};


const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
// Persistent (IndexedDB) cache: a write that hasn't reached the server yet is
// stored on the device, survives closing/refreshing the tab, and is re-sent
// automatically the next time the app opens — so nothing saved in the UI is lost.
// Falls back to an in-memory cache where IndexedDB isn't available.
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
});

export const PRIMARY_ADMIN_EMAILS = [
  'chandan10106@gmail.com',
  'chandan06babu@gmail.com'
];

export const isPrimaryAdmin = (email) => {
  if (!email) return false;
  return PRIMARY_ADMIN_EMAILS.includes(email.toLowerCase());
};
