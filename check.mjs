import fs from "fs";
import admin from "firebase-admin";
import path from "path";

// Read .env manually
const envPath = path.resolve(".env");
const envContent = fs.readFileSync(envPath, "utf-8");
const match = envContent.match(/NEXUS_OPERATIVO_FIREBASE_ADMIN_KEY='(.*?)'/);

if (!match) {
  console.error("No admin key found in .env");
  process.exit(1);
}

const serviceAccount = JSON.parse(match[1]);

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}

const db = admin.firestore();

async function check() {
  const code = "66070999055";
  
  // 1. Check exact Document ID
  const docSnap = await db.collection("productDatabase").doc(code).get();
  if (docSnap.exists) {
    console.log("✅ EL CÓDIGO SÍ EXISTE EN FIRESTORE EXACTAMENTE COMO ID:", docSnap.data());
    return;
  }
  
  console.log("❌ EL CÓDIGO NO EXISTE COMO DOCUMENT ID EN FIRESTORE.");
  
  // 2. Check if maybe it's inside another document as the 'codigoBarras' field
  const qs = await db.collection("productDatabase").where("codigoBarras", "==", code).get();
  if (!qs.empty) {
      console.log("⚠️ EXISTE EL CÓDIGO PERO EN OTRO DOCUMENTO:", qs.docs[0].id, qs.docs[0].data());
      return;
  }
  
  // 3. Show 3 random products to see how they look
  console.log("\nMostrando 3 productos existentes al azar en la base de datos para ver su estructura:");
  const randomQ = await db.collection("productDatabase").limit(3).get();
  randomQ.forEach(doc => {
      console.log(`- ID del Documento en DB: '${doc.id}', Referencia: '${doc.data().referencia}'`);
  });
}

check().then(() => process.exit(0)).catch(console.error);
