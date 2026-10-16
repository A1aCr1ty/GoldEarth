import { HashRouter, Route, Routes, Navigate } from "react-router-dom";
import { AppShell } from "@/components/layout/AppShell";
import CategoriesPage from "@/pages/CategoriesPage";
import NotesPage from "@/pages/NotesPage";
import AgentsPage from "@/pages/AgentsPage";
import SettingsPage from "@/pages/SettingsPage";
import StocksPage from "@/pages/StocksPage";
import HomePage from "@/pages/HomePage";
import LibraryPage from "@/pages/LibraryPage";
import ExplorePage from "@/pages/ExplorePage";
import PricePage from "@/pages/PricePage";
import ArchifyPage from "@/pages/ArchifyPage";
export default function App() {
  return (
    <HashRouter>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<Navigate to="/home" replace />} />
          <Route path="/home" element={<HomePage />} />
          <Route path="/categories" element={<CategoriesPage />} />
          <Route path="/notes" element={<NotesPage />} />
          <Route path="/library" element={<LibraryPage />} />
          <Route path="/stocks" element={<StocksPage />} />
          <Route path="/explore" element={<ExplorePage />} />
          <Route path="/prices" element={<PricePage />} />
          <Route path="/agents" element={<AgentsPage />} />
          <Route path="/archify" element={<ArchifyPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Route>
      </Routes>
    </HashRouter>
  );
}
