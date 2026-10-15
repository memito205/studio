"use server";

import { collection, doc, getDoc, getDocs, setDoc, updateDoc } from "firebase/firestore";
import { firestore } from "@/services/firebase";
import type { AppUser } from "@/types";
import type { UserRole } from "@/hooks/use-auth-context";

// Sin Firebase Admin (plan Spark): las cuentas se crean con la API REST de Firebase Auth
// (misma API key pública de la app) y el perfil se guarda en `users/{uid}`.

interface ActionResponse<T> {
    success: boolean;
    data?: T;
    error?: string;
}

const VALID_ROLES: UserRole[] = ['operator', 'supervisor', 'conductor', 'tiendas', 'external_operator', 'admin', 'office'];

const ROLE_ALIASES: Record<string, UserRole> = {
    operario: 'operator',
    operator: 'operator',
    supervisor: 'supervisor',
    conductor: 'conductor',
    mensajero: 'conductor',
    tiendas: 'tiendas',
    tienda: 'tiendas',
    externo: 'external_operator',
    'etiquetado externo': 'external_operator',
    'external_operator': 'external_operator',
    tallado: 'external_operator',
    admin: 'admin',
    administrador: 'admin',
    oficina: 'office',
    office: 'office',
};

export async function normalizeUserRole(raw: string): Promise<UserRole | null> {
    const key = String(raw || '').trim().toLowerCase();
    if (!key) return 'operator';
    return ROLE_ALIASES[key] || (VALID_ROLES.includes(key as UserRole) ? (key as UserRole) : null);
}

const AUTH_ERRORS: Record<string, string> = {
    EMAIL_EXISTS: 'El correo ya existe en Firebase y la contraseña no coincide.',
    INVALID_EMAIL: 'Correo inválido.',
    OPERATION_NOT_ALLOWED: 'El inicio con correo y contraseña está desactivado en Firebase.',
    TOO_MANY_ATTEMPTS_TRY_LATER: 'Firebase bloqueó temporalmente la creación por exceso de intentos. Reintente en unos minutos.',
};

function authErrorText(code: string): string {
    if (code.startsWith('WEAK_PASSWORD')) return 'Contraseña débil (mínimo 6 caracteres).';
    return AUTH_ERRORS[code] || code;
}

async function authRest(endpoint: 'signUp' | 'signInWithPassword', email: string, password: string) {
    const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
    const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:${endpoint}?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, returnSecureToken: false }),
        cache: 'no-store',
    });
    const json = (await res.json()) as { localId?: string; error?: { message?: string } };
    return { uid: json.localId, error: json.error?.message ? String(json.error.message) : undefined };
}

type CreateUserInput = { email: string; password?: string; displayName: string; role: UserRole };
type CreateUserResult = { uid: string; status: 'creado' | 'ya_existia' };

/**
 * Crea la cuenta en Firebase Auth y el doc `users/{uid}`. Si el correo ya existía y la contraseña
 * es la misma, solo crea/actualiza el doc (caso "se creó en Auth pero faltó la colección").
 */
async function createOneUser(data: CreateUserInput): Promise<ActionResponse<CreateUserResult>> {
    const email = String(data.email || '').trim().toLowerCase();
    const password = String(data.password || '');
    const displayName = String(data.displayName || '').trim();
    if (!email || !email.includes('@')) return { success: false, error: 'Correo inválido.' };
    if (password.length < 6) return { success: false, error: 'Contraseña débil (mínimo 6 caracteres).' };
    if (!displayName) return { success: false, error: 'Falta el nombre.' };
    if (!VALID_ROLES.includes(data.role)) return { success: false, error: `Rol inválido: ${data.role}` };

    let status: CreateUserResult['status'] = 'creado';
    let { uid, error } = await authRest('signUp', email, password);
    if (error === 'EMAIL_EXISTS') {
        const signIn = await authRest('signInWithPassword', email, password);
        if (!signIn.uid) return { success: false, error: authErrorText('EMAIL_EXISTS') };
        uid = signIn.uid;
        error = undefined;
        status = 'ya_existia';
    }
    if (error || !uid) return { success: false, error: authErrorText(error || 'Error desconocido al crear la cuenta.') };

    const ref = doc(firestore, 'users', uid);
    const existing = await getDoc(ref);
    await setDoc(
        ref,
        {
            email,
            displayName,
            role: data.role,
            ...(existing.exists() ? {} : { createdAt: new Date().toISOString() }),
        },
        { merge: true }
    );
    return { success: true, data: { uid, status } };
}

