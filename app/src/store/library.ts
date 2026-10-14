import { create } from "zustand";
import { errText } from "@/lib/errors";
import { tauri } from "@/lib/tauri";
import type { LibraryCategory, LibraryFile } from "@/types";

interface LibraryState {
  categories: LibraryCategory[];
  currentId: string | null;
  files: LibraryFile[];
  /** 选中分类的目录绝对路径，界面上显示、也用来「打开文件夹」 */
  currentDir: string | null;
  loading: boolean;
  filesLoading: boolean;
  error?: string;

  refresh: () => Promise<void>;
  select: (id: string | null) => Promise<void>;
  createCategory: (input: { name: string; agentId?: string; description?: string }) => Promise<LibraryCategory>;
  updateCategory: (id: string, input: { name: string; agentId?: string; description?: string }) => Promise<void>;
  setAgent: (id: string, agentId: string) => Promise<void>;
  deleteCategory: (id: string) => Promise<void>;
  refreshFiles: (id?: string | null) => Promise<void>;
  importFiles: (sources: string[]) => Promise<void>;
  deleteFile: (name: string) => Promise<void>;
}

/** 分类上的 fileCount 要跟着文件增删走，所以本地也维护一份 */
function withCount(categories: LibraryCategory[], id: string, count: number): LibraryCategory[] {
  return categories.map((c) => (c.id === id ? { ...c, fileCount: count } : c));
}

export const useLibrary = create<LibraryState>((set, get) => ({
  categories: [],
  currentId: null,
  files: [],
  currentDir: null,
  loading: false,
  filesLoading: false,

  async refresh() {
    set({ loading: true });
    try {
      const categories = await tauri.listLibraryCategories();
      // 之前选中的分类没了（被删）就退回第一个，避免右边空着没头绪
      const current = get().currentId;
      const stillThere = current && categories.some((c) => c.id === current);
      const nextId = stillThere ? current : categories[0]?.id ?? null;
      set({ categories, currentId: nextId, error: undefined, loading: false });
      if (nextId) await get().refreshFiles(nextId);
    } catch (e) {
      set({ error: errText(e), loading: false });
    }
  },

  async select(id) {
    set({ currentId: id });
    await get().refreshFiles(id);
  },

  async createCategory(input) {
    const category = await tauri.createLibraryCategory(input);
    set((s) => ({ categories: [...s.categories, category], currentId: category.id, files: [] }));
    await get().refreshFiles(category.id);
    return category;
  },

  async updateCategory(id, input) {
    const updated = await tauri.updateLibraryCategory(id, input);
    set((s) => ({ categories: s.categories.map((c) => (c.id === id ? { ...c, ...updated } : c)) }));
    await get().refreshFiles(id);
  },

  async setAgent(id, agentId) {
    const updated = await tauri.setLibraryCategoryAgent(id, agentId);
    set((s) => ({ categories: s.categories.map((c) => (c.id === id ? { ...c, ...updated } : c)) }));
  },

  async deleteCategory(id) {
    await tauri.deleteLibraryCategory(id);
    const rest = get().categories.filter((c) => c.id !== id);
    const nextId = get().currentId === id ? rest[0]?.id ?? null : get().currentId;
    set({ categories: rest, currentId: nextId, files: [] });
    if (nextId) await get().refreshFiles(nextId);
  },

  async refreshFiles(id) {
    const target = id ?? get().currentId;
    if (!target) {
      set({ files: [], currentDir: null });
      return;
    }
    set({ filesLoading: true });
    try {
      const [files, dir] = await Promise.all([tauri.listLibraryFiles(target), tauri.libraryCategoryPath(target)]);
      // 期间用户可能又切走了，只写还在选中的那一份
      if (get().currentId !== target) return;
      set({ files, currentDir: dir, error: undefined });
    } catch (e) {
      set({ error: errText(e) });
    } finally {
      set({ filesLoading: false });
    }
  },

  async importFiles(sources) {
    const id = get().currentId;
    if (!id || sources.length === 0) return;
    const files = await tauri.importLibraryFiles(id, sources);
    set((s) => ({ files, categories: withCount(s.categories, id, files.length) }));
  },

  async deleteFile(name) {
    const id = get().currentId;
    if (!id) return;
    const files = await tauri.deleteLibraryFile(id, name);
    set((s) => ({ files, categories: withCount(s.categories, id, files.length) }));
  },
}));

/** 当前选中的分类对象 */
export const currentCategory = (state: LibraryState): LibraryCategory | null =>
  state.categories.find((c) => c.id === state.currentId) ?? null;