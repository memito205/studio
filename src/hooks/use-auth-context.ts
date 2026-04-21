
"use client";
import { createContext, useContext } from 'react';
import type { User } from 'firebase/auth';

import type { UserRole } from '@/types';

interface AuthContextType {
    user: User | null;
    role: UserRole | null;
    userName: string | null;
    loading: boolean;
}

export const AuthContext = createContext<AuthContextType>({ user: null, role: null, userName: null, loading: true });

export const useAuth = () => useContext(AuthContext);

    
    