
"use client";
import { createContext, useContext } from 'react';
import type { User } from 'firebase/auth';

// Define the possible roles
export type UserRole = 'admin' | 'supervisor' | 'operator' | 'office' | 'conductor';

interface AuthContextType {
    user: User | null;
    role: UserRole | null;
    loading: boolean;
}

export const AuthContext = createContext<AuthContextType>({ user: null, role: null, loading: true });

export const useAuth = () => useContext(AuthContext);

    
    