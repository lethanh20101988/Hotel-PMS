import { GoogleGenAI, Type } from "@google/genai";
import { Order, Vehicle, Trip } from "../types";

// In a real app, do not fallback to a placeholder if the key is missing. 
// However, to prevent crashes in this demo environment if the user forgets the key, we handle gracefully.
const apiKey = process.env.API_KEY || '';
const ai = new GoogleGenAI({ apiKey });

export interface DispatchSuggestion {
  vehicleId: string;
  orderIds: string[];
  reasoning: string;
}

export const getSmartDispatchSuggestion = async (
  pendingOrders: Order[],
  availableVehicles: Vehicle[]
): Promise<DispatchSuggestion[]> => {
  if (!apiKey) {
    console.warn("No API Key provided for Gemini.");
    return [];
  }

  const model = "gemini-2.5-flash";

  // Prepare context data
  const ordersData = pendingOrders.map(o => ({
    id: o.id,
    distributor: o.distributorName,
    weightKg: o.totalWeight,
    note: o.note
  }));

  const vehiclesData = availableVehicles.map(v => ({
    id: v.id,
    plate: v.plateNumber,
    capacityKg: v.capacityKg,
    preferredRoute: v.preferredRoute
  }));

  const prompt = `
    You are a logistics coordinator. 
    I have the following Pending Orders: ${JSON.stringify(ordersData)}.
    I have the following Available Vehicles: ${JSON.stringify(vehiclesData)}.
    
    Please suggest how to group these orders into trips using the available vehicles.
    Rules:
    1. Do not exceed vehicle capacity.
    2. Try to group orders that might be on similar routes (infer from distributor names/notes if possible, otherwise just balance the load).
    3. Return a JSON array of suggestions.
  `;

  try {
    const response = await ai.models.generateContent({
      model: model,
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              vehicleId: { type: Type.STRING },
              orderIds: { 
                type: Type.ARRAY,
                items: { type: Type.STRING }
              },
              reasoning: { type: Type.STRING }
            }
          }
        }
      }
    });

    const text = response.text;
    if (!text) return [];
    
    return JSON.parse(text) as DispatchSuggestion[];
  } catch (error) {
    console.error("Error fetching Gemini suggestion:", error);
    return [];
  }
};
