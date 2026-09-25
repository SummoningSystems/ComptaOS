export interface CellFormat {
  bold?: boolean;
  italic?: boolean;
  bgColor?: string;
  numberFormat?: "default" | "euro" | "percent";
  align?: "left" | "center" | "right";
}

export interface SpreadsheetCell {
  value: string | number | null;
  format?: CellFormat;
}

export interface SpreadsheetSheet {
  id: string;
  name: string;
  cols: number;
  rows: number;
  cells: Record<string, SpreadsheetCell>;
}

export interface SpreadsheetDoc {
  revision?:number;
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  sheets: SpreadsheetSheet[];
}
