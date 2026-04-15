"use client";

import React, { createContext, useContext, useEffect, useState, useCallback, ReactNode } from 'react';
import { firestore } from '@/services/firebase';
import { collection, query, where, onSnapshot, limit, Timestamp, getDocs } from 'firebase/firestore';
import { createPulse } from '@/app/actions';
import { useAuth } from '@/hooks/use-auth-context';
import { useToast } from '@/hooks/use-toast';
import type { OperationPulse, UserStatus, PulseReason } from '@/types';

interface SuitePulseContextType {
    currentPulse: OperationPulse | null;
    globalPulse: OperationPulse | null;
    allPulses: OperationPulse[];
    isPaused: boolean;
    isInRemision: boolean;
    status: string;
    loading: boolean;
    startPause: (reason: PulseReason) => Promise<void>;
    endPause: () => Promise<void>;
    punchInRemision: () => Promise<void>;
    punchOut: () => Promise<void>;
}

const SuitePulseContext = createContext<SuitePulseContextType | undefined>(undefined);

export function SuitePulseProvider({ children }: { children: ReactNode }) {
    const { user } = useAuth();
    const { toast } = useToast();
    const [currentPulse, setCurrentPulse] = useState<OperationPulse | null>(null);
    const [globalPulse, setGlobalPulseState] = useState<OperationPulse | null>(null);
    const [allPulsesDay, setAllPulsesDay] = useState<OperationPulse[]>([]);
    const [loading, setLoading] = useState(true);

    // 1. Listen to Global Active Pulse
    useEffect(() => {
        const q = query(
            collection(firestore, 'operation_pulses'),
            where('isGlobal', '==', true),
            where('endTime', '==', null),
            limit(1)
        );

        const unsubscribe = onSnapshot(q, (snapshot) => {
            if (!snapshot.empty) {
                const docData = snapshot.docs[0].data();
                setGlobalPulseState({ 
                    id: snapshot.docs[0].id, 
                    ...docData,
                    startTime: docData.startTime?.toDate(),
                    endTime: docData.endTime?.toDate() || null
                } as OperationPulse);
            } else {
                setGlobalPulseState(null);
            }
        });

        return () => unsubscribe();
    }, []);

    // 2. Listen to User's Current Active Pulse
    useEffect(() => {
        if (!user?.uid) {
            setLoading(false);
            return;
        }

        const q = query(
            collection(firestore, 'operation_pulses'),
            where('userId', '==', user.uid),
            where('endTime', '==', null),
            limit(1)
        );

        const unsubscribe = onSnapshot(q, (snapshot) => {
            if (!snapshot.empty) {
                const docData = snapshot.docs[0].data();
                setCurrentPulse({ 
                    id: snapshot.docs[0].id, 
                    ...docData,
                    startTime: docData.startTime?.toDate(),
                    endTime: docData.endTime?.toDate() || null
                } as OperationPulse);
            } else {
                setCurrentPulse(null);
            }
            setLoading(false);
        });

        return () => unsubscribe();
    }, [user?.uid]);

    // 3. Get ALL past pulses of the day for real-time productivity (One time fetch)
    const fetchPulsesOfDay = useCallback(async () => {
        if (!user?.uid) return;
        
        const startOfToday = new Date();
        startOfToday.setHours(0, 0, 0, 0);

        const qGlobal = query(
            collection(firestore, 'operation_pulses'),
            where('isGlobal', '==', true),
            where('startTime', '>=', startOfToday)
        );

        const qUser = query(
            collection(firestore, 'operation_pulses'),
            where('userId', '==', user.uid),
            where('startTime', '>=', startOfToday)
        );

        try {
            // Utilizamos then() estático en lugar de onSnapshot para ahorrar lecturas.
            // Si quieres que se actualice cada vez que cambie tu propio estado activo, puedes llamarlo.
            const [globalSnap, userSnap] = await Promise.all([getDocs(qGlobal), getDocs(qUser)]);
            
            const globalPulses = globalSnap.docs.map(doc => ({
                id: doc.id,
                ...doc.data(),
                startTime: doc.data().startTime?.toDate(),
                endTime: doc.data().endTime?.toDate() || null
            } as OperationPulse));

            const userPulses = userSnap.docs.map(doc => ({
                id: doc.id,
                ...doc.data(),
                startTime: doc.data().startTime?.toDate(),
                endTime: doc.data().endTime?.toDate() || null
            } as OperationPulse));

             const combined = [...globalPulses, ...userPulses];
             const unique = combined.filter((p, index, self) => 
                index === self.findIndex((t) => t.id === p.id)
             ).sort((a,b) => a.startTime.getTime() - b.startTime.getTime());
             
             setAllPulsesDay(unique);
        } catch (error) {
            console.error("Error fetching historical pulses:", error);
        }
    }, [user?.uid]);

    useEffect(() => {
        fetchPulsesOfDay();
    }, [fetchPulsesOfDay]);

    const changeStatus = useCallback(async (status: UserStatus, type: 'activity' | 'pause' | 'status_change', reason?: PulseReason) => {
        if (!user) return;
        
        try {
            const result = await createPulse({
                userId: user.uid,
                userName: user.displayName || user.email || 'Operario',
                email: user.email || undefined,
                type,
                status,
                reason: reason || undefined,
                startTime: new Date(),
                endTime: null
            } as any);

            if (result.error) throw new Error(result.error);

            toast({
                title: `Estado: ${status}`,
                description: reason ? `Motivo: ${reason}` : "Sincronizado con éxito.",
            });
        } catch (error: any) {
            toast({
                variant: "destructive",
                title: "Error al cambiar estado",
                description: error.message,
            });
        }
    }, [user, toast]);

    const startPause = useCallback((reason: PulseReason) => changeStatus('Pausado', 'pause', reason), [changeStatus]);
    const endPause = useCallback(() => changeStatus('Disponible', 'status_change'), [changeStatus]);
    const punchInRemision = useCallback(() => changeStatus('En Remisión', 'activity', 'Remisión'), [changeStatus]);

    const value = {
        currentPulse,
        globalPulse,
        allPulses: allPulsesDay,
        isPaused: !!globalPulse || currentPulse?.status === 'Pausado' || currentPulse?.status === 'En Remisión',
        isInRemision: currentPulse?.status === 'En Remisión',
        status: currentPulse?.status || 'Disponible',
        loading,
        startPause,
        endPause,
        punchInRemision,
        punchOut: endPause
    };

    return (
        <SuitePulseContext.Provider value={value}>
            {children}
        </SuitePulseContext.Provider>
    );
}

export function useSuitePulseContext() {
    const context = useContext(SuitePulseContext);
    if (context === undefined) {
        throw new Error('useSuitePulseContext must be used within a SuitePulseProvider');
    }
    return context;
}