export async function createUser(data: CreateUserInput): Promise<ActionResponse<{ uid: string }>> {
    try {
        const res = await createOneUser(data);
        return res.success ? { success: true, data: { uid: res.data!.uid } } : { success: false, error: res.error };
    } catch (error: any) {
        console.error("Error creating user:", error);
        return { success: false, error: error?.message || "No se pudo crear el usuario." };
    }
}

export type BulkUserRow = { email: string; password: string; displayName: string; role: string };
export type BulkUserResult = { email: string; displayName: string; ok: boolean; status?: CreateUserResult['status']; uid?: string; error?: string };

/** Carga masiva desde Excel: una fila por usuario, en serie para no disparar el límite de Firebase. */
export async function createUsersBulk(rows: BulkUserRow[]): Promise<ActionResponse<BulkUserResult[]>> {
    if (!Array.isArray(rows) || rows.length === 0) return { success: false, error: 'El archivo no tiene filas.' };
    if (rows.length > 200) return { success: false, error: 'Máximo 200 usuarios por archivo.' };
    const out: BulkUserResult[] = [];
    const seen = new Set<string>();
    for (const row of rows) {
        const email = String(row.email || '').trim().toLowerCase();
        const displayName = String(row.displayName || '').trim();
        if (seen.has(email)) {
            out.push({ email, displayName, ok: false, error: 'Correo repetido en el archivo.' });
            continue;
        }
        seen.add(email);
        const role = await normalizeUserRole(row.role);
        if (!role) {
            out.push({ email, displayName, ok: false, error: `Rol no reconocido: "${row.role}".` });
            continue;
        }
        try {
            const res = await createOneUser({ email, password: String(row.password ?? ''), displayName, role });
            out.push(
                res.success
                    ? { email, displayName, ok: true, status: res.data!.status, uid: res.data!.uid }
                    : { email, displayName, ok: false, error: res.error }
            );
        } catch (e: any) {
            out.push({ email, displayName, ok: false, error: e?.message || 'Error inesperado.' });
        }
    }
    return { success: true, data: out };
}

/** Lista los perfiles de `users` (~60 docs; solo al abrir la pantalla o tras un cambio). */
export async function listAllUsers(): Promise<ActionResponse<{ users: AppUser[] }>> {
    try {
        const snap = await getDocs(collection(firestore, 'users'));
        const users: AppUser[] = snap.docs
            .map((d) => {
                const v = d.data() as Record<string, unknown>;
                return {
                    uid: d.id,
                    email: String(v.email || ''),
                    displayName: String(v.displayName || v.dsiplayName || v.userName || ''),
                    role: (String(v.role || 'operator').trim().toLowerCase() as UserRole),
                    disabled: false,
                };
            })
            .sort((a, b) => (a.displayName || a.email || '').localeCompare(b.displayName || b.email || '', 'es'));
        return { success: true, data: { users } };
    } catch (error: any) {
        console.error("Error listing users:", error);
        return { success: false, error: error?.message || "No se pudieron listar los usuarios.", data: { users: [] } };
    }
}

export async function updateUserRole(data: { uid: string; role: UserRole }): Promise<ActionResponse<null>> {
    try {
        if (!VALID_ROLES.includes(data.role)) return { success: false, error: 'Rol inválido.' };
        await updateDoc(doc(firestore, 'users', data.uid), { role: data.role });
        return { success: true, data: null };
    } catch (error: any) {
        console.error("Error updating user role:", error);
        return { success: false, error: error?.message || "No se pudo actualizar el rol." };
    }
}

// Borrar la cuenta de Firebase Auth requiere Firebase Admin (plan Blaze).
export async function deleteUser(_data: { uid: string }): Promise<ActionResponse<null>> {
    return {
        success: false,
        error: 'Eliminar la cuenta requiere la consola de Firebase (Authentication). Mientras tanto, cámbiele el rol.',
        data: null,
    };
}
