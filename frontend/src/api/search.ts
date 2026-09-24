import { api } from "./client";

export interface SearchResult {
  type: "transaction" | "file";
  score: number;
  transaction?: {
    id: string;
    date: string;
    label: string;
    amount_ttc: number;
    category: string;
  };
  filePath?: string;
  fileName?: string;
  extension?: string;
  excerpt?: string;
}

export async function searchWorkspace(query: string, client = api): Promise<SearchResult[]> {
  if (!query.trim()) return [];
  const { data } = await client.get<SearchResult[]>("/search", { params: { q: query } });
  return data;
}

export async function fetchAllTags(client = api): Promise<string[]> {
  const { data } = await client.get<string[]>("/search/tags");
  return data;
}
