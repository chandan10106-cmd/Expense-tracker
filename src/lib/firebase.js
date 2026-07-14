// ============================================================
// REPLACE THIS WITH YOUR OWN FIREBASE CONFIG
// Get it from: Firebase Console -> Project Settings -> Your apps
// ============================================================

import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

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
export const db = getFirestore(app);

export const PRIMARY_ADMIN_EMAILS = [
  'chandan10106@gmail.com',
  'chandan06babu@gmail.com'
];

export const isPrimaryAdmin = (email) => {
  if (!email) return false;
  return PRIMARY_ADMIN_EMAILS.includes(email.toLowerCase());
};
