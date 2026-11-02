import { useEffect } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import { tauri } from '@/lib/tauri';

// Persist a daily attempt before starting, so navigation/reloads cannot duplicate a run.
export function StrategyReviewMonitor() {
  useEffect(() => {
    if (!isTauri()) return;
    let running = false;
    const tick = async () => {
      const now = new Date(Date.now() + 8*3600000);
      const day = now.toISOString().slice(0,10);
      if (running || [0,6].includes(now.getUTCDay()) || now.getUTCHours() < 16 || localStorage.getItem('strategy.auto.enabled') === 'false' || localStorage.getItem('strategy.auto.day') === day) return;
      running = true; localStorage.setItem('strategy.auto.day', day);
      try { await tauri.strategyReview(); window.dispatchEvent(new Event('strategy:updated')); localStorage.removeItem('strategy.auto.error'); }
      catch(e) { localStorage.setItem('strategy.auto.error', String(e)); }
      finally { running = false; }
    };
    void tick(); const timer = setInterval(() => void tick(), 60000);
    return () => clearInterval(timer);
  }, []);
  return null;
}
