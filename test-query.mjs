import { initializeApp } from "firebase/app";
import { getFirestore, collection, getDocs, query, where, Timestamp } from "firebase/firestore";
import dotenv from "dotenv";

dotenv.config({ path: '.env', override: true });

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function check() {
  const dateStr = "2026-04-23";
  const start = new Date(dateStr + 'T00:00:00');
  start.setHours(start.getHours() - 12);
  const end = new Date(dateStr + 'T23:59:59');
  end.setHours(end.getHours() + 12);
  
  console.log("Querying from", start, "to", end);

  const snaps = await getDocs(query(collection(db, "reports_summary"), where("reportDate", ">=", Timestamp.fromDate(start)), where("reportDate", "<=", Timestamp.fromDate(end))));
  
  console.log("Docs found:", snaps.size);
  snaps.forEach(doc => {
    const d = doc.data();
    console.log("Doc ID:", doc.id, "reportDate:", d.reportDate?.toDate?.(), "createdAt:", d.snapshotCreatedAt?.toDate?.());
    console.log("Justifs:", Object.keys(d.manualJustifications || {}).length, d.manualJustifications);
  });
  
  process.exit(0);
}
check();
