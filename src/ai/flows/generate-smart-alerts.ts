
'use server';

/**
 * @fileOverview Generates smart alerts based on productivity report data.
 *
 * - generateSmartAlerts - A function that generates a list of smart alerts.
 * - GenerateSmartAlertsInput - The input type for the function.
 * - GenerateSmartAlertsOutput - The return type for the function.
 */

import { ai } from '@/ai/genkit';
import { z } from 'zod';
import type { ProcessedReportData } from '@/types';

const SmartAlertSchema = z.object({
    id: z.string(),
    severity: z.enum(['info', 'warning', 'critical']),
    text: z.string(),
});

const GenerateSmartAlertsInputSchema = z.custom<ProcessedReportData>();
export type GenerateSmartAlertsInput = z.infer<typeof GenerateSmartAlertsInputSchema>;

const GenerateSmartAlertsOutputSchema = z.object({
  alerts: z.array(SmartAlertSchema).describe("A list of smart alerts based on the report data. Only generate alerts for significant findings."),
});
export type GenerateSmartAlertsOutput = z.infer<typeof GenerateSmartAlertsOutputSchema>;


export async function generateSmartAlerts(input: GenerateSmartAlertsInput): Promise<GenerateSmartAlertsOutput> {
  return generateSmartAlertsFlow(input);
}

const generateSmartAlertsFlow = ai.defineFlow(
  {
    name: 'generateSmartAlertsFlow',
    inputSchema: GenerateSmartAlertsInputSchema,
    outputSchema: GenerateSmartAlertsOutputSchema,
  },
  async (reportData) => {
    // Sanitize and truncate data to fit within token limits, focusing on key metrics
    const simplifiedData = {
        overallCompliance: reportData.overallCompliance,
        packerProductivity: reportData.packerProductivity.map(p => ({
            packerName: p.packerName,
            compliance: p.compliance,
            productivity: p.productivity,
            hoursWorked: p.hoursWorked
        })),
        brandProductivity: reportData.brandProductivity.map(b => ({
            brandName: b.brandName,
            compliance: b.compliance
        })),
        deadTimeSummary: reportData.deadTimeSummary.map(d => ({
            packerName: d.packerName,
            totalMinutes: d.totalMinutes,
            percentageOfWorkday: d.percentageOfWorkday
        }))
    };
    
    const prompt = `Based on the following productivity data, generate a few smart alerts for the most critical findings. Severity can be 'info', 'warning', or 'critical'. Generate a unique ID for each alert. Data: ${JSON.stringify(simplifiedData)}`;
    
    const { output } = await ai.generate({
      prompt: prompt,
      model: 'googleai/gemini-2.0-flash',
      output: {
        schema: GenerateSmartAlertsOutputSchema,
      },
    });

    return output ?? { alerts: [] };
  }
);
