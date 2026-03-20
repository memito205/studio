import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { MerchandiseItem } from '@/types';
import { format } from 'date-fns';

export const generatePDF = (items: MerchandiseItem[]) => {
  const doc = new jsPDF();
  
  // Group by destination
  const grouped = items.reduce((acc, item) => {
    if (!acc[item.destino]) {
      acc[item.destino] = [];
    }
    acc[item.destino].push(item);
    return acc;
  }, {} as Record<string, MerchandiseItem[]>);

  const destinations = Object.keys(grouped).sort();

  destinations.forEach((dest, index) => {
    if (index > 0) {
      doc.addPage();
    }

    doc.setFontSize(16);
    doc.text(`Reporte de Despacho - Destino: ${dest}`, 14, 20);
    
    const tableData = grouped[dest]
      .sort((a, b) => {
        // Prioritize tftFecha for sorting if available
        const dateA = a.tftFecha?.getTime() || a.fechaCreacion.getTime();
        const dateB = b.tftFecha?.getTime() || b.fechaCreacion.getTime();
        return dateA - dateB;
      })
      .map(item => [
        item.codigo,
        item.tftMatch || '-',
        item.tftFecha ? format(item.tftFecha, 'dd/MM/yyyy') : '-',
        item.tftCantidad !== undefined ? item.tftCantidad : '-'
      ]);

    autoTable(doc, {
      startY: 30,
      head: [['Código', 'TFT', 'Fecha TFT', 'Cant TFT']],
      body: tableData,
      theme: 'grid',
      headStyles: { fillColor: [20, 20, 20] },
      styles: { fontSize: 10 },
    });
  });

  doc.save(`despachos_${format(new Date(), 'yyyyMMdd_HHmm')}.pdf`);
};
