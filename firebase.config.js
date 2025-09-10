
// firebase.config.js (versión corregida y robusta)
import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID
};

let app;
let firestore = null;
let auth = null;
let firebaseError = null;

// Solo inicializar si las claves están presentes
if (firebaseConfig.apiKey && firebaseConfig.projectId) {
    try {
      app = initializeApp(firebaseConfig);
      firestore = getFirestore(app);
      auth = getAuth(app); // Inicializar auth
    } catch (error) {
        console.error("Error initializing Firebase:", error);
        firebaseError = error; // Guardar el error para diagnóstico
    }
} else {
    console.warn("Firebase config is missing. Firebase services will be disabled.");
    firebaseError = new Error("Firebase configuration variables are missing.");
}


export { firestore, auth, app, firebaseError }; // Exportar app, auth, firestore y el error
