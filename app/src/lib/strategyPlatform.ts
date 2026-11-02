import template from "../../../src-tauri/resources/strategy/platform/index.html?raw";
import results from "../../../src-tauri/resources/strategy/platform/results.json";
import adaptive from "../../../src-tauri/resources/strategy/platform/adaptive_results.json";

export interface StrategySnapshot {
  results: typeof results;
  adaptive: typeof adaptive & { operations?: { code: string; asof: string; target: number | null }[]; sources?: { sources: { id: string; title: string; url: string; evidence: string; implementation: string }[] }; prediction_review?: { matured: number; brier: number | null } };
}
export const bundledStrategy: StrategySnapshot = { results, adaptive };

export function strategyDocument(snapshot: StrategySnapshot): string {
  // Data is embedded, so the sandbox needs neither an HTTP server nor filesystem access.
  const json = JSON.stringify(snapshot).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
  return template.replace('<script>', () => `<script>const SNAPSHOT = ${json};`)
    .replace('fetch("results.json").then(r => { if (!r.ok) throw new Error("results"); return r.json(); })', 'Promise.resolve(SNAPSHOT.results)')
    .replace('fetch("adaptive_results.json").then(r => { if (!r.ok) throw new Error("adaptive"); return r.json(); }).catch(() => null)', 'Promise.resolve(SNAPSHOT.adaptive)')
    .replace('<td>${esc(s.code)}</td>', '<td><button type="button" data-stock="${esc(s.code)}" title="查看行情">${esc(s.code)}</button></td>')
    .replace('</script>', `
document.addEventListener('click', event => {
  const button = event.target.closest('[data-stock]');
  if (button) parent.postMessage({ type: 'strategy-stock', code: button.dataset.stock }, '*');
});
window.addEventListener('message', event => {
  if (event.source !== parent || event.data?.type !== 'strategy-filter' || !DATA) return;
  $('q').value = String(event.data.code || ''); stockRows(); show('decision');
});
</script>`);
}
