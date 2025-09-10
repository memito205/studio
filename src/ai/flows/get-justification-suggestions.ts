'use server';

/**
 * @fileOverview Suggests justifications for dead time incidents based on their time and duration.
 *
 * - getJustificationSuggestions - Analyzes dead time incidents and suggests justifications.
 * - GetJustificationSuggestionsInput - Input type for the function.
 * - GetJustificationSuggestionsOutput - Return type for the function.
 */

import { ai } from '@/ai/genkit';
import { z } from 'zod';
import type { DeadTimeEntry } from '@/types';

// Define JustificationType as a Zod enum for validation
const JustificationTypeEnum = z.enum(['BREAKFAST', 'LUNCH', 'SNACK', 'REASON']);

const DeadTimeEntrySchema = z.object({
    id: z.string(),
    packerName: z.string(),
    startTime: z.date(),
    endTime: z.date(),
    duration: z.number().describe("Duration in minutes"),
    status: z.string(),
    justification: z.string().optional(),
});

const GetJustificationSuggestionsInputSchema = z.object({
  incidents: z.array(z.custom<DeadTimeEntry>()),
});
export type GetJustificationSuggestionsInput = z.infer<typeof GetJustificationSuggestionsInputSchema>;

const GetJustificationSuggestionsOutputSchema = z.object({
  suggestions: z.record(z.string(), JustificationTypeEnum.optional()).describe("A dictionary mapping incident ID to a suggested JustificationType."),
});
export type GetJustificationSuggestionsOutput = z.infer<typeof GetJustificationSuggestionsOutputSchema>;


export async function getJustificationSuggestions(input: GetJustificationSuggestionsInput): Promise<GetJustificationSuggestionsOutput> {
  return getJustificationSuggestionsFlow(input);
}

const prompt = ai.definePrompt({
  name: 'getJustificationSuggestionsPrompt',
  input: { schema: GetJustificationSuggestionsInputSchema },
  output: { schema: GetJustificationSuggestionsOutputSchema },
  prompt: `You are an expert operations analyst. Your task is to analyze a list of employee dead time incidents and suggest a likely justification based on common work schedules.

    Analyze the following list of dead time incidents. For each incident, suggest a justification from the following categories: BREAKFAST, LUNCH, SNACK.

    - BREAKFAST: Typically occurs between 8:00 AM and 10:00 AM and lasts 15-30 minutes.
    - LUNCH: Typically occurs between 12:00 PM (midday) and 2:00 PM and lasts 30-60 minutes.
    - SNACK: Typically occurs between 3:00 PM and 5:00 PM and lasts 15-20 minutes.

    Carefully consider the start time and duration of each incident to make the most logical suggestion. If an incident does not fit any of these patterns, do not provide a suggestion for it.

    Return the result as a dictionary where the key is the incident ID and the value is the suggested justification type.

    Incidents to analyze:
    {{#each incidents}}
    - ID: {{id}}, Packer: {{packerName}}, Start: {{startTime}}, Duration: {{duration}} minutes
    {{/each}}
    `,
});


const getJustificationSuggestionsFlow = ai.defineFlow(
  {
    name: 'getJustificationSuggestionsFlow',
    inputSchema: GetJustificationSuggestionsInputSchema,
    outputSchema: GetJustificationSuggestionsOutputSchema,
  },
  async ({ incidents }) => {
    // To pass dates to the prompt, we need to format them as strings.
    const incidentsWithFormattedDates = incidents.map(i => ({
        ...i,
        startTime: i.startTime.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true }),
        endTime: i.endTime.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true }),
    }));
    
    const { output } = await prompt({ incidents: incidentsWithFormattedDates as any });
    
    return output ?? { suggestions: {} };
  }
);
