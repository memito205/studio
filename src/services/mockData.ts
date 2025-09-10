import { RawTransaction, TransactionType } from '../types';

const BRANDS = ['NIKE', 'UNDER ARMOUR', 'REEBOK', 'CONVERSE', 'TREME', 'N/A'];
const GENDERS: ('HOMBRE' | 'DAMA' | 'JUNIOR' | 'UNISEX' | 'N/A')[] = ['HOMBRE', 'DAMA', 'JUNIOR', 'UNISEX', 'N/A'];
const GROUPS: ('CALZADO' | 'ROPA' | 'ACCESORIOS' | 'N/A')[] = ['CALZADO', 'ROPA', 'ACCESORIOS', 'N/A'];
const RETURN_REASONS: ('CLIENTE NO ENCONTRADO' | 'TALLA GRANDE' | 'CAMBIO POR REFERENCIA' | 'TALLA PEQUEÑA' | 'NO ERA LO QUE ESPERABA' | 'OTRO')[] = ['CLIENTE NO ENCONTRADO', 'TALLA GRANDE', 'CAMBIO POR REFERENCIA', 'TALLA PEQUEÑA', 'NO ERA LO QUE ESPERABA', 'OTRO'];
const PDVS = ['PDV Tienda Principal', 'Mercado Libre', 'PDV Outlet', 'Ventas por Internet', 'PDV Sur', 'Canal INSTORE', 'N/A', 'Falabella'];

const getRandomElement = <T,>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];
const getRandomNumber = (min: number, max: number) => Math.random() * (max - min) + min;

const jsDateToExcelSerial = (date: Date): number => {
    // Simplified conversion for mock data. Based on Excel's 1900 date system.
    return (date.getTime() - new Date('1899-12-30').getTime()) / (24 * 60 * 60 * 1000);
}


export const generateMockData = (): RawTransaction[] => {
  const data: RawTransaction[] = [];
  const today = new Date();
  const currentYear = today.getFullYear();
  const years = [currentYear - 1, currentYear]; 

  years.forEach(year => {
    const endMonth = (year === currentYear) ? today.getMonth() : 11;

    for (let month = 0; month <= endMonth; month++) {
      const daysInMonth = new Date(year, month + 1, 0).getDate();
      const monthlySalesTransactions = getRandomNumber(1000, 2000);
      
      for (let i = 0; i < monthlySalesTransactions; i++) {
        const day = Math.floor(getRandomNumber(1, daysInMonth));
        const date = new Date(year, month, day);
        const reference = `REF-${String(Math.floor(getRandomNumber(1, 999))).padStart(3, '0')}-${getRandomElement(['A', 'B', 'C'])}`;

        // Add a sale
        data.push({
          'Fecha': jsDateToExcelSerial(date),
          'Tipo docto.': TransactionType.Sale,
          'Valor subtotal local': getRandomNumber(50000, 500000),
          'Marca': getRandomElement(BRANDS),
          'Genero': getRandomElement(GENDERS),
          'Grupo': getRandomElement(GROUPS),
          'Motivo devolucion': null,
          'PDV': getRandomElement(PDVS),
          'Referencia': reference,
        });

        // Add a return ~10-15% of the time with a negative value
        if (Math.random() < 0.12) {
          data.push({
            'Fecha': jsDateToExcelSerial(date),
            'Tipo docto.': TransactionType.Return,
            'Valor subtotal local': -getRandomNumber(40000, 400000),
            'Marca': getRandomElement(BRANDS),
            'Genero': getRandomElement(GENDERS),
            'Grupo': getRandomElement(GROUPS),
            'Motivo devolucion': getRandomElement(RETURN_REASONS),
            'PDV': getRandomElement(PDVS),
            'Referencia': reference,
          });
        }
      }
    }
  });

  return data;
};
