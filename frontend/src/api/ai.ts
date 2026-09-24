import { ChatMessage } from "../types";
import { api } from "./client";

export async function aiCategorize(
  label: string,
  amount: number,
  client = api
): Promise<{ category: string; vat_rate: number; reasoning: string; confidence: string }> {
  const { data } = await client.post("/ai/categorize", { label, amount });
  return data;
}

export async function aiChat(messages: ChatMessage[], client = api): Promise<string> {
  const { data } = await client.post<{ answer: string }>("/ai/chat", { messages });
  return data.answer;
}
