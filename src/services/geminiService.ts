/**
 * SERVICIO CENTRALIZADO DE CLIENTE GEMINI AI (SDK @google/genai)
 *
 * Mantiene la instancia lazy del cliente de IA para backend sin exponer claves al cliente.
 */

import { GoogleGenAI } from '@google/genai';

let geminiClient: GoogleGenAI | null = null;

export function getGeminiClient(): GoogleGenAI | null {
  if (!geminiClient && process.env.GEMINI_API_KEY) {
    geminiClient = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  }
  return geminiClient;
}

export function resetGeminiClient(): void {
  geminiClient = null;
}
