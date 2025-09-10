'use server';

/**
 * @fileOverview Provides a root cause analysis for performance issues.
 *
 * - getRootCauseAnalysis - A function that analyzes operator or reference performance.
 * - GetRootCauseAnalysisInput - The input type for the function.
 * - GetRootCauseAnalysisOutput - The return type for the function.
 */

import { ai } from '@/ai/genkit';
import { z } from 'zod';
import type { PackerProductivity, PackerReferenceProductivityDetail } from '@/types';

const GetRootCauseAnalysisInputSchema = z.object({
    context: z.custom<PackerProductivity | PackerReferenceProductivityDetail>(),
    type: z.enum(['operator', 'reference']),
});

export type GetRootCauseAnalysisInput = z.infer<typeof GetRootCauseAnalysisInputSchema>;

const GetRootCauseAnalysisOutputSchema = z.object({
  analysis: z.string().describe("A concise analysis (2-3 sentences) of the possible root cause for the low performance. Be direct."),
});
export type GetRootCauseAnalysisOutput = z.infer<typeof GetRootCauseAnalysisOutputSchema>;


export async function getRootCauseAnalysis(input: GetRootCauseAnalysisInput): Promise<GetRootCauseAnalysisOutput> {
  return getRootCauseAnalysisFlow(input);
}

const getRootCauseAnalysisFlow = ai.defineFlow(
  {
    name: 'getRootCauseAnalysisFlow',
    inputSchema: GetRootCauseAnalysisInputSchema,
    outputSchema: GetRootCauseAnalysisOutputSchema,
  },
  async ({ context, type }) => {
    const prompt = `Eres un analista de operaciones. Analiza el siguiente objeto JSON que representa el rendimiento de un ${type} y proporciona un análisis conciso (2-3 frases) sobre la posible causa raíz de su bajo rendimiento. Ve directo al análisis. Contexto: ${JSON.stringify(context)}`;
    
    const { output } = await ai.generate({
      prompt,
      model: 'googleai/gemini-2.0-flash',
      output: {
        schema: GetRootCauseAnalysisOutputSchema,
      },
    });

    return output ?? { analysis: "No se pudo obtener un análisis." };
  }
);
