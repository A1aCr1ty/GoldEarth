import type { StockAccount } from "./stockAccountImport";

export const STOCK_ACCOUNTS_KEY = "goldearth.stock-accounts.v1";
export const STOCK_ACCOUNTS_CHANGED = "goldearth:accounts-changed";
export function readStockAccounts(): StockAccount[] {
  try { const value = JSON.parse(localStorage.getItem(STOCK_ACCOUNTS_KEY) || "[]"); return Array.isArray(value) ? value : []; } catch { return []; }
}
export function saveStockAccounts(accounts: StockAccount[]) {
  localStorage.setItem(STOCK_ACCOUNTS_KEY, JSON.stringify(accounts));
  window.dispatchEvent(new Event(STOCK_ACCOUNTS_CHANGED));
}
