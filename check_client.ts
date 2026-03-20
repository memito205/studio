import { lookupBarcode } from "./src/app/reception/actions";
import { getDocs, limit, collection } from "firebase/firestore";
import { firestore } from "./src/services/firebase";

async function check() {
  console.log("Checking exact barcode: 66070999055");
  const result = await lookupBarcode("66070999055");
  console.log("Result:", result);
  
  console.log("\nFetching 3 random products to see format...");
  const snaps = await getDocs(collection(firestore, "productDatabase"));
  let i = 0;
  snaps.forEach(doc => {
      if (i < 3) console.log("ID:", doc.id, "Ref:", doc.data().referencia);
      i++;
  });
  process.exit(0);
}

check().catch(console.error);
