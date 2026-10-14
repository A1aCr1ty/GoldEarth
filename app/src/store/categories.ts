import { create } from "zustand";
import { tauri } from "@/lib/tauri";
import type { Category } from "@/types";
interface CategoriesState {
  items: Category[];
  loading: boolean;
  error?: string;
  refresh: () => Promise<void>;
  create: (input: { name: string; icon?: string; description?: string }) => Promise<Category>;
  update: (id: string, input: { name?: string; icon?: string; description?: string }) => Promise<Category>;
  remove: (id: string) => Promise<void>;
}
export const useCategories = create<CategoriesState>((set) => ({
  items: [],
  loading: false,
  async refresh() {
    set({ loading: true, error: undefined });
    try {
      const items = await tauri.listCategories();
      set({ items, loading: false });
    } catch (e) {
      set({ error: String(e), loading: false });
    }
  },
  async create(input) {
    const cat = await tauri.createCategory(input);
    set((s) => ({ items: [...s.items, cat] }));
    return cat;
  },
  async update(id, input) {
    const cat = await tauri.updateCategory(id, input);
    set((s) => ({ items: s.items.map((c) => (c.id === id ? cat : c)) }));
    return cat;
  },
  async remove(id) {
    await tauri.deleteCategory(id);
    set((s) => ({ items: s.items.filter((c) => c.id !== id) }));
  },
}));
