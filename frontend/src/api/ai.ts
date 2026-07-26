import { ChatMessage } from "../types";
import { api } from "./client";

export async function aiCategorize(
  label: string,
  amount: number
): Promise<{ category: string; vat_rate: number; reasoning: string; confidence: string }> {
  const { data } = await api.post("/ai/categorize", { label, amount });
  return data;
}

export async function aiChat(messages: ChatMessage[]): Promise<string> {
  const { data } = await api.post<{ answer: string }>("/ai/chat", { messages });
  return data.answer;
}
