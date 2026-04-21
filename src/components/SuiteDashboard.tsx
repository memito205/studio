
"use client";
import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Archive, Building, ShoppingBag, Truck, Settings, Tags, PackagePlus, Calculator, FileBarChart, Printer, Ship, Map, LayoutDashboard, Beaker, ArrowDownUp, Bot, Users, Factory, Play, Square, Lock, Tv } from 'lucide-react';
import { useSuitePulse } from '@/hooks/useSuitePulse';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { useAuth } from '@/hooks/use-auth-context';
import { VersionChecker } from './VersionChecker';

interface ModuleCardProps {
  icon: React.ElementType;
  title: string;
  description: string;
  actionText: string;
  onAction: () => void;
  disabled?: boolean;
}

const ModuleCard: React.FC<ModuleCardProps> = ({ icon: Icon, title, description, actionText, onAction, disabled }) => {
    return (
        <Card className="flex flex-col text-center items-center transform transition-transform duration-300 hover:scale-105 hover:shadow-xl h-full">
            <CardHeader className="items-center">
                <div className="p-4 bg-primary/10 rounded-full mb-4">
                    <Icon className="w-8 h-8 text-primary" />
                </div>
                <CardTitle>{title}</CardTitle>
            </CardHeader>
            <CardContent className="flex-grow">
                <CardDescription>{description}</CardDescription>
            </CardContent>
            <div className="p-6 pt-0">
                <Button onClick={onAction} disabled={disabled} className="w-full">
                    {actionText}
                </Button>
            </div>
        </Card>
    );
};


interface SuiteDashboardProps {
    onNavigateToPackingModule: () => void;
    onNavigateToWholesaleModule: () => void;
    onNavigateToLogisticsModule: () => void;
    onNavigateToGeneralSettings: () => void;
    onNavigateToLabelControlModule: () => void;
    onNavigateToMerchandiseLabelingModule: () => void;
    onNavigateToBagDistributionModule: () => void;
    onNavigateToMerchandiseReceptionModule: () => void;
    onNavigateToOtherFeaturesModule: () => void;
    onNavigateToRoutesModule: () => void;
    onNavigateToDashboardsModule: () => void;
    onNavigateToSampleControlModule: () => void;
    onNavigateToTransfersModule: () => void;
    onNavigateToDispatchManager: () => void;
    onNavigateToDistributorModule: () => void;
    onNavigateToControlPiso: () => void;
    onNavigateToExternalPortal: () => void;
    onNavigateToLogisticsPlatform: () => void;
}

