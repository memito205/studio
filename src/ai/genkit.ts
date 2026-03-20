
import { googleAI } from '@genkit-ai/google-genai';
import { genkit, type Plugin } from 'genkit';
import { firebase } from '@genkit-ai/firebase';

// AI features are disabled for Spark plan compatibility.
// To re-enable, you must upgrade to the Blaze plan and uncomment the firebase import.
const firebasePlugin = firebase(); 

const plugins: Plugin<any>[] = [
    googleAI({
      apiVersion: ['v1', 'v1beta'],
    }),
];

if (firebasePlugin) {
    plugins.push(firebasePlugin);
}

export const ai = genkit({
    plugins,
    logLevel: 'debug',
    enableTracing: true,
});
