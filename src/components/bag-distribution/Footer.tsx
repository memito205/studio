import React from 'react';

export const Footer: React.FC = () => {
  const currentYear = new Date().getFullYear();
  return (
    <footer className="bg-slate-900 text-slate-400 text-center p-6 mt-auto">
      <p className="text-sm">
        &copy; {currentYear} Sistema de Pronóstico de Compras. Todos los derechos reservados.
      </p>
      <p className="text-xs mt-1">
        Desarrollado con React, TypeScript y Tailwind CSS.
      </p>
    </footer>
  );
};
