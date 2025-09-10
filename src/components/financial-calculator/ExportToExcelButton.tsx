"use client";

import React from "react";
import type { CreditCalculationResult } from "@/types";
import { Button } from "@/components/ui/button";

const ExportToExcelButton: React.FC<{ results: CreditCalculationResult[] }> = ({ results }) => {
  return (
    <Button disabled={results.length === 0}>
      Exportar a Excel
    </Button>
  );
};

export default ExportToExcelButton;
