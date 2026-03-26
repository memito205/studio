"use client";

import { useEffect, useRef, useState, useCallback } from 'react';
import { useSuitePulse } from './useSuitePulse';
import { useAuth } from './use-auth-context';

export function useInactivityGuard(timeoutMs: number = 5 * 60 * 1000) {
    const { user, role } = useAuth();
    const { status, isInRemision, isPaused, startPause } = useSuitePulse();
    const [showModal, setShowModal] = useState(false);
    const timerRef = useRef<NodeJS.Timeout | null>(null);
    const lastActivityRef = useRef<number>(Date.now());

    const resetTimer = useCallback(() => {
        lastActivityRef.current = Date.now();
        if (timerRef.current) clearTimeout(timerRef.current);
        
        // Only run guard if not paused, not in Remisión, and NOT an admin
        if (!isPaused && !isInRemision && role !== 'admin') {
            timerRef.current = setTimeout(() => {
                setShowModal(true);
            }, timeoutMs);
        }
    }, [isPaused, isInRemision, timeoutMs, role]);

    useEffect(() => {
        const events = ['mousedown', 'keydown', 'touchstart', 'scroll', 'mousemove'];
        
        const handleEvent = () => resetTimer();

        events.forEach(event => window.addEventListener(event, handleEvent));
        resetTimer();

        return () => {
            events.forEach(event => window.removeEventListener(event, handleEvent));
            if (timerRef.current) clearTimeout(timerRef.current);
        };
    }, [resetTimer]);

    const justifyInactivity = async (reason: any) => {
        await startPause(reason);
        setShowModal(false);
    };

    return {
        showModal,
        setShowModal,
        justifyInactivity,
        lastActivity: lastActivityRef.current
    };
}
