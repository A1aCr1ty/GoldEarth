import { invoke } from "@tauri-apps/api/core";
export const tauri = {
  ping(): Promise<string> { return invoke<string>("ping"); },
  listCategories() { return invoke<import("@/types").Category[]>("list_categories"); },
  createCategory(input: { name: string; icon?: string; description?: string }) { return invoke<import("@/types").Category>("create_category", { input }); },
  updateCategory(id: string, input: { name?: string; icon?: string; description?: string }) { return invoke<import("@/types").Category>("update_category", { id, input }); },
  deleteCategory(id: string) { return invoke<void>("delete_category", { id }); },
  listNotes(categoryId?: string | null) { return invoke<import("@/types").Note[]>("list_notes", { categoryId: categoryId ?? null }); },
  getNote(id: string) { return invoke<import("@/types").Note>("get_note", { id }); },
  createNote(input: { categoryId: string | null; title: string; format: import("@/types").NoteFormat; content: string; tags: string[] }) { return invoke<import("@/types").Note>("create_note", { input }); },
  updateNote(id: string, input: { categoryId?: string | null; title?: string; format?: import("@/types").NoteFormat; content?: string; tags?: string[]; expectedModified?: string }) { return invoke<import("@/types").Note>("update_note", { id, input }); },
  deleteNote(id: string) { return invoke<void>("delete_note", { id }); },
  listAgents() { return invoke<import("@/types").Agent[]>("list_agents"); },
  createAgent(input: Omit<import("@/types").Agent, "id" | "createdAt">) { return invoke<import("@/types").Agent>("create_agent", { input }); },
  updateAgent(id: string, input: Partial<Omit<import("@/types").Agent, "id" | "createdAt">>) { return invoke<import("@/types").Agent>("update_agent", { id, input }); },
  deleteAgent(id: string) { return invoke<void>("delete_agent", { id }); },
  runAgent(agentId: string, prompt: string, sessionId?: string, noteId?: string, context?: string, stockCode?: string, libraryId?: string) { return invoke<import("@/types").AgentRun>("run_agent", { agentId, prompt, sessionId: sessionId ?? null, noteId: noteId ?? null, context: context ?? null, stockCode: stockCode ?? null, libraryId: libraryId ?? null }); },
  cancelAgentRun(runId: string) { return invoke<void>("cancel_agent_run", { runId }); },
  listAgentRuns(limit?: number) { return invoke<import("@/types").AgentRun[]>("list_agent_runs", { limit: limit ?? 50 }); },
  listNoteRuns(noteId: string, agentId: string, limit?: number) { return invoke<import("@/types").AgentRun[]>("list_note_runs", { noteId, agentId, limit: limit ?? 100 }); },
  listStockRuns(stockCode: string, agentId: string, limit?: number) { return invoke<import("@/types").AgentRun[]>("list_stock_runs", { stockCode, agentId, limit: limit ?? 100 }); },
  getNoteAgentSession(noteId: string, agentId: string) { return invoke<string | null>("get_note_agent_session", { noteId, agentId }); },
  getStockAgentSession(stockCode: string, agentId: string) { return invoke<string | null>("get_stock_agent_session", { stockCode, agentId }); },
  getNoteFilePath(id: string) { return invoke<string | null>("get_note_file_path", { id }); },
  listLibraryRuns(libraryId: string, agentId: string, limit?: number) { return invoke<import("@/types").AgentRun[]>("list_library_runs", { libraryId, agentId, limit: limit ?? 100 }); },
  getLibraryAgentSession(libraryId: string, agentId: string) { return invoke<string | null>("get_library_agent_session", { libraryId, agentId }); },
  getLibraryDir(id: string) { return invoke<string | null>("get_library_dir", { id }); },
  // ===== 知识库 =====
  listLibraryCategories() { return invoke<import("@/types").LibraryCategory[]>("list_library_categories"); },
  createLibraryCategory(input: { name: string; agentId?: string; description?: string }) { return invoke<import("@/types").LibraryCategory>("create_library_category", { input }); },
  updateLibraryCategory(id: string, input: { name: string; agentId?: string; description?: string }) { return invoke<import("@/types").LibraryCategory>("update_library_category", { id, input }); },
  setLibraryCategoryAgent(id: string, agentId: string) { return invoke<import("@/types").LibraryCategory>("set_library_category_agent", { id, agentId }); },
  deleteLibraryCategory(id: string) { return invoke<void>("delete_library_category", { id }); },
  listLibraryFiles(categoryId: string) { return invoke<import("@/types").LibraryFile[]>("list_library_files", { categoryId }); },
  importLibraryFiles(categoryId: string, sources: string[]) { return invoke<import("@/types").LibraryFile[]>("import_library_files", { categoryId, sources }); },
  importNotesToLibrary(categoryId: string, noteIds: string[]) { return invoke<import("@/types").LibraryFile[]>("import_notes_to_library", { categoryId, noteIds }); },
  deleteLibraryFile(categoryId: string, name: string) { return invoke<import("@/types").LibraryFile[]>("delete_library_file", { categoryId, name }); },
  readLibraryText(categoryId: string, name: string) { return invoke<string | null>("read_library_text", { categoryId, name }); },
  libraryCategoryPath(id: string) { return invoke<string | null>("library_category_path", { id }); },
  getStorageInfo() { return invoke<{ root: string; totalNotes: number; totalCategories: number }>("get_storage_info"); },
  openStorageFolder() { return invoke<void>("open_storage_folder"); },
  changeStorageLocation(path: string) { return invoke<void>("change_storage_location", { path }); },
  getSettings() { return invoke<import("@/types").AppSettings>("get_settings"); },
  updateSettings(input: Partial<import("@/types").AppSettings>) { return invoke<import("@/types").AppSettings>("update_settings", { input }); },
  // ===== 行情 =====
  availableIndices() { return invoke<import("@/types").IndexOption[]>("available_indices"); },
  marketIndices() { return invoke<import("@/types").Quote[]>("market_indices"); },
  stockQuotes(codes: string[]) { return invoke<import("@/types").Quote[]>("stock_quotes", { codes }); },
  stockQuote(code: string) { return invoke<import("@/types").Quote>("stock_quote", { code }); },
  stockKline(code: string, period: import("@/types").KlinePeriod, limit?: number) { return invoke<import("@/types").Candle[]>("stock_kline", { code, period, limit: limit ?? 500 }); },
  stockTrends(code: string) { return invoke<import("@/types").Trend>("stock_trends", { code }); },
  marketRankings(kind: import("@/types").RankKind, limit?: number) { return invoke<import("@/types").RankItem[]>("market_rankings", { kind, limit: limit ?? 20 }); },
  stockFundFlow(code: string) { return invoke<import("@/types").FundFlow>("stock_fund_flow", { code }); },
  getWatchlist() { return invoke<import("@/types").WatchItem[]>("get_watchlist"); },
  saveWatchlist(items: import("@/types").WatchItem[]) { return invoke<import("@/types").WatchItem[]>("save_watchlist", { items }); },
  seedWatchlist(items: import("@/types").WatchItem[]) { return invoke<import("@/types").WatchItem[]>("seed_watchlist", { items }); },
  // ===== 天气 =====
  weatherReport(city?: string) { return invoke<import("@/types").WeatherReport>("weather_report", { city: city ?? null }); },
  searchCities(query: string) { return invoke<import("@/types").CityOption[]>("search_cities", { query }); },
  // ===== 星座运势 =====
  /** 不传 sign 就按设置里的生日推星座；传了则直接查那一个 */
  horoscopeToday(sign?: string) { return invoke<import("@/types").Horoscope>("horoscope_today", { sign: sign ?? null }); },
  // ===== 网上冲浪 =====
  /** 页面上有哪些平台、各自什么状态（含需不需要 Cookie） */
  trendingSources() { return invoke<import("@/types").HotSourceInfo[]>("trending_sources"); },
  /** B 站可切换的榜单口径 */
  trendingKinds() { return invoke<import("@/types").HotKindInfo[]>("trending_kinds"); },
  /** 拉一批平台的热榜；sources 不传就是全要。force 为真时绕过新鲜缓存真的重抓 */
  trendingBoards(sources?: string[], kind?: string, limit?: number, force?: boolean) { return invoke<import("@/types").HotBoard[]>("trending_boards", { sources: sources ?? null, kind: kind ?? null, limit: limit ?? null, force: force ?? null }); },
  /** 只刷一个平台，冲浪页的单卡刷新用；force 语义同上 */
  trendingBoard(source: string, kind?: string, limit?: number, force?: boolean) { return invoke<import("@/types").HotBoard>("trending_board", { source, kind: kind ?? null, limit: limit ?? null, force: force ?? null }); },
  // ===== 应用内阅读 =====
  /** 在 App 自己的阅读器窗口里打开链接，不跳系统浏览器；已开着就复用同一扇窗 */
  openReader(url: string, title?: string) { return invoke<void>("open_reader", { url, title: title ?? null }); },
  // ===== 价格追踪 =====
  listPriceTargets() { return invoke<import("@/types").PriceTarget[]>("list_price_targets"); },
  addPriceTarget(input: { name: string; keyword?: string; note?: string }) { return invoke<import("@/types").PriceTarget>("add_price_target", { name: input.name, keyword: input.keyword ?? null, note: input.note ?? null }); },
  removePriceTarget(id: string) { return invoke<void>("remove_price_target", { id }); },
  listPriceSamples(targetId: string) { return invoke<import("@/types").PriceSample[]>("list_price_samples", { targetId }); },
  /** 趋势图数据；days 传 0 表示不限 */
  priceTrend(targetId: string, days?: number) { return invoke<import("@/types").TrendPoint[]>("price_trend", { targetId, days: days ?? null }); },
  priceOverview(sparkDays?: number) { return invoke<import("@/types").PriceOverview[]>("price_overview", { sparkDays: sparkDays ?? null }); },
  /** 借 App 自己的 WebView2 搜价：比直连靠谱，风控认的是浏览器指纹 */
  fetchXianyuPrice(targetId: string) { return invoke<import("@/types").XianyuFetchSummary>("fetch_xianyu_price", { targetId }); },
  /** 把隐藏的抓价窗口亮出来。闲鱼要登录时用得上，登录态会留在 App 自己的 WebView2 目录里 */
  showXianyuWindow() { return invoke<void>("show_xianyu_window"); },
};
