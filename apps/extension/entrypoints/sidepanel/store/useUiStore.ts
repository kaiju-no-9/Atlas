import { create } from "zustand";
import type { ActiveTabSummary, UiTask } from "@atlas/contracts";

type View = "chat" | "settings";
type UiState = {
  view: View;
  activeTab: ActiveTabSummary | null;
  task: UiTask | null;
  loading: boolean;
  error: string | null;
  setView: (view: View) => void;
  setActiveTab: (tab: ActiveTabSummary | null) => void;
  setTask: (task: UiTask | null) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
};

export const useUiStore = create<UiState>((set) => ({
  view: "chat",
  activeTab: null,
  task: null,
  loading: false,
  error: null,
  setView: (view) => set({ view }),
  setActiveTab: (activeTab) => set({ activeTab }),
  setTask: (task) => set({ task }),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error }),
}));
