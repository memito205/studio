'use server';

/**
 * @fileOverview A code conversion AI agent.
 *
 * - codeConversion - A function that handles the code conversion process.
 * - CodeConversionInput - The input type for the codeConversion function.
 * - CodeConversionOutput - The return type for the codeConversion function.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';

const CodeConversionInputSchema = z.object({
  code: z.string().describe('The code to be converted.'),
  sourceLanguage: z.string().describe('The programming language of the code to be converted.'),
  targetLanguage: z.string().describe('The programming language to convert the code to.'),
});
export type CodeConversionInput = z.infer<typeof CodeConversionInputSchema>;

const CodeConversionOutputSchema = z.object({
  convertedCode: z.string().describe('The converted code in the target language.'),
});
export type CodeConversionOutput = z.infer<typeof CodeConversionOutputSchema>;

export async function codeConversion(input: CodeConversionInput): Promise<CodeConversionOutput> {
  return codeConversionFlow(input);
}

const prompt = ai.definePrompt({
  name: 'codeConversionPrompt',
  input: {schema: CodeConversionInputSchema},
  output: {schema: CodeConversionOutputSchema},
  prompt: `You are a code conversion expert. You will convert code from one language to another.

    Source Language: {{{sourceLanguage}}}
    Target Language: {{{targetLanguage}}}

    Code to convert:
    {{code}}
    `,
});

const codeConversionFlow = ai.defineFlow(
  {
    name: 'codeConversionFlow',
    inputSchema: CodeConversionInputSchema,
    outputSchema: CodeConversionOutputSchema,
  },
  async input => {
    const {output} = await prompt(input);
    return output!;
  }
);
