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

export const VersionChecker: React.FC = () => {
    const [needsUpdate, setNeedsUpdate] = useState(false);
    const [latestVersion, setLatestVersion] = useState<string | null>(null);

    const checkVersion = useCallback(async () => {
        const result = await getAppVersion();
        if (result.version && result.version !== CURRENT_APP_VERSION) {
            // Check if the remote version is different from the local one
            setLatestVersion(result.version);
            setNeedsUpdate(true);
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
                        Se ha desplegado una nueva versión del sistema ({latestVersion}). 
                        Para garantizar el correcto funcionamiento y la integridad de los datos, es necesario recargar la página.
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
