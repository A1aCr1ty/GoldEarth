import { create } from "zustand";
import { tauri } from "@/lib/tauri";
import type { Note, NoteFormat } from "@/types";
interface NotesState {
  items: Note[];
  currentId: string | null;
  loading: boolean;
  error?: string;
  refresh: (categoryId?: string | null) => Promise<void>;
  select: (id: string | null) => void;
  create: (input: { categoryId: string | null; title: string; format: NoteFormat; content: string; tags: string[] }) => Promise<Note>;
  update: (id: string, input: { categoryId?: string | null; title?: string; format?: NoteFormat; content?: string; tags?: string[]; expectedModified?: string }) => Promise<Note>;
  remove: (id: string) => Promise<void>;
}
export const useNotes = create<NotesState>((set) => ({
  items: [],
  currentId: null,
  loading: false,
  async refresh(categoryId) {
    set({ loading: true, error: undefined });
    try {
      const items = await tauri.listNotes(categoryId);
      set({ items, loading: false });
    } catch (e) {
      set({ error: String(e), loading: false });
    }
  },
  select(id) { set({ currentId: id }); },
  async create(input) {
    const note = await tauri.createNote(input);
    set((s) => ({ items: [note, ...s.items], currentId: note.id }));
    return note;
  },
  async update(id, input) {
    const note = await tauri.updateNote(id, input);
    set((s) => ({ items: s.items.map((n) => (n.id === id ? note : n)) }));
    return note;
  },
  async remove(id) {
    await tauri.deleteNote(id);
    set((s) => {
      const items = s.items.filter((n) => n.id !== id);
      return { items, currentId: s.currentId === id ? null : s.currentId };
    });
  },
}));
export const currentNote = (state: NotesState) => state.items.find((n) => n.id === state.currentId) ?? null;
