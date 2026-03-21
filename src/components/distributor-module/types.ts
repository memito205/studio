
export interface StockItem {
  REFERENCIA: string;
  NOMBRE: string;
  TALLA: string;
  'CANTD LEIDA': number;
}

export interface DistributionRule {
  REFERENCIA: string;
  BODEGA: string;
  CANT: number;
}

export interface BoxCurveRule {
  REFERENCIA: string;
  TALLA: string;
  CANTIDAD_CURVA: number;
}

export interface AllocatedItem {
  talla: string;
  quantity: number;
}

export interface AllocationDetail {
  items: AllocatedItem[];
  requested: number;
  allocated: number;
}

export interface Allocation {
  [bodega: string]: {
    [referencia: string]: AllocationDetail;
  };
}