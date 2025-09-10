
"use server";

import type { UserRecord } from "firebase-admin/auth";
import type { AppUser } from "@/types";
// The following imports are commented out or removed because firebase-admin
// requires the Blaze plan and is not compatible with the Spark plan deployment.
// import { getFirestore } from "firebase-admin/firestore";
// import { initializeApp, getApps, cert, App } from "firebase-admin/app";
// import { getAuth } from "firebase-admin/auth";
import type { UserRole } from "@/hooks/use-auth-context";

// This function initializes the Firebase Admin SDK.
// It's designed to be "lazy" - it only initializes the app once.
// NOTE: Using the Firebase Admin SDK requires the Blaze plan for deployment.
// This function is commented out to allow deployment on the Spark plan.
function initializeAdminApp() {
    // --- START: DISABLED FOR SPARK PLAN ---
    // The logic has been commented out to prevent deployment errors on Spark.
    // To re-enable, you must upgrade to Blaze, add "firebase-admin" to package.json,
    // and uncomment the logic in this file.
    const serviceAccountKey = process.env.NEXUS_OPERATIVO_FIREBASE_ADMIN_KEY;
    if (!serviceAccountKey) {
        console.error("NEXUS_OPERATIVO_FIREBASE_ADMIN_KEY environment variable is not set. Admin features are disabled.");
        return null;
    }
     try {
        // const serviceAccount = JSON.parse(serviceAccountKey);
        // const adminApp = getApps().find(app => app.name === 'admin') || initializeApp({
        //     credential: cert(serviceAccount),
        // }, 'admin');
        // return adminApp;
    } catch (error) {
        console.error("Error parsing service account key or initializing Firebase Admin SDK:", error);
        return null;
    }
    // --- END: DISABLED FOR SPARK PLAN ---
}


interface ActionResponse<T> {
    success: boolean;
    data?: T;
    error?: string;
}

const ADMIN_SDK_ERROR_MESSAGE = "Error: Las funciones de administrador están desactivadas en este entorno.";

// Action to create a new user
export async function createUser(data: { email: string; password?: string; displayName: string; role: UserRole; }): Promise<ActionResponse<{ uid: string }>> {
  return { success: false, error: ADMIN_SDK_ERROR_MESSAGE };
  /* --- START: DISABLED FOR SPARK PLAN ---
  const app = initializeAdminApp();
  if (!app) {
    return { success: false, error: adminAppError?.message || ADMIN_SDK_ERROR_MESSAGE };
  }

  try {
    const auth = getAuth(app);
    const firestore = getFirestore(app);

    const userRecord = await auth.createUser({
      email: data.email,
      password: data.password,
      displayName: data.displayName,
    });

    await firestore.collection("users").doc(userRecord.uid).set({
      role: data.role,
      email: data.email,
      displayName: data.displayName,
    });

    return { success: true, data: { uid: userRecord.uid } };
  } catch (error: any) {
    console.error("Error creating user:", error);
    return { success: false, error: error.message || "Unknown error occurred." };
  }
  --- END: DISABLED FOR SPARK PLAN --- */
}

// Action to list all users
export async function listAllUsers(): Promise<ActionResponse<{ users: AppUser[] }>> {
    return { success: false, error: ADMIN_SDK_ERROR_MESSAGE, data: { users: [] } };
   /* --- START: DISABLED FOR SPARK PLAN ---
  const app = initializeAdminApp();
  if (!app) {
    // Return a specific, identifiable error if the SDK failed to initialize.
    return { success: false, error: adminAppError?.message || ADMIN_SDK_ERROR_MESSAGE, data: { users: [] } };
  }

  try {
    const auth = getAuth(app);
    const firestore = getFirestore(app);

    const listUsersResult = await auth.listUsers(1000);
    const usersCollection = await firestore.collection("users").get();
    
    const rolesMap = new Map<string, { role: UserRole; displayName: string }>();
    usersCollection.forEach(doc => {
      rolesMap.set(doc.id, {
          role: doc.data().role || 'operator',
          displayName: doc.data().displayName || ''
      });
    });

    const appUsers: AppUser[] = listUsersResult.users.map((userRecord: UserRecord) => {
      const firestoreData = rolesMap.get(userRecord.uid);
      return {
        uid: userRecord.uid,
        email: userRecord.email,
        displayName: firestoreData?.displayName || userRecord.displayName, // Prefer Firestore display name
        role: firestoreData?.role || 'operator',
        disabled: userRecord.disabled,
      };
    });

    return { success: true, data: { users: appUsers } };
  } catch (error: any) {
    console.error("Error listing users:", error);
    return { success: false, error: error.message || "Unknown error occurred.", data: { users: [] } };
  }
  --- END: DISABLED FOR SPARK PLAN --- */
}

// Action to update a user's role
export async function updateUserRole(data: { uid: string; role: UserRole }): Promise<ActionResponse<null>> {
  return { success: false, error: ADMIN_SDK_ERROR_MESSAGE, data: null };
  /* --- START: DISABLED FOR SPARK PLAN ---
  const app = initializeAdminApp();
  if (!app) {
    return { success: false, error: ADMIN_SDK_ERROR_MESSAGE };
  }

  try {
    const firestore = getFirestore(app);
    await firestore.collection("users").doc(data.uid).update({ role: data.role });
    return { success: true, data: null };
  } catch (error: any) {
    console.error("Error updating user role:", error);
    return { success: false, error: error.message || "Unknown error occurred." };
  }
  --- END: DISABLED FOR SPARK PLAN --- */
}

// Action to delete a user
export async function deleteUser(data: { uid: string }): Promise<ActionResponse<null>> {
  return { success: false, error: ADMIN_SDK_ERROR_MESSAGE, data: null };
  /* --- START: DISABLED FOR SPARK PLAN ---
  const app = initializeAdminApp();
  if (!app) {
    return { success: false, error: ADMIN_SDK_ERROR_MESSAGE };
  }

  try {
    const auth = getAuth(app);
    const firestore = getFirestore(app);

    await auth.deleteUser(data.uid);
    await firestore.collection("users").doc(data.uid).delete();

    return { success: true, data: null };
  } catch (error: any) {
    console.error("Error deleting user:", error);
    return { success: false, error: error.message || "Unknown error occurred." };
  }
  --- END: DISABLED FOR SPARK PLAN --- */
}
