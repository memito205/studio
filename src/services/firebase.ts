
import { initializeApp, getApp, getApps, type FirebaseApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth } from "firebase/auth";
import type { FirebaseError } from 'firebase/app';

// TODO: Replace with your new Firebase project configuration
const firebaseConfig = {
  apiKey: "AIzaSyAG6vc1P9x0FoMXmXZ_005-_Br7pu7myD8",
  authDomain: "suite-logistica.firebaseapp.com",
  projectId: "suite-logistica",
  storageBucket: "suite-logistica.firebasestorage.app",
  messagingSenderId: "938968941496",
  appId: "1:938968941496:web:fa04f4969b6c689443c54d"
};

let app: FirebaseApp;
let firestore: any;
let auth: any;

// Check for missing config. If missing, we don't initialize.
// This prevents the app from crashing if the env vars are not set.
if (firebaseConfig.apiKey && firebaseConfig.apiKey !== "TU_API_KEY_AQUI" && firebaseConfig.projectId) {
  if (!getApps().length) {
    app = initializeApp(firebaseConfig);
  } else {
    app = getApp();
  }
  firestore = getFirestore(app);
  auth = getAuth(app);
} else {
  console.warn("CRITICAL: Firebase config is missing or incomplete in src/services/firebase.ts. Please update it with your project's configuration.");
}

export const firebaseProjectId = firebaseConfig.projectId || 'unknown';

export { auth, firestore, app };

