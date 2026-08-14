import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { loadAiConfig, AiConfig } from "./settingsService.js";
import { Category, Transaction } from "../types/index.js";
import { loadCategoryCatalog } from "./categoryCatalogService.js";

// ── Résolution de la config active ───────────────────────────────────────────

function requireConfig(): AiConfig {
  const config = loadAiConfig();
  if (!config || !config.apiKey) {
    throw new Error("Aucun fournisseur d'IA configuré. Rendez-vous dans Paramètres → Intelligence Artificielle.");
  }
  return config;
}

function getBaseUrl(config: AiConfig): string | undefined {
  if (config.baseUrl) return config.baseUrl;
  if (config.provider === "github-models") return "https://models.inference.ai.azure.com";
  if (config.provider === "ollama") return "http://localhost:11434/v1";
  return undefined;
}

// ── Appel IA unifié ───────────────────────────────────────────────────────────

export async function callAi(systemPrompt: string, userPrompt: string, maxTokens = 512): Promise<string> {
  const config = requireConfig();
  if (config.provider === "anthropic") {
    const client = new Anthropic({ apiKey: config.apiKey });
    const message = await client.messages.create({
      model: config.model,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    });
    return message.content.filter((b) => b.type === "text").map((b) => (b as { type: "text"; text: string }).text).join("");
  }
  const client = new OpenAI({ apiKey: config.apiKey, baseURL: getBaseUrl(config) });
  const res = await client.chat.completions.create({
    model: config.model,
    max_tokens: maxTokens,
    messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }],
  });
  return res.choices[0]?.message?.content ?? "";
}

async function callAiChat(systemPrompt: string, messages: ChatMessage[], maxTokens = 1024): Promise<string> {
  const config = requireConfig();
  if (config.provider === "anthropic") {
    const client = new Anthropic({ apiKey: config.apiKey });
    const res = await client.messages.create({
      model: config.model,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
    });
    return res.content.filter((b) => b.type === "text").map((b) => (b as { type: "text"; text: string }).text).join("");
  }
  const client = new OpenAI({ apiKey: config.apiKey, baseURL: getBaseUrl(config) });
  const res = await client.chat.completions.create({
    model: config.model,
    max_tokens: maxTokens,
    messages: [
      { role: "system", content: systemPrompt },
      ...messages.map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
    ],
  });
  return res.choices[0]?.message?.content ?? "";
}


export interface CategorizationResult {
  category: Category;
  vat_rate: number;
  reasoning: string;
  confidence: "high" | "medium" | "low";
}

const categories = () => loadCategoryCatalog().filter((category) => category.active);

export async function categorizeTransaction(
  label: string,
  amount: number,
  recentHistory: Pick<Transaction, "label" | "category">[] = []
): Promise<CategorizationResult> {
  const historyText = recentHistory.length > 0
    ? `\nHistorique récent :\n${recentHistory.slice(0, 10).map((t) => `- "${t.label}" → ${t.category}`).join("\n")}`
    : "";

  const system = "Tu es un expert-comptable français. Réponds UNIQUEMENT avec un JSON valide, sans markdown ni commentaire.";
  const prompt = `Analyse cette transaction bancaire.
Transaction : libellé="${label}", montant=${amount} EUR${historyText}
Catégories : ${categories().map((category) => `${category.id} (${category.label})`).join(", ")}
JSON : {"category":"...","vat_rate":0,"reasoning":"...","confidence":"high|medium|low"}`;

  const text = await callAi(system, prompt, 256);
  try {
    const match = text.match(/\{[\s\S]*\}/);
    const result = JSON.parse(match?.[0] ?? text) as CategorizationResult;
    if (!categories().some((category) => category.id === result.category)) result.category = "misc";
    if (![0, 5.5, 10, 20].includes(result.vat_rate)) result.vat_rate = 20;
    return result;
  } catch {
    return { category: "misc", vat_rate: 20, reasoning: "Impossible de parser la réponse IA", confidence: "low" };
  }
}

// ── Chat copilote ─────────────────────────────────────────────────────────────

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface CopilotContext {
  transactions: Pick<Transaction, "date" | "label" | "amount_ttc" | "category">[];
  treasury: number;
  vat_estimate: number;
}

export async function chatWithCopilot(messages: ChatMessage[], context: CopilotContext): Promise<string> {
  const txnSummary = context.transactions.length > 0
    ? context.transactions.slice(0, 40).map((t) => `${t.date} | ${t.label} | ${t.amount_ttc > 0 ? "+" : ""}${t.amount_ttc}€ | ${t.category}`).join("\n")
    : "Aucune transaction disponible.";

  const systemPrompt = `Tu es ComptaOS Copilote, un assistant comptable et financier intelligent.
Contexte : trésorerie=${context.treasury.toFixed(2)}€, TVA à reverser=${context.vat_estimate.toFixed(2)}€
Transactions récentes :\n${txnSummary}
Règles : réponds en français, sois concis, base-toi sur les données réelles, rappelle que tes estimations ne remplacent pas un expert-comptable.`;

  return callAiChat(systemPrompt, messages, 1024);
}
