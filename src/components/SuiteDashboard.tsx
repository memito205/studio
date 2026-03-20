
"use client";
import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Archive, Building, ShoppingBag, Truck, Settings, Tags, PackagePlus, Calculator, FileBarChart, Printer, Ship, Map, LayoutDashboard, Beaker, ArrowDownUp } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth-context';

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
    onNavigateToDispatchManager
}) => {
    const { role } = useAuth();

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
        }
    ];

    let visibleModules = modules.filter(module => module.roles.includes(role || ''));

    if (role === 'conductor') {
      visibleModules = modules.filter(module => module.key === 'transfers');
    }
    
    return (
        <div className="flex flex-col items-center justify-center min-h-[80vh] text-center p-4">
            <h1 className="text-4xl font-bold text-foreground">
                Bienvenido a la Suite Nexus Operativo
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
        </div>
    );
}
