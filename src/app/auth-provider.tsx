
"use client";

import { useState, useEffect, useMemo } from 'react';
import { auth, firestore } from '@/services/firebase';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { AuthContext, type UserRole } from '@/hooks/use-auth-context';

export function AuthProvider({ children }: { children: React.ReactNode }) {
    const [user, setUser] = useState<User | null>(null);
    const [role, setRole] = useState<UserRole | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        // If auth is not initialized (because firebase-config is not set),
        // we can't check for a user. We'll just set loading to false.
        if (!auth) {
            setLoading(false);
            return;
        }

        const unsubscribe = onAuthStateChanged(auth, async (user) => {
            if (user) {
                setUser(user);
                // User is signed in, now get their role from Firestore.      
                const userDocRef = doc(firestore, 'users', user.uid);
                const userDocSnap = await getDoc(userDocRef);
                if (userDocSnap.exists()) {
                    setRole(userDocSnap.data().role || null);
                } else {
                    // Handle cases where user exists in Auth but not in Firestore 'users' collection
                    console.warn(`User document not found in Firestore for UID: ${user.uid}`);
                    setRole(null);
                }
            } else {
                setUser(null);
                setRole(null);
            }
            setLoading(false);
        });

        return () => unsubscribe();
    }, []);
    
    const value = useMemo(() => ({
        user,
        role,
        loading
    }), [user, role, loading]);

    return (
        <AuthContext.Provider value={value}>
            {children}
        </AuthContext.Provider>
    );
}
