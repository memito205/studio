import { config } from 'dotenv';
config({ path: '.env.local' });

import { firestore } from '../src/services/firebase';
import { collection, query, where, getDocs, writeBatch } from 'firebase/firestore';

async function purge() {
  const cutoffDate = new Date('2026-02-02T00:00:00Z');
  
  const ordersRef = collection(firestore, 'ecommerceOrders');
  const q = query(ordersRef, where('fechaPedido', '<', cutoffDate));
  
  console.log('Buscando pedidos anteriores a:', cutoffDate.toISOString());
  
  const snapshot = await getDocs(q);
  if (snapshot.empty) {
    console.log('No se encontraron pedidos tan antiguos.');
    process.exit(0);
    return;
  }
  
  console.log(`Se encontraron ${snapshot.size} pedidos con fecha anterior al 1 de Feb de 2026. Procediendo a borrar...`);
  
  const CHUNK_SIZE = 450;
  const docs = snapshot.docs;
  
  let deletedCount = 0;
  for (let i = 0; i < docs.length; i += CHUNK_SIZE) {
    const chunk = docs.slice(i, i + CHUNK_SIZE);
    const batch = writeBatch(firestore);
    
    for (const d of chunk) {
      batch.delete(d.ref);
    }
    
    await batch.commit();
    deletedCount += chunk.length;
    console.log(`Borrados ${deletedCount} de ${snapshot.size}...`);
  }
  
  console.log('Limpieza completada exitosamente!');
  process.exit(0);
}

purge().catch(e => {
  console.error('Error durante la purga:', e);
  process.exit(1);
});
