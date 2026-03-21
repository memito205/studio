"use server";
import { GoogleGenAI } from "@google/genai";
import type { Allocation } from "../types";

const API_KEY = process.env.GEMINI_API_KEY || process.env.NEXT_PUBLIC_GEMINI_API_KEY;

export const getDistributionSummary = async (allocationData: Allocation): Promise<string> => {
  if (!API_KEY) {
    console.warn("API_KEY de Google Gemini no encontrada en las variables de entorno.");
    return "La clave API de Gemini no está configurada. No se puede generar el resumen.";
  }

  const ai = new GoogleGenAI({ apiKey: API_KEY });

  const prompt = `
Eres un experto en logística y gestión de inventarios. Basándote en los siguientes datos en formato JSON, que representan un plan de distribución de mercancías finalizado, genera un resumen conciso y profesional en español.

El resumen debe incluir:
1. Un título claro como "Resumen de Distribución".
2. El número total de unidades distribuidas.
3. El número total de tiendas (bodegas) que recibieron mercancía.
4. Un análisis de cumplimiento: menciona si todas las tiendas recibieron la cantidad total solicitada. Si hay tiendas con faltantes (shortfalls), identifícalas y especifica la cantidad solicitada frente a la recibida para las referencias afectadas. Usa listas para que sea fácil de leer.
5. Finaliza con una breve conclusión sobre el resultado del reparto.

El formato de los datos es: \`{ "nombreDeLaBodega": { "referencia": { "items": [{"talla": "T", "quantity": Q}], "requested": R, "allocated": A } } }\`.

Aquí están los datos:
\`\`\`json
${JSON.stringify(allocationData, null, 2)}
\`\`\`
`;

  try {
    const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt,
    });
    return response.text || "No se pudo generar un resumen adecuado para esta distribución.";
  } catch (error) {
    console.error("Error al contactar la API de Gemini:", error);
    return "Ocurrió un error al generar el resumen con IA. Por favor, revise la consola para más detalles.";
  }
};
