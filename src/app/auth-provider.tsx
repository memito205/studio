
"use client";

import { useState, useEffect, useMemo } from 'react';
import { auth, firestore } from '@/services/firebase';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { doc, onSnapshot } from 'firebase/firestore';
import { AuthContext, type UserRole } from '@/hooks/use-auth-context';
import {
    coercePermissionFlag,
    emailAllowsPendingValidation,
} from '@/lib/distributionComparePermissions';

export function AuthProvider({ children }: { children: React.ReactNode }) {
    const [user, setUser] = useState<User | null>(null);
    const [role, setRole] = useState<UserRole | null>(null);
    const [userName, setUserName] = useState<string | null>(null);
    const [canViewDistributionPendingValidation, setCanViewDistributionPendingValidation] =
        useState(false);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        // If auth is not initialized (because firebase-config is not set),
        // we can't check for a user. We'll just set loading to false.
        if (!auth) {
            setLoading(false);
            return;
        }

        let unsubUserDoc: (() => void) | null = null;

        const unsubscribeAuth = onAuthStateChanged(auth, (authUser) => {
            if (unsubUserDoc) {
                unsubUserDoc();
                unsubUserDoc = null;
            }

            if (authUser) {
                setUser(authUser);
                // Allowlist aplica de inmediato (antes / si falla el doc de Firestore).
                if (emailAllowsPendingValidation(authUser.email)) {
                    setCanViewDistributionPendingValidation(true);
                }

                const userDocRef = doc(firestore, 'users', authUser.uid);
                unsubUserDoc = onSnapshot(
                    userDocRef,
                    (userDocSnap) => {
                        if (userDocSnap.exists()) {
                            const userData = userDocSnap.data();
                            const rawRole = String(userData.role || '').trim().toLowerCase();
                            setRole((rawRole as UserRole) || null);
                            setUserName(
                                userData.displayName ||
                                    authUser.displayName ||
                                    authUser.email ||
                                    'Operario'
                            );
                            setCanViewDistributionPendingValidation(
                                coercePermissionFlag(userData.canViewDistributionPendingValidation) ||
                                    emailAllowsPendingValidation(
                                        (userData.email as string | undefined) || authUser.email
                                    )
                            );
                        } else {
                            console.warn(
                                `User document not found in Firestore for UID: ${authUser.uid}`
                            );
                            setRole(null);
                            setUserName(authUser.displayName || authUser.email || 'Operario');
                            setCanViewDistributionPendingValidation(
                                emailAllowsPendingValidation(authUser.email)
                            );
                        }
                        setLoading(false);
                    },
                    (err) => {
                        console.warn('users/{uid} snapshot error:', err);
                        setRole(null);
                        setUserName(authUser.displayName || authUser.email || 'Operario');
                        setCanViewDistributionPendingValidation(
                            emailAllowsPendingValidation(authUser.email)
                        );
                        setLoading(false);
                    }
                );
            } else {
                setUser(null);
                setRole(null);
                setUserName(null);
                setCanViewDistributionPendingValidation(false);
                setLoading(false);
            }
        });

        return () => {
            if (unsubUserDoc) unsubUserDoc();
            unsubscribeAuth();
        };
    }, []);
    
    const value = useMemo(() => ({
        user,
        role,
        userName,
        canViewDistributionPendingValidation,
        loading
    }), [user, role, userName, canViewDistributionPendingValidation, loading]);

    return (
        <AuthContext.Provider value={value}>
            {children}
        </AuthContext.Provider>
    );
}
