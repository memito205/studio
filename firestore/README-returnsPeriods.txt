Fragmento de reglas Firestore — returnsPeriods (reporte de devoluciones)
================================================================================

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
Las consultas usan equality en dayKey dentro de la subcolección buckets; en la
mayoría de proyectos Firestore crea índice simple automáticamente. Si la
consola pide un índice compuesto, créelo con el enlace que ofrece el error.

Despliegue (CLI)
----------------
Desde la carpeta donde vive su firebase.json principal:

  firebase deploy --only firestore:rules

Si este repo no es el que despliega reglas, copie el bloque en la consola de
Firebase > Firestore > Reglas y publique allí.
