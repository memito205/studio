"use client";

import React, { useState, useCallback } from 'react';
import { AppView, CarrierData, ExpenseRecord, ColumnMapping, IncomeRecord, MainView, JustificationRecord } from './types';
import FileUploadStep from './components/FileUploadStep';
import DataMappingStep from './components/DataValidationStep';
import Dashboard from './components/Dashboard';
import Sidebar from './components/Sidebar';
import Header from './components/Header';
import ComparativeDashboard from './components/ComparativeDashboard';
import IncomeVsExpenseDashboard from './components/IncomeVsExpenseDashboard';
import ProfitabilityDashboard from './components/ProfitabilityDashboard';
import ExpenseProfitabilityDashboard from './components/ExpenseProfitabilityDashboard';
import JustificationManager from './components/JustificationManager';
import YearOverYearDashboard from './components/YearOverYearDashboard';
import AccrualMatchingDashboard from './components/AccrualMatchingDashboard';
import { parseDateFlexible } from './utils/formatters';

const carrierColors = [
  '#3b82f6', '#10b981', '#f97316', '#8b5cf6', '#ec4899', '#f59e0b', '#14b8a6', '#6366f1'
];

const cleanAndParseCurrency = (costString: string): number => {
    if (typeof costString !== 'string') {
        costString = String(costString || '0');
    }
    let cleaned = costString.replace(/[^0-9,.-]/g, '').trim();
    if (cleaned.includes(',') && (!cleaned.includes('.') || cleaned.lastIndexOf(',') > cleaned.lastIndexOf('.'))) {
        cleaned = cleaned.replace(/\./g, '').replace(',', '.');
    } else {
        cleaned = cleaned.replace(/,/g, '');
    }
    const value = parseFloat(cleaned);
    return isNaN(value) ? 0 : value;
};

export interface GastosTransporteProps {
  onReturn: () => void;
}

export default function GastosTransporte({ onReturn }: GastosTransporteProps) {
  const [currentView, setCurrentView] = useState<AppView>(AppView.DASHBOARD);
  const [mainView, setMainView] = useState<MainView>('dashboard');
  const [allCarriers, setAllCarriers] = useState<CarrierData[]>([]);
  const [incomeRecords, setIncomeRecords] = useState<IncomeRecord[]>([]);
  const [siopRecords, setSiopRecords] = useState<any[]>([]);
  const [justificationRecords, setJustificationRecords] = useState<JustificationRecord[]>([]);
  const [mappingData, setMappingData] = useState<{ carrierName: string, headers: string[], records: { [key: string]: string }[] } | null>(null);

  const handleFolderUpload = useCallback((carrierName: string, data: { headers: string[], records: { [key: string]: string }[] }) => {
    setMappingData({ carrierName, ...data });
    setCurrentView(AppView.MAPPING);
  }, []);

  const handleMappingConfirm = useCallback((mapping: ColumnMapping) => {
    if (!mappingData) return;
    const { carrierName, records: rawRecords } = mappingData;
    const finalRecords: ExpenseRecord[] = rawRecords.map((raw): ExpenseRecord | null => {
        try {
            const costValue = cleanAndParseCurrency(raw[mapping.costo] || '0');
            const formattedDate = parseDateFlexible(raw[mapping.fecha] || '', mapping.dateFormat);
            if (!formattedDate) return null;
            return {
                fecha: formattedDate,
                destino: raw[mapping.destino] || '',
                costo: costValue,
                contable: raw[mapping.contable] || '',
                concepto: raw[mapping.concepto] || '',
                guia: raw[mapping.guia] || '',
            };
        } catch {
            return null;
        }
    }).filter((record): record is ExpenseRecord => record !== null && /^\d{4}-\d{2}-\d{2}$/.test(record.fecha));

    const newCarrier: CarrierData = {
        id: `carrier_${Date.now()}`,
        name: carrierName,
        data: finalRecords,
        color: carrierColors[allCarriers.length % carrierColors.length],
    };
    setAllCarriers(prev => [...prev, newCarrier]);
    setMappingData(null);
    setCurrentView(AppView.DASHBOARD);
  }, [mappingData, allCarriers.length]);

  const handleMappingCancel = useCallback(() => {
    setMappingData(null);
    setCurrentView(AppView.DASHBOARD);
  }, []);

  const resetAndAddNew = () => {
    setCurrentView(AppView.UPLOAD);
  };

  const renderView = () => {
    switch (currentView) {
      case AppView.UPLOAD:
        return <FileUploadStep onFolderUpload={handleFolderUpload} onCancel={() => setCurrentView(AppView.DASHBOARD)} />;
      case AppView.MAPPING:
        return mappingData && <DataMappingStep data={mappingData} onConfirm={handleMappingConfirm} onCancel={handleMappingCancel} />;
      case AppView.DASHBOARD:
      default:
        switch (mainView) {
            case 'comparative':
              return <ComparativeDashboard carriers={allCarriers} />;
            case 'income-expense':
              return <IncomeVsExpenseDashboard carriers={allCarriers} incomeRecords={incomeRecords} setIncomeRecords={setIncomeRecords} />;
            case 'profitability':
              return <ProfitabilityDashboard incomeRecords={incomeRecords} carriers={allCarriers} siopRecords={siopRecords} setSiopRecords={setSiopRecords} justifications={justificationRecords} />;
            case 'expense-profitability':
              return <ExpenseProfitabilityDashboard incomeRecords={incomeRecords} carriers={allCarriers} siopRecords={siopRecords} justifications={justificationRecords} />;
            case 'justifications':
              return <JustificationManager justifications={justificationRecords} setJustifications={setJustificationRecords} />;
            case 'year-over-year':
              return <YearOverYearDashboard carriers={allCarriers} />;
            case 'accrual':
              return <AccrualMatchingDashboard incomeRecords={incomeRecords} carriers={allCarriers} siopRecords={siopRecords} />;
            case 'dashboard':
            default:
              return <Dashboard carriers={allCarriers} />;
        }
    }
  };

  return (
    <div className="flex h-[calc(100vh-2rem)] min-h-[640px] bg-slate-100 font-sans rounded-lg overflow-hidden border border-slate-200">
      <Sidebar carriers={allCarriers} onAddNew={resetAndAddNew} mainView={mainView} setMainView={setMainView} />
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        <Header mainView={mainView} onReturn={onReturn} />
        <main className="flex-1 overflow-x-hidden overflow-y-auto bg-slate-100 p-6 lg:p-8">
          {renderView()}
        </main>
      </div>
    </div>
  );
}
