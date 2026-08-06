import { create } from "zustand";
import { Tab, FileNode } from "../types";

interface AppState {
  // Tabs
  tabs: Tab[];
  activeTabId: string | null;
  openTab: (tab: Tab) => void;
  closeTab: (id: string) => void;
  closeTabs: (ids: string[]) => void;
  setActiveTab: (id: string) => void;
  markDirty: (id: string, dirty: boolean) => void;
  reorderTabs: (fromId: string, toId: string) => void;

  // File tree
  fileTree: FileNode[];
  setFileTree: (tree: FileNode[]) => void;

  // Sidebar
  sidebarWidth: number;
  setSidebarWidth: (w: number) => void;
}

export const useAppStore = create<AppState>((set, get) => ({
  tabs: [{ id: "dashboard", title: "Dashboard", type: "dashboard" }],
  activeTabId: "dashboard",

  openTab: (tab) => {
    const tabs = get().tabs;
    const existing = tabs.find((t) => t.id === tab.id);
    if (existing) {
      set({ activeTabId: tab.id });
      return;
    }
    if (tab.type === "editor") {
      set({ tabs: [...tabs, tab], activeTabId: tab.id });
      return;
    }
    const navigationIndex = tabs.findIndex((item) => item.type !== "editor");
    const next = tabs.filter((item) => item.type === "editor");
    next.splice(navigationIndex < 0 ? 0 : Math.min(navigationIndex, next.length), 0, tab);
    set({ tabs: next, activeTabId: tab.id });
  },

  closeTab: (id) => {
    get().closeTabs([id]);
  },

  closeTabs: (ids) => {
    const closed = new Set(ids);
    const previous = get().tabs;
    const tabs = previous.filter((t) => !closed.has(t.id));
    let activeTabId = get().activeTabId;
    if (activeTabId && closed.has(activeTabId)) {
      const previousIndex = previous.findIndex((tab) => tab.id === activeTabId);
      activeTabId = tabs[Math.min(previousIndex, tabs.length - 1)]?.id ?? tabs[tabs.length - 1]?.id ?? null;
    }
    set({ tabs, activeTabId });
  },

  setActiveTab: (id) => set({ activeTabId: id }),

  reorderTabs: (fromId, toId) => {
    const tabs = get().tabs;
    const from = tabs.findIndex((t) => t.id === fromId);
    const to = tabs.findIndex((t) => t.id === toId);
    if (from === -1 || to === -1 || from === to) return;
    const next = [...tabs];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    set({ tabs: next });
  },

  markDirty: (id, dirty) => {
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === id ? { ...t, dirty } : t)),
    }));
  },

  fileTree: [],
  setFileTree: (fileTree) => set({ fileTree }),

  sidebarWidth: 240,
  setSidebarWidth: (sidebarWidth) => set({ sidebarWidth }),
}));
