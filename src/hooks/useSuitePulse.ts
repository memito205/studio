"use client";

import { useSuitePulseContext } from '@/contexts/SuitePulseContext';

/**
 * useSuitePulse hook
 * Now acts as a wrapper around SuitePulseContext to provide a stable, 
 * centralized pulse system across the entire application.
 */
export function useSuitePulse() {
    const context = useSuitePulseContext();
    
    return {
        ...context,
        // Ensure reverse compatibility and specific naming if needed
        punchOut: context.endPause 
    };
}
