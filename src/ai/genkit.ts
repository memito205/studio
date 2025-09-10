
// AI features have been disabled to enable deployment on the Firebase Spark plan.
// The Spark plan does not allow for billable features like Cloud Functions, which Genkit uses.
// To re-enable AI features, you must upgrade to the Blaze plan and restore the Genkit packages.

// We export a dummy object to prevent build errors in other files that import 'ai'.
// This version includes placeholder functions to avoid runtime 'undefined' errors.
export const ai = {
  defineFlow: () => () => Promise.resolve(null),
  definePrompt: () => () => Promise.resolve({ output: null }),
  generate: () => Promise.resolve({ output: null }),
  embed: () => Promise.resolve({}),
  defineTool: () => () => Promise.resolve({}),
  defineSchema: (name: string, schema: any) => schema,
} as any;
