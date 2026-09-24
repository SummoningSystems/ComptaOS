import type { SpreadsheetDoc } from "../components/Spreadsheet/spreadsheetTypes";

/** Bind every request, including delayed saves, to the tab's original scope. */
export function createSpreadsheetApi(base: string) {
  async function request<T>(suffix = "", method = "GET", body?: unknown): Promise<T> {
    const response = await fetch(base + suffix, {
      method, credentials: "same-origin",
      headers: body === undefined ? undefined : {"Content-Type": "application/json"},
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? "Le tableur n’a pas pu être enregistré ou chargé.");
    return data as T;
  }
  const revisions=new Map<string,number>(),queues=new Map<string,Promise<SpreadsheetDoc>>();
  const remember=(doc:SpreadsheetDoc)=>{revisions.set(doc.id,doc.revision??0);return doc;};
  return {
    fetchSpreadsheets: () => request<Omit<SpreadsheetDoc, "sheets">[]>(),
    fetchSpreadsheet: (id: string) => request<SpreadsheetDoc>("/" + encodeURIComponent(id)).then(remember),
    createSpreadsheet: (name: string) => request<SpreadsheetDoc>("", "POST", {name}).then(remember),
    saveSpreadsheet: (doc: SpreadsheetDoc) => {
      const save=(queues.get(doc.id)??Promise.resolve()).catch(()=>undefined).then(()=>request<SpreadsheetDoc>("/"+encodeURIComponent(doc.id),"PUT",{...doc,revision:revisions.get(doc.id)??doc.revision})).then(remember);
      queues.set(doc.id,save);return save;
    },
    deleteSpreadsheetApi: (id: string) => request<void>("/" + encodeURIComponent(id), "DELETE"),
    fetchAccountingVariables: () => request<Record<string, number>>("/variables"),
  };
}
