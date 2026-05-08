"use client";

import React, { createContext, useContext, useEffect, useState, useCallback, ReactNode, useMemo } from 'react';
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
    refreshPulses: () => Promise<void>;
}

const SuitePulseContext = createContext<SuitePulseContextType | undefined>(undefined);

export function SuitePulseProvider({ children }: { children: ReactNode }) {
    const { user } = useAuth();
    const { toast } = useToast();
    const [currentPulse, setCurrentPulse] = useState<OperationPulse | null>(null);
    const [globalPulse, setGlobalPulseState] = useState<OperationPulse | null>(null);
    const [allPulsesDay, setAllPulsesDay] = useState<OperationPulse[]>([]);
    const [loading, setLoading] = useState(true);

    // Helper to get a "Freshness" date (last 18 hours or start of day)
    const freshStartTime = useMemo(() => {
        const d = new Date();
        d.setHours(d.getHours() - 18);
        return d;
    }, []);

    // 1. Listen to Global Active Pulse (Only if fresh)
    useEffect(() => {
        const q = query(
            collection(firestore, 'operation_pulses'),
            where('isGlobal', '==', true),
            where('endTime', '==', null),
            where('startTime', '>=', Timestamp.fromDate(freshStartTime)),
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
    }, [freshStartTime]);

    // 2. Listen to User's Current Active Pulse (Only if fresh)
    useEffect(() => {
        if (!user?.uid) {
            setLoading(false);
            return;
        }

        const q = query(
            collection(firestore, 'operation_pulses'),
            where('userId', '==', user.uid),
            where('endTime', '==', null),
            where('startTime', '>=', Timestamp.fromDate(freshStartTime)),
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
    }, [user?.uid, freshStartTime]);

    // 3. Get ALL past pulses of the day for real-time productivity (One time fetch)
    const fetchPulsesOfDay = useCallback(async () => {
        if (!user?.uid) return;
        
        const startOfToday = new Date();
        startOfToday.setHours(0, 0, 0, 0);

        const qGlobal = query(
            collection(firestore, 'operation_pulses'),
            where('isGlobal', '==', true),
            where('startTime', '>=', Timestamp.fromDate(startOfToday))
        );

        const qUser = query(
            collection(firestore, 'operation_pulses'),
            where('userId', '==', user.uid),
            where('startTime', '>=', Timestamp.fromDate(startOfToday))
        );

        try {
            // We verify permissions individually to avoid crashing everything
            let globalPulses: OperationPulse[] = [];
            try {
                const globalSnap = await getDocs(qGlobal);
                globalPulses = globalSnap.docs.map(doc => ({
                    id: doc.id,
                    ...doc.data(),
                    startTime: doc.data().startTime?.toDate(),
                    endTime: doc.data().endTime?.toDate() || null
                } as OperationPulse));
            } catch (err) {
                console.warn("[SuitePulse] No permissions for global pulses or query failed:", err);
            }

            let userPulses: OperationPulse[] = [];
            try {
                const userSnap = await getDocs(qUser);
                userPulses = userSnap.docs.map(doc => ({
                    id: doc.id,
                    ...doc.data(),
                    startTime: doc.data().startTime?.toDate(),
                    endTime: doc.data().endTime?.toDate() || null
                } as OperationPulse));
            } catch (err) {
                console.error("[SuitePulse] Fatal error fetching user pulses:", err);
            }

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

            // Re-fetch historical pulses after status change to ensure consistency
            await fetchPulsesOfDay();

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
    }, [user, toast, fetchPulsesOfDay]);

    const startPause = useCallback((reason: PulseReason) => changeStatus('Pausado', 'pause', reason), [changeStatus]);
    const endPause = useCallback(() => changeStatus('Disponible', 'status_change'), [changeStatus]);
    const punchInRemision = useCallback(() => changeStatus('En Remisión', 'activity', 'Remisión'), [changeStatus]);

    const value = {
        currentPulse,
        globalPulse,
        allPulses: allPulsesDay,
        // En Remisión es trabajo activo en remisión, no una pausa (si no, el timer y el estado UI fallan).
        isPaused: !!globalPulse || currentPulse?.status === 'Pausado',
        isInRemision: currentPulse?.status === 'En Remisión',
        status: currentPulse?.status || 'Disponible',
        loading,
        startPause,
        endPause,
        punchInRemision,
        punchOut: endPause,
        refreshPulses: fetchPulsesOfDay
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