export const SuiteDashboard: React.FC<SuiteDashboardProps> = ({ 
    onNavigateToPackingModule, 
    onNavigateToWholesaleModule, 
    onNavigateToLogisticsModule, 
    onNavigateToGeneralSettings, 
    onNavigateToLabelControlModule, 
    onNavigateToMerchandiseLabelingModule, 
    onNavigateToBagDistributionModule, 
    onNavigateToMerchandiseReceptionModule, 
    onNavigateToOtherFeaturesModule,
    onNavigateToRoutesModule,
    onNavigateToDashboardsModule,
    onNavigateToSampleControlModule,
    onNavigateToTransfersModule,
    onNavigateToDispatchManager,
    onNavigateToDistributorModule,
    onNavigateToControlPiso,
    onNavigateToExternalPortal,
    onNavigateToLogisticsPlatform
}) => {
    const { role } = useAuth();
    const { isInRemision, punchInRemision, punchOut, loading: pulseLoading } = useSuitePulse();

    const modules = [
        {
            key: 'packing',
            icon: Archive,
            title: "Módulo de Empaque",
            description: "Analice la productividad, cumplimiento y tiempos muertos de su equipo de empaque con inteligencia artificial.",
            actionText: "Acceder",
            onAction: onNavigateToPackingModule,
            roles: ['admin']
        },
        {
            key: 'dashboards',
            icon: LayoutDashboard,
            title: "Tableros de Control",
            description: "Visualice y analice los indicadores clave de rendimiento de sus operaciones de forma centralizada.",
            actionText: "Acceder",
            onAction: onNavigateToDashboardsModule,
            roles: ['admin', 'office']
        },
        {
            key: 'control_piso',
            icon: Users,
            title: "Control de Piso",
            description: "Monitor de sesiones activas, estados de operarios y gestión de pausas globales sincronizadas.",
            actionText: "Monitorear",
            onAction: onNavigateToControlPiso,
            roles: ['admin', 'supervisor']
        },
        {
            key: 'wholesale',
            icon: Building,
            title: "Ventas x Mayor",
            description: "Gestione pedidos a gran escala, clientes mayoristas y listas de precios especiales.",
            actionText: "Acceder",
            onAction: onNavigateToWholesaleModule,
            roles: ['admin', 'supervisor', 'operator']
        },
        {
            key: 'dispatch_manager',
            icon: Ship,
            title: "Gestor de Despachos",
            description: "Cruce y verifique los datos de mercancía y TFT para la gestión de despachos.",
            actionText: "Acceder",
            onAction: onNavigateToDispatchManager,
            roles: ['admin', 'supervisor']
        },
        {
            key: 'reception',
            icon: PackagePlus,
            title: "Recepción Mercancía",
            description: "Registre y verifique la mercancía entrante de proveedores y traslados.",
            actionText: "Acceder",
            onAction: onNavigateToMerchandiseReceptionModule,
            roles: ['admin', 'supervisor', 'operator']
        },
        {
            key: 'bag_distribution',
            icon: ShoppingBag,
            title: "Pronóstico y Distribución de Insumos",
            description: "Analice consumos, genere pronósticos y calcule la distribución óptima de insumos (bolsas, tela).",
            actionText: "Acceder",
            onAction: onNavigateToBagDistributionModule,
            roles: ['admin']
        },
        {
            key: 'transfers',
            icon: ArrowDownUp,
            title: "Transferencias",
            description: "Gestione transferencias de mercancía entre bodegas y tiendas.",
            actionText: "Acceder",
            onAction: onNavigateToTransfersModule,
            roles: ['admin', 'supervisor', 'operator', 'conductor']
        },
        {
            key: 'merchandise_labeling',
            icon: Printer,
            title: "Etiquetado Mercancía",
            description: "Imprima etiquetas para productos individuales o lotes de mercancía.",
            actionText: "Acceder",
            onAction: onNavigateToMerchandiseLabelingModule,
            roles: ['admin', 'supervisor', 'operator']
        },
        {
            key: 'routes',
            icon: Map,
            title: "Rutas",
            description: "Planifique y optimice las rutas de entrega y recolección.",
            actionText: "Acceder",
            onAction: onNavigateToRoutesModule,
            roles: ['admin', 'supervisor', 'operator']
        },
        {
            key: 'sample_control',
            icon: Beaker,
            title: "Control de Muestras",
            description: "Gestione el ciclo de vida de las muestras, desde la solicitud hasta la devolución o descarte.",
            actionText: "Acceder",
            onAction: onNavigateToSampleControlModule,
            roles: ['admin', 'office']
        },
        {
            key: 'label_control',
            icon: Tags,
            title: "Control Etiquetas",
            description: "Genere, imprima y gestione las etiquetas de despacho para sus pedidos.",
            actionText: "Acceder",
            onAction: onNavigateToLabelControlModule,
            roles: ['admin']
        },
        {
            key: 'logistics',
            icon: Truck,
            title: "Conciliación Transportadoras",
            description: "Compare y concilie las guías de las transportadoras con sus registros de despacho.",
            actionText: "Acceder",
            onAction: onNavigateToLogisticsModule,
            roles: ['admin']
        },
        {
            key: 'logistics_platform',
            icon: FileBarChart,
            title: "Plataforma Logística",
            description: "Analice y gestione indicadores de bodega, procesos, descansos y rutas de forma centralizada.",
            actionText: "Acceder",
            onAction: onNavigateToLogisticsPlatform,
            roles: ['admin', 'office', 'supervisor']
        },
        {
            key: 'other_features',
            icon: Calculator,
            title: "Otras Funcionalidades",
            description: "Herramientas adicionales como la calculadora de costo financiero y el módulo de fletes VTEX.",
            actionText: "Acceder",
            onAction: onNavigateToOtherFeaturesModule,
            roles: ['admin', 'office']
        },
        {
            key: 'settings',
            icon: Settings,
            title: "Configuración General",
            description: "Ajuste parámetros globales de la aplicación, como metas de productividad y otras configuraciones.",
            actionText: "Acceder",
            onAction: onNavigateToGeneralSettings,
            roles: ['admin']
        },
        {
            key: 'distributor_module',
            icon: Bot,
            title: "Distribuidor IA",
            description: "Reparto equitativo inteligente de mercancías apoyado con inteligencia artificial.",
            actionText: "Acceder",
            onAction: onNavigateToDistributorModule,
            roles: ['admin', 'office']
        },
        {
            key: 'external_portal',
            icon: Lock,
            title: "Portal Etiquetado Externo",
            description: "Acceso simplificado para personal externo mediante PIN de 4 dígitos para registro de productividad.",
            actionText: "Entrar Portal",
            onAction: onNavigateToExternalPortal,
            roles: ['admin', 'supervisor', 'external_operator']
        },
        {
            key: 'ecommerce_tv',
            icon: Tv,
            title: "Modo TV Ecommerce",
            description: "Vista de Kiosko optimizada para pantallas grandes, actualizando automáticamente.",
            actionText: "Abrir Modo TV",
            onAction: () => window.open('/tv-ecommerce', '_blank'),
            roles: ['admin', 'office', 'supervisor', 'operator']
        }
    ];

    let visibleModules = modules.filter(module => module.roles.includes(role || ''));

    if (role === 'conductor') {
      visibleModules = modules.filter(module => module.key === 'transfers');
    }
    
    return (
        <div className="flex flex-col items-center justify-center min-h-[80vh] text-center p-4">
            <h1 className="text-4xl font-bold text-foreground">
                Bienvenido a la Suite Nexus Operativo (Sync)
            </h1>
            <p className="mt-4 max-w-2xl text-lg text-muted-foreground">
                Su centro de control para la inteligencia logística. Seleccione un módulo para comenzar a optimizar sus operaciones.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-8 mt-12 w-full max-w-screen-2xl">
                 {visibleModules.map(module => (
                     <ModuleCard 
                        key={module.key}
                        icon={module.icon}
                        title={module.title}
                        description={module.description}
                        actionText={module.actionText}
                        onAction={module.onAction}
                     />
                 ))}
            </div>

            {(role === 'operator' || role === 'supervisor' || role === 'admin') && (
                <div className="fixed bottom-8 right-8 z-50 flex flex-col items-end">
                    {isInRemision && (
                        <Badge className="bg-blue-500 text-white animate-pulse mb-3 px-4 py-1 text-sm shadow-md border-none">
                            Trabajando en Remisión
                        </Badge>
                    )}
                    <Button 
                        size="lg" 
                        variant={isInRemision ? "destructive" : "default"}
                        className={cn(
                            "h-16 rounded-full shadow-2xl transition-all duration-300 hover:scale-105 px-8",
                            !isInRemision && "bg-blue-600 hover:bg-blue-700"
                        )}
                        onClick={isInRemision ? punchOut : punchInRemision}
                        disabled={pulseLoading}
                    >
                        {isInRemision ? <Square className="mr-2 h-5 w-5 fill-current" /> : <Play className="mr-2 h-5 w-5 fill-current" />}
                        <span className="text-lg font-bold">
                            {isInRemision ? "Detener Remisión" : "Iniciar Remisión"}
                        </span>
                    </Button>
                </div>
            )}
            <VersionChecker />
        </div>
    );
}
