import type { ReactNode } from "react";
import { TabBar } from "./TabBar";

/** Shared work area for accounting and ecosystem views. */
export function WorkspaceLayout({ sidebar, children }: { sidebar: ReactNode; children: ReactNode }) {
  return <div className="flex flex-1 min-h-0">
    {sidebar}
    <div className="flex flex-col flex-1 min-w-0"><TabBar />{children}</div>
  </div>;
}

