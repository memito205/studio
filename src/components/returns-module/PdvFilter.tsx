import React, { useState, useRef, useEffect } from 'react';
import type { FilterCategory, Filters } from '../../types';

interface PdvFilterProps {
  allPdvs: string[];
  selectedPdvs: string[];
  onPdvChange: (pdv: string) => void;
}

export const PdvFilter: React.FC<PdvFilterProps> = ({ allPdvs, selectedPdvs, onPdvChange }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [wrapperRef]);

  const filteredPdvs = allPdvs.filter(pdv => 
    pdv.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const getButtonText = () => {
    if (selectedPdvs.length === 0) return 'Filtrar por PDV';
    if (selectedPdvs.length === 1) return selectedPdvs[0];
    return `${selectedPdvs.length} PDVs seleccionados`;
  };

  return (
    <div className="relative" ref={wrapperRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full sm:w-auto flex items-center justify-between bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md shadow-sm px-4 py-2 text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500"
      >
        <span className="truncate pr-2">{getButtonText()}</span>
        <svg className={`w-4 h-4 text-slate-400 transform transition-transform ${isOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path></svg>
      </button>

      {isOpen && (
        <div className="absolute z-20 mt-1 w-72 bg-white dark:bg-slate-700 rounded-md shadow-lg border dark:border-slate-600 right-0">
          <div className="p-2">
            <input
              type="text"
              placeholder="Buscar PDV..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full px-3 py-2 text-sm bg-slate-100 dark:bg-slate-600 border border-slate-300 dark:border-slate-500 rounded-md focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </div>
          <ul className="max-h-60 overflow-y-auto p-2">
            {filteredPdvs.length > 0 ? (
                filteredPdvs.map(pdv => (
                <li key={pdv}>
                  <label className="flex items-center w-full px-2 py-2 text-sm text-slate-700 dark:text-slate-200 rounded-md hover:bg-slate-100 dark:hover:bg-slate-600 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selectedPdvs.includes(pdv)}
                      onChange={() => onPdvChange(pdv)}
                      className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                    />
                    <span className="ml-3">{pdv}</span>
                  </label>
                </li>
              ))
            ) : (
                <li className="px-2 py-2 text-sm text-slate-500 dark:text-slate-400">No se encontraron resultados.</li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
};
