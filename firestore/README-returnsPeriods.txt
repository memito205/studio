Fragmento de reglas Firestore — returnsPeriods (reporte de devoluciones)
================================================================================

Diseño de datos (paso 1 del plan): ver `DESIGN-returnsPeriods.txt` en esta carpeta.

IMPORTANTE
----------
No reemplace todo su archivo firestore.rules con solo este bloque: perdería el
resto de colecciones. Copie el bloque "match /returnsPeriods" dentro de:

  match /databases/{database}/documents {
    ... sus reglas existentes ...
    <PEGUE AQUÍ EL BLOQUE DE ABAJO>
  }

Comportamiento propuesto (paso 3 del plan)
------------------------------------------
- Lectura: solo roles admin u office (alineado con quién entra al módulo devoluciones).
- Escritura: solo role admin en users/{uid}.

Requisito: el cliente (navegador) debe estar autenticado con Firebase Auth para
que request.auth no sea null. La lectura/escritura de returnsPeriods se hace
desde el navegador con el mismo SDK de Firestore que ya lleva el token del
usuario (no desde server actions sin sesión).

Bloque a fusionar (sintaxis rules v2)
-------------------------------------

    match /returnsPeriods/{periodId} {
      allow read: if request.auth != null
        && exists(/databases/$(database)/documents/users/$(request.auth.uid))
        && get(/databases/$(database)/documents/users/$(request.auth.uid)).data.role in ['admin', 'office'];
      allow create, update, delete: if request.auth != null
        && exists(/databases/$(database)/documents/users/$(request.auth.uid))
        && get(/databases/$(database)/documents/users/$(request.auth.uid)).data.role == 'admin';

      match /buckets/{bucketId} {
        allow read: if request.auth != null
          && exists(/databases/$(database)/documents/users/$(request.auth.uid))
          && get(/databases/$(database)/documents/users/$(request.auth.uid)).data.role in ['admin', 'office'];
        allow create, update, delete: if request.auth != null
          && exists(/databases/$(database)/documents/users/$(request.auth.uid))
          && get(/databases/$(database)/documents/users/$(request.auth.uid)).data.role == 'admin';
      }
    }

Índices
-------
- Ingesta: borrado por **rango** en `dayKey` (`>= mes` y `< mes siguiente`) dentro
  de `buckets`. Si Firestore pide índice compuesto para esa consulta, créelo con
  el enlace del error de la consola.
- La lectura paginada usa `orderBy(documentId())` + `limit` en raíz
  `returnsPeriods` y en cada `buckets`; no suele requerir índice compuesto
  adicional frente a un solo campo de orden.

Despliegue (CLI)
----------------
Desde la carpeta donde vive su firebase.json principal:

  firebase deploy --only firestore:rules

Si este repo no es el que despliega reglas, copie el bloque en la consola de
Firebase > Firestore > Reglas y publique allí.
