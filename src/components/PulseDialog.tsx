"use client";

import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from './ui/dialog';
import { Button } from './ui/button';
import { Coffee, Utensils, Cookie, Bath, HelpCircle, AlertCircle, Play, LogOut } from 'lucide-react';
import type { PulseReason } from '@/types';

interface PulseDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (reason: PulseReason) => void;
}

const REASONS: { label: string; value: PulseReason; icon: any; color: string }[] = [
  { label: 'Desayuno (15 min)', value: 'Desayuno', icon: Coffee, color: 'text-orange-500' },
  { label: 'Almuerzo (30 min)', value: 'Almuerzo', icon: Utensils, color: 'text-green-600' },
  { label: 'Refrigerio (15 min)', value: 'Refrigerio', icon: Cookie, color: 'text-amber-500' },
  { label: 'Baño', value: 'Baño', icon: Bath, color: 'text-blue-500' },
  { label: 'Café', value: 'Café', icon: Coffee, color: 'text-brown-500' },
  { label: 'Soporte Técnico', value: 'Soporte Técnico', icon: HelpCircle, color: 'text-purple-500' },
  { label: 'Sin Carga de Trabajo', value: 'Sin Carga de Trabajo', icon: AlertCircle, color: 'text-red-500' },
  { label: 'Otro', value: 'Otro', icon: Play, color: 'text-gray-500' },
];

export const PulseDialog: React.FC<PulseDialogProps> = ({ isOpen, onClose, onSelect }) => {
  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Registrar Pausa de Operación</DialogTitle>
          <DialogDescription>
            Selecciona el motivo de tu pausa para sincronizar los tiempos reportados.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-4 py-4">
          {REASONS.map((r) => (
            <Button
              key={r.value}
              variant="outline"
              className="flex flex-col items-center justify-center h-24 gap-2 hover:bg-accent transition-all border-2"
              onClick={() => onSelect(r.value)}
            >
              <r.icon className={`w-8 h-8 ${r.color}`} />
              <span className="text-xs font-semibold">{r.label}</span>
            </Button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
};
