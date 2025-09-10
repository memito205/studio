
import { initializeApp, getApp, getApps, FirebaseError } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth, AuthError } from "firebase/auth";

// The firebase.config.js file handles reading environment variables 
// and initializing the app. We just need to import the initialized services from it.
import { auth as firebaseAuth, firestore as firebaseFirestore, firebaseError } from '../../firebase.config.js';

let auth = firebaseAuth;
let firestore = firebaseFirestore;

// We re-export them to maintain the existing module interface throughout the app.
export { auth, firestore, FirebaseError };
