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

Comportamiento propuesto
------------------------
- Lectura: usuarios autenticados (admin u office pueden ver el módulo).
- Escritura: solo usuarios cuyo documento users/{uid} tenga role == "admin".

Requisito: el cliente (navegador) debe estar autenticado con Firebase Auth para
que request.auth no sea null. Las server actions de Next que usan el SDK web
sin sesión de usuario suelen tener request.auth == null: si tras desplegar
reglas las lecturas/escrituras desde el servidor fallan con PERMISSION_DENIED,
use temporalmente reglas más abiertas solo en devoluciones o migre la ingesta
a Firebase Admin SDK con cuenta de servicio.

Bloque a fusionar (sintaxis rules v2)
-------------------------------------

    match /returnsPeriods/{periodId} {
      allow read: if request.auth != null;
      allow create, update, delete: if request.auth != null
        && exists(/databases/$(database)/documents/users/$(request.auth.uid))
        && get(/databases/$(database)/documents/users/$(request.auth.uid)).data.role == 'admin';

      match /buckets/{bucketId} {
        allow read: if request.auth != null;
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
