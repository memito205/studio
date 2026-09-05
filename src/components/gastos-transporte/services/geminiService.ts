import { GoogleGenAI, GenerateContentResponse } from "@google/genai";
import { CarrierData, ExpenseRecord } from "../types";

/** Claves posibles en Next/Vite; no inicializa el cliente hasta usarlo. */
function getGeminiApiKey(): string | undefined {
  return (
    process.env.NEXT_PUBLIC_GEMINI_API_KEY ||
    process.env.GEMINI_API_KEY ||
    process.env.NEXT_PUBLIC_API_KEY ||
    process.env.API_KEY
  );
}

function getAiClient(): GoogleGenAI {
  const apiKey = getGeminiApiKey();
  if (!apiKey || apiKey === "PLACEHOLDER_API_KEY") {
    throw new Error("API key not configured.");
  }
  return new GoogleGenAI({ apiKey });
}

interface DataSummary {
    totalSpend: number;
    totalShipments: number;
    carriers: CarrierData[];
    costPerCarrier: { [key: string]: { cost: number; shipments: number } };
    topDestinations: [string, number][];
}

const summarizeData = (carriers: CarrierData[], records: (ExpenseRecord & { carrierName: string })[]): DataSummary => {
    let totalSpend = 0;
    let totalShipments = 0;
    const costPerCarrier: { [key: string]: { cost: number; shipments: number } } = {};
    const costByDestination: { [key: string]: number } = {};

    records.forEach(record => {
        totalSpend += record.costo;
        totalShipments++;
        costByDestination[record.destino] = (costByDestination[record.destino] || 0) + record.costo;

        const carrierData = costPerCarrier[record.carrierName] || { cost: 0, shipments: 0 };
        carrierData.cost += record.costo;
        carrierData.shipments++;
        costPerCarrier[record.carrierName] = carrierData;
    });

    const topDestinations = Object.entries(costByDestination)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 10);

    return { totalSpend, totalShipments, carriers, costPerCarrier, topDestinations };
};


const generatePrompt = (carriers: CarrierData[]): string => {
  let totalSpend = 0;
  let totalShipments = 0;
  const costPerCarrier: { [key: string]: { cost: number; shipments: number } } = {};
  const costByDestination: { [key: string]: number } = {};

  carriers.forEach(carrier => {
    let carrierSpend = 0;
    carrier.data.forEach(record => {
      totalSpend += record.costo;
      carrierSpend += record.costo;
      totalShipments++;
      costByDestination[record.destino] = (costByDestination[record.destino] || 0) + record.costo;
    });
    costPerCarrier[carrier.name] = { cost: carrierSpend, shipments: carrier.data.length };
  });

  const topDestinations = Object.entries(costByDestination)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 10);

  let prompt = `
You are an expert logistics and transportation cost analyst for a company operating in Latin America.
Based on the following summarized transportation expense data (in a local currency, e.g., pesos), provide a concise analysis in Spanish.

Data Summary:
- Gasto Total: ${totalSpend.toFixed(2)}
- Envíos Totales: ${totalShipments}
- Transportadoras Analizadas: ${carriers.map(c => c.name).join(', ')}

Costo por Transportadora:
${Object.entries(costPerCarrier).map(([name, data]) => `- ${name}: ${data.cost.toFixed(2)} (${data.shipments} envíos)`).join('\n')}

Top 10 Destinos por Costo:
${topDestinations.map(([dest, cost]) => `- ${dest}: ${cost.toFixed(2)}`).join('\n')}

Please provide the analysis in three sections with clear headings:
1.  **Observaciones Clave:** What are the most important takeaways? (e.g., which carrier dominates spending, which destinations are most expensive).
2.  **Oportunidades de Ahorro:** Where are the potential areas to reduce costs? (e.g., carrier negotiation, route optimization, consolidating shipments to expensive destinations).
3.  **Anomalías Potenciales:** Are there any data points that look unusual or warrant further investigation? (e.g., unusually high cost for a certain destination, a carrier with a much higher cost-per-shipment).
`;

  return prompt.trim();
};

export const getAIInsights = async (carriers: CarrierData[]): Promise<string> => {
  if (!getGeminiApiKey()) {
    throw new Error("API key not configured.");
  }
  if (carriers.length === 0) {
    return "No hay datos para analizar. Por favor, importe los datos de al menos una transportadora.";
  }

  const prompt = generatePrompt(carriers);

  try {
    const ai = getAiClient();
    const response: GenerateContentResponse = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
    });
    return response.text ?? '';
  } catch (error) {
    console.error("Error calling Gemini API:", error);
    return "Ocurrió un error al generar el análisis de IA. Por favor, inténtelo de nuevo más tarde.";
  }
};


const generateComparativePrompt = (
    currentSummary: DataSummary,
    previousSummary: DataSummary,
    currentYear: string
): string => {
    const previousYear = parseInt(currentYear, 10) - 1;

    const formatSummary = (summary: DataSummary, year: number | string) => `
Data Summary for ${year}:
- Gasto Total: ${summary.totalSpend.toFixed(2)}
- Envíos Totales: ${summary.totalShipments}
- Transportadoras Analizadas: ${summary.carriers.map(c => c.name).join(', ')}
Costo por Transportadora:
${Object.entries(summary.costPerCarrier).map(([name, data]) => `- ${name}: ${data.cost.toFixed(2)} (${data.shipments} envíos)`).join('\n')}
Top 10 Destinos por Costo:
${summary.topDestinations.map(([dest, cost]) => `- ${dest}: ${cost.toFixed(2)}`).join('\n')}
`;

    let prompt = `
You are an expert logistics and transportation cost analyst for a company operating in Latin America.
You are provided with data for two consecutive years: ${currentYear} (current) and ${previousYear} (previous).
Your task is to provide a year-over-year comparative analysis in Spanish.

${formatSummary(currentSummary, currentYear)}

${formatSummary(previousSummary, previousYear)}

Please compare the two periods and provide the analysis in three sections with clear headings:
1.  **Comparativa General:** What are the biggest changes in total spend, shipment volume, and average cost? How has the carrier mix changed year-over-year?
2.  **Oportunidades y Riesgos:** Based on the year-over-year trends, where are the new or growing opportunities for savings? What are the biggest risks or areas where costs are increasing uncontrollably (e.g., a specific carrier or destination)?
3.  **Anomalías Destacadas:** Are there any significant one-off changes (e.g., a destination that became much more expensive, a new carrier taking a large share, a carrier whose cost per shipment changed drastically) that warrant investigation?
`;

    return prompt.trim();
};

export const getAIComparativeInsights = async (
    allCarriers: CarrierData[],
    currentRecords: (ExpenseRecord & { carrierName: string })[],
    previousRecords: (ExpenseRecord & { carrierName: string })[],
    currentYear: string
): Promise<string> => {
    if (!getGeminiApiKey()) {
        throw new Error("API key not configured.");
    }
    if (currentRecords.length === 0 && previousRecords.length === 0) {
        return "No hay datos para analizar. Por favor, asegúrese de tener datos para los años seleccionados.";
    }

    const currentSummary = summarizeData(allCarriers, currentRecords);
    const previousSummary = summarizeData(allCarriers, previousRecords);
    const prompt = generateComparativePrompt(currentSummary, previousSummary, currentYear);

    try {
        const ai = getAiClient();
        const response: GenerateContentResponse = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: prompt,
        });
        return response.text ?? '';
    } catch (error) {
        console.error("Error calling Gemini API for comparison:", error);
        return "Ocurrió un error al generar el análisis comparativo de IA. Por favor, inténtelo de nuevo más tarde.";
    }
};
