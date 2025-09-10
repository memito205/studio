
import { config } from 'dotenv';
config();

// AI flows are not imported to prevent Genkit initialization on the Spark plan.
// To re-enable AI features, you must upgrade to the Blaze plan and uncomment the imports.
