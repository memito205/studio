'use server';

/**
 * @fileOverview Generates an executive summary from report data.
 *
 * - getExecutiveSummary - A function that generates a 3-point executive summary.
 * - GetExecutiveSummaryInput - The input type for the getExecutiveSummary function.
 * - GetExecutiveSummaryOutput - The return type for the getExecutiveSummary function.
 */

import { ai } from '@/ai/genkit';
import { z } from 'zod';
import type { ProcessedReportData } from '@/types';

// Helper to simplify and truncate data for the prompt
const sanitizeAndTruncate = (data: any, maxLength: number = 3800): string => {
    const dataCopy = JSON.parse(JSON.stringify(data));
    if (Array.isArray(dataCopy)) {
        dataCopy.forEach(report => {
            delete report.packerBrandProductivityDetail;
            delete report.packerReferenceProductivityDetail;
        });
    } else {
        delete dataCopy.packerBrandProductivityDetail;
        delete dataCopy.packerReferenceProductivityDetail;
        delete dataCopy.packerHourlyPerformance;
        delete dataCopy.deadTimeReport;
        delete dataCopy.microPausesReport;
        delete dataCopy.breakDetailReport;
        if (dataCopy.brandProductivity) {
            dataCopy.brandProductivity.forEach((brand: any) => delete brand.breakdown);
        }
        if (dataCopy.packerProductivity) {
            dataCopy.packerProductivity = dataCopy.packerProductivity.map((p: any) => ({
                packerName: p.packerName, totalQuantity: p.totalQuantity, productivity: p.productivity,
                compliance: p.compliance, hoursWorked: p.hoursWorked, baseGoal: p.baseGoal
            }));
        }
    }
    const jsonString = JSON.stringify(dataCopy);
    return jsonString.length > maxLength ? jsonString.substring(0, maxLength) + '...}]}' : jsonString;
};

const GetExecutiveSummaryInputSchema = z.custom<ProcessedReportData>();
export type GetExecutiveSummaryInput = z.infer<typeof GetExecutiveSummaryInputSchema>;

const GetExecutiveSummaryOutputSchema = z.object({
  summary: z.array(z.string()).describe("A concise 3-point executive summary based on the data. Do not include a preamble."),
});
export type GetExecutiveSummaryOutput = z.infer<typeof GetExecutiveSummaryOutputSchema>;


export async function getExecutiveSummary(input: GetExecutiveSummaryInput): Promise<GetExecutiveSummaryOutput> {
  return getExecutiveSummaryFlow(input);
}

const getExecutiveSummaryFlow = ai.defineFlow(
  {
    name: 'getExecutiveSummaryFlow',
    inputSchema: GetExecutiveSummaryInputSchema,
    outputSchema: GetExecutiveSummaryOutputSchema,
  },
  async (reportData) => {
    const prompt = `Basado en los siguientes datos de un reporte de productividad de empaque en formato JSON, genera un resumen ejecutivo de 3 puntos clave. Sé conciso y basado en datos. No incluyas un preámbulo. Datos: ${sanitizeAndTruncate(reportData)}`;
    
    const { output } = await ai.generate({
      prompt: prompt,
      model: 'googleai/gemini-2.0-flash',
      output: {
        schema: GetExecutiveSummaryOutputSchema,
      },
    });

    return output ?? { summary: ["No se pudo generar un resumen."] };
  }
);
