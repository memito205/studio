'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { getAppVersion } from '@/app/actions';
import { CURRENT_APP_VERSION } from '@/app/version';
import { 
    Dialog, 
    DialogContent, 
    DialogHeader, 
    DialogTitle, 
    DialogDescription,
    DialogFooter
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { RefreshCcw, AlertTriangle } from 'lucide-react';

/** Compara etiquetas tipo 1.2.10 vs 1.2.3 (solo segmentos numéricos). -1 si a<b, 0 igual, 1 si a>b. */
function compareReleaseTags(a: string, b: string): number {
    const pa = a.replace(/^v/i, '').split('.').map((x) => parseInt(x, 10) || 0);
    const pb = b.replace(/^v/i, '').split('.').map((x) => parseInt(x, 10) || 0);
    const len = Math.max(pa.length, pb.length);
    for (let i = 0; i < len; i++) {
        const da = pa[i] ?? 0;
        const db = pb[i] ?? 0;
        if (da < db) return -1;
        if (da > db) return 1;
    }
    return 0;
}

export const VersionChecker: React.FC = () => {
    const [needsUpdate, setNeedsUpdate] = useState(false);
    const [latestVersion, setLatestVersion] = useState<string | null>(null);

    const checkVersion = useCallback(async () => {
        const result = await getAppVersion();
        const remote = result.version?.trim();
        if (!remote) {
            setNeedsUpdate(false);
            setLatestVersion(null);
            return;
        }
        // Solo pedir recarga si Firestore exige una versión *más nueva* que la del bundle.
        // Si el metadata quedó viejo (p. ej. 1.1.2) y el usuario ya tiene 1.1.4, no bloquear.
        if (compareReleaseTags(remote, CURRENT_APP_VERSION) > 0) {
            setLatestVersion(remote);
            setNeedsUpdate(true);
        } else {
            setNeedsUpdate(false);
            setLatestVersion(null);
        }
    }, []);

    useEffect(() => {
        // Check immediately on mount
        checkVersion();

        // Check every 5 minutes
        const interval = setInterval(checkVersion, 5 * 60 * 1000);
        return () => clearInterval(interval);
    }, [checkVersion]);

    const handleRefresh = () => {
        window.location.reload();
    };

    return (
        <Dialog open={needsUpdate} onOpenChange={() => {}}>
            <DialogContent className="sm:max-w-[425px]" onPointerDownOutside={(e) => e.preventDefault()} onEscapeKeyDown={(e) => e.preventDefault()}>
                <DialogHeader>
                    <DialogTitle className="flex items-center text-amber-600 gap-2">
                        <AlertTriangle className="h-5 w-5" />
                        Actualización Requerida
                    </DialogTitle>
                    <DialogDescription className="py-4 text-base">
                        Esta pestaña aún tiene la versión <strong>{CURRENT_APP_VERSION}</strong> y en el servidor ya está activa la{' '}
                        <strong>{latestVersion}</strong>. Recargue la página para cargar el nuevo despliegue y evitar datos inconsistentes.
                    </DialogDescription>
                </DialogHeader>
                <DialogFooter>
                    <Button onClick={handleRefresh} className="w-full bg-blue-600 hover:bg-blue-700">
                        <RefreshCcw className="mr-2 h-4 w-4" />
                        Actualizar Ahora
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};
