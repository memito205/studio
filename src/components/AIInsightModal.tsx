
"use client";

import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Loader2, Sparkles } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import type { ActionPlan } from '@/types';

interface AIInsightModalProps {
  isOpen: boolean;
  isLoading: boolean;
  content: string;
  actionPlan: ActionPlan | null;
  onGenerateActionPlan: () => void;
  onClose: () => void;
}

export const AIInsightModal: React.FC<AIInsightModalProps> = ({
  isOpen,
  isLoading,
  content,
  actionPlan,
  onGenerateActionPlan,
  onClose,
}) => {
  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="text-primary" />
            Análisis con IA
          </DialogTitle>
        </DialogHeader>
        <div className="py-4 space-y-4">
          {isLoading && !content ? (
            <div className="flex items-center justify-center h-24">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="ml-3 text-muted-foreground">Obteniendo análisis...</p>
            </div>
          ) : (
            <p className="text-sm text-foreground whitespace-pre-wrap">{content}</p>
          )}

          {actionPlan && (
             <Alert className="mt-4 border-accent">
                <Sparkles className="h-4 w-4 text-accent" />
                <AlertTitle>Plan de Acción Sugerido</AlertTitle>
                <AlertDescription>
                   <p className="font-semibold mb-2">{actionPlan.title}</p>
                   <ul className="list-disc list-inside space-y-1">
                       {actionPlan.steps.map((step, index) => <li key={index}>{step}</li>)}
                   </ul>
                </AlertDescription>
            </Alert>
          )}
        </div>
        <DialogFooter className="sm:justify-between gap-2">
            {!actionPlan && (
                 <Button onClick={onGenerateActionPlan} disabled={isLoading} variant="outline" className="w-full sm:w-auto">
                    {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <Sparkles className="mr-2 h-4 w-4"/>}
                    Generar Plan de Acción
                </Button>
            )}
           <DialogClose asChild>
                <Button type="button" variant="secondary" className="w-full sm:w-auto mt-2 sm:mt-0">
                    Cerrar
                </Button>
           </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
