/** @jsxImportSource react */
"use client";

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Loader2, Lock, Building2, LogOut, Clock, AlertTriangle, Tags, ArrowLeft } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { getExternalVendors, validateExternalVendorPin } from '@/app/reception/actions';
import type { ExternalVendor } from '@/types';
import { LabelingOperatorView } from './LabelingOperatorView';

const InactivityTimer = ({ durationInMinutes, onLogout }: { durationInMinutes: number; onLogout: () => void }) => {
    const timeoutRef = useRef<NodeJS.Timeout | null>(null);
    const limit = durationInMinutes * 60 * 1000;

    const resetTimer = useCallback(() => {
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
        timeoutRef.current = setTimeout(onLogout, limit);
    }, [onLogout, limit]);

    useEffect(() => {
        const events = ['mousedown', 'mousemove', 'keypress', 'scroll', 'touchstart'];
        events.forEach(e => window.addEventListener(e, resetTimer));
        resetTimer();
        return () => {
            events.forEach(e => window.removeEventListener(e, resetTimer));
            if (timeoutRef.current) clearTimeout(timeoutRef.current);
        };
    }, [resetTimer]);

    return null;
};

export const ExternalLabelingPortal: React.FC = () => {
  const [vendors, setVendors] = useState<ExternalVendor[]>([]);
  const [vendorId, setVendorId] = useState('');
  const [pin, setPin] = useState('');
  const [operatorName, setOperatorName] = useState('');
  const [step, setStep] = useState<'v-select' | 'o-select' | 'p-entry'>('v-select');
  const [isLoading, setIsLoading] = useState(false);
  const [vendor, setVendor] = useState<ExternalVendor | null>(null);
  const { toast } = useToast();
  
  const handleSignOut = useCallback(() => {
    setVendor(null);
    setOperatorName('');
    setPin('');
    setStep('v-select');
    sessionStorage.removeItem('ext_vendor');
    sessionStorage.removeItem('ext_name');
    toast({ title: "Sesión cerrada", description: "La sesión se ha cerrado correctamente." });
  }, [toast]);

  useEffect(() => {
    const storedVendor = sessionStorage.getItem('ext_vendor');
    const storedName = sessionStorage.getItem('ext_name');
    if (storedVendor && storedName) {
        setVendor(JSON.parse(storedVendor));
        setOperatorName(storedName);
    }

    const fetchVendors = async () => {
      const result = await getExternalVendors();
      if (result.success && result.data) {
        setVendors(result.data);
      } else {
        toast({ variant: 'destructive', title: 'Error', description: 'No se pudieron cargar las empresas externas.' });
      }
    };
    fetchVendors();
  }, [toast]);

  const handlePinInput = (num: string) => {
    if (pin.length < 4) {
        setPin(prev => prev + num);
    }
  };

  const handlePinSubmit = async () => {
    if (!vendorId || pin.length < 4) return;

    setIsLoading(true);
    const result = await validateExternalVendorPin(vendorId, pin, operatorName);
    if (result.success && result.vendor) {
        setVendor(result.vendor);
        sessionStorage.setItem('ext_vendor', JSON.stringify(result.vendor));
        sessionStorage.setItem('ext_name', operatorName);
        toast({ title: 'Bienvenido', description: `Sesión iniciada para ${operatorName} (${result.vendor.name})` });
    } else {
      toast({ variant: 'destructive', title: 'Acceso Denegado', description: result.error || 'PIN incorrecto' });
      setPin('');
    }
    setIsLoading(false);
  };

  if (vendor) {
    return (
        <div className="container mx-auto p-4 max-w-6xl">
            <div className="flex justify-between items-center mb-6 bg-card p-4 rounded-lg shadow-sm border">
                <div>
                    <h1 className="text-xl font-bold flex items-center gap-2">
                        <Tags className="text-primary" />
                        Portal de Etiquetado Externo
                    </h1>
                    <p className="text-sm text-muted-foreground">
                        {vendor.name} • <strong>{operatorName}</strong>
                    </p>
                </div>
                <Button variant="outline" size="sm" onClick={handleSignOut} className="flex items-center gap-2">
                    <LogOut className="h-4 w-4" />
                    Cerrar Sesión
                </Button>
            </div>

            <div className="bg-muted/30 p-6 rounded-xl min-h-[60vh]">
                <LabelingOperatorView 
                    isExternalPortal={true} 
                    externalVendor={{ ...vendor, operatorName }} 
                />
            </div>
            
            <InactivityTimer durationInMinutes={2} onLogout={handleSignOut} />
        </div>
    );
  }

  return (
    <div className="min-h-[90vh] flex items-center justify-center p-4 bg-gradient-to-br from-background via-muted/5 to-primary/5">
      <Card className="w-full max-w-md shadow-2xl border-primary/10 bg-card/80 backdrop-blur-md overflow-hidden">
        <CardHeader className="space-y-1 pb-8 text-center">
            <div className="mx-auto bg-primary/10 w-16 h-16 rounded-2xl flex items-center justify-center mb-4 ring-8 ring-primary/5">
                <Lock className="h-8 w-8 text-primary" />
            </div>
            <CardTitle className="text-3xl font-extrabold tracking-tight">Acceso Externo</CardTitle>
            <CardDescription className="text-base">Módulo de Etiquetado para Terceros</CardDescription>
        </CardHeader>

        <CardContent>
            <div className="space-y-6">
                {step === 'v-select' && (
                    <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2">
                        <div className="space-y-2 text-left">
                            <label className="text-sm font-medium">1. Seleccione la Empresa</label>
                            <select 
                                className="w-full p-3 rounded-md border bg-background text-lg"
                                value={vendorId}
                                onChange={(e) => setVendorId(e.target.value)}
                            >
                                <option value="">-- Elige un proveedor --</option>
                                {vendors.map(v => (
                                    <option key={v.id} value={v.id}>{v.name}</option>
                                ))}
                            </select>
                        </div>
                        <Button 
                            className="w-full h-12 text-lg" 
                            disabled={!vendorId} 
                            onClick={() => {
                                setStep('o-select');
                                setOperatorName(''); // Reset name when vendor changes
                            }}
                        >
                            Siguiente
                        </Button>
                    </div>
                )}

                {step === 'o-select' && (
                    <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2">
                        <div className="space-y-2 text-left">
                            <label className="text-sm font-medium">2. Seleccione su Nombre</label>
                            <select 
                                className="w-full p-3 rounded-md border bg-background text-lg"
                                value={operatorName}
                                onChange={(e) => setOperatorName(e.target.value)}
                            >
                                <option value="">-- Selecciona quién eres --</option>
                                {vendors.find(v => v.id === vendorId)?.operators?.map((op, i) => (
                                    <option key={i} value={op.name}>{op.name}</option>
                                ))}
                            </select>
                        </div>
                        <div className="flex gap-2">
                            <Button variant="outline" className="h-12" onClick={() => setStep('v-select')}>
                                <ArrowLeft className="h-4 w-4 mr-2" />
                            </Button>
                            <Button className="flex-1 h-12 text-lg" disabled={!operatorName} onClick={() => setStep('p-entry')}>
                                Continuar al PIN
                            </Button>
                        </div>
                    </div>
                )}

                {step === 'p-entry' && (
                    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2">
                        <div className="text-center">
                            <p className="text-sm text-muted-foreground mb-4">
                                Empresa: <strong>{vendors.find(v => v.id === vendorId)?.name}</strong><br />
                                Operario: <strong>{operatorName}</strong>
                            </p>
                            <div className="flex items-center justify-center gap-3 mb-8">
                                {[0, 1, 2, 3].map((i) => (
                                    <div 
                                        key={i}
                                        className={`w-5 h-5 rounded-full border-2 border-primary transition-all duration-200 ${pin.length > i ? 'bg-primary scale-110' : 'bg-transparent'}`}
                                    />
                                ))}
                            </div>
                        </div>

                        <div className="grid grid-cols-3 gap-3 max-w-[260px] mx-auto">
                            {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((num) => (
                                <Button 
                                    key={num} 
                                    variant="outline" 
                                    className="h-14 w-14 text-xl font-bold rounded-xl hover:bg-primary hover:text-primary-foreground"
                                    onClick={() => handlePinInput(num.toString())}
                                >
                                    {num}
                                </Button>
                            ))}
                            <Button variant="ghost" className="h-14 w-14 text-lg" onClick={() => setPin('')}>C</Button>
                            <Button 
                                variant="outline" 
                                className="h-14 w-14 text-xl font-bold rounded-xl"
                                onClick={() => handlePinInput('0')}
                            >
                                0
                            </Button>
                            <Button variant="ghost" className="h-14 w-14" onClick={() => setStep('o-select')}>
                                <ArrowLeft className="h-5 w-5" />
                            </Button>
                        </div>

                        <Button 
                            className="w-full h-14 text-lg font-bold shadow-lg shadow-primary/20" 
                            disabled={pin.length !== 4 || isLoading}
                            onClick={handlePinSubmit}
                        >
                            {isLoading ? <Loader2 className="h-5 w-5 animate-spin mr-2" /> : <Lock className="h-5 w-5 mr-2" />}
                            Validar e Ingresar
                        </Button>
                    </div>
                )}
            </div>

          <div className="mt-8 p-4 rounded-xl bg-amber-500/5 border border-amber-500/10 flex gap-3 items-start">
             <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
             <div className="space-y-1 text-left">
                <p className="text-xs font-bold text-amber-700 dark:text-amber-400">Aviso de Seguridad</p>
                <p className="text-[10px] leading-relaxed text-amber-600/80 dark:text-amber-400/80">
                    Por seguridad, la sesión se cerrará automáticamente tras <strong>2 minutos</strong> de inactividad detectada.
                </p>
             </div>
          </div>
        </CardContent>
        
        <div className="p-6 pt-0 text-center border-t border-primary/5 mt-4">
            <p className="text-[10px] text-muted-foreground/60 font-medium pt-4">NEXUS OPERATIVO &copy; {new Date().getFullYear()}</p>
        </div>
      </Card>
    </div>
  );
};

export default ExternalLabelingPortal;
