import { useEffect, useState } from "react";

type Recipe = { id: string; name: string; ingredients: string[]; steps: string; image: string; added: string };
type Cache = { day: string; recipes: Recipe[] };
const seedIds = new Set(["12162", "11288", "11403", "17205"]);
const day = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
function database(): Promise<IDBDatabase> { return new Promise((resolve, reject) => { const r = indexedDB.open("gold-earth-cocktails", 1); r.onupgradeneeded = () => r.result.createObjectStore("cache"); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); }); }
async function read(): Promise<Cache> { const db = await database(); try { return await new Promise((resolve, reject) => { const r = db.transaction("cache").objectStore("cache").get("daily"); r.onsuccess = () => resolve(r.result ?? { day: "", recipes: [] }); r.onerror = () => reject(r.error); }); } finally { db.close(); } }
async function write(cache: Cache) { const db = await database(); try { await new Promise<void>((resolve, reject) => { const tx = db.transaction("cache", "readwrite"); tx.objectStore("cache").put(cache, "daily"); tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error); }); } finally { db.close(); } }
async function fetchOk(url: string) { const r = await fetch(url, { signal: AbortSignal.timeout(15000) }); if (!r.ok) throw new Error(`数据源响应 ${r.status}`); return r; }
async function picture(url: string): Promise<string> { const u = new URL(url); if (u.protocol !== "https:" || u.hostname !== "www.thecocktaildb.com") throw new Error("图片来源无效"); const blob = await (await fetchOk(url + "/medium")).blob(); if (!blob.type.startsWith("image/") || blob.size > 3000000) throw new Error("图片格式或大小无效"); return new Promise((resolve,reject) => { const r = new FileReader(); r.onload = () => resolve(String(r.result)); r.onerror = () => reject(r.error); r.readAsDataURL(blob); }); }
let pending: Promise<Cache> | null = null;
async function update(force: boolean): Promise<Cache> {
 if (pending) return pending;
 pending = (async () => {
  const cache = await read(); const today = day(); if (!force && cache.day === today) return cache;
  const ids = new Set([...seedIds, ...cache.recipes.map(r => r.id)]); const names = new Set(cache.recipes.map(r => r.name.toLowerCase()));
  // Rotate through letters, fetching complete source recipes instead of inventing quantities.
  const offset = Math.floor(Date.now() / 86400000) % 26; const additions: Recipe[] = [];
  for (let i = 0; i < 4 && additions.length < 3; i++) {
   const letter = String.fromCharCode(97 + (offset + i) % 26);
   const data = await (await fetchOk(`https://www.thecocktaildb.com/api/json/v1/${import.meta.env.VITE_COCKTAILDB_API_KEY || "1"}/search.php?f=${letter}`)).json();
   if (!Array.isArray(data.drinks) && data.drinks !== null) throw new Error("数据源返回格式无效");
   for (const d of data.drinks ?? []) {
    if (!/^\d+$/.test(d.idDrink) || !d.strDrink || ids.has(d.idDrink) || names.has(d.strDrink.toLowerCase()) || !d.strInstructions || !d.strDrinkThumb) continue;
    const ingredients: string[] = [];
    for (let n = 1; n <= 15; n++) { const name = d[`strIngredient${n}`]?.trim(); if (name) ingredients.push(`${name} · ${d[`strMeasure${n}`]?.trim() || "原来源未注明用量"}`); }
    if (ingredients.length < 2 || ingredients.length > 5) continue;
    const image = await picture(d.strDrinkThumb);
    additions.push({ id: d.idDrink, name: d.strDrink, ingredients, steps: d.strInstructions, image, added: today }); ids.add(d.idDrink); names.add(d.strDrink.toLowerCase()); if (additions.length === 3) break;
   }
  }
  const next = { day: today, recipes: [...additions, ...cache.recipes] }; await write(next); return next;
 })();
 try { return await pending; } finally { pending = null; }
}
export function DailyCocktails() {
 const [cache,setCache] = useState<Cache>({day:"", recipes:[]}); const [busy,setBusy] = useState(false); const [error,setError] = useState(""); const [message,setMessage] = useState("");
 useEffect(() => { let live = true; const load = async () => { try { const saved = await read(); if (live) setCache(saved); if (live) setBusy(true); const next = await update(false); if (live) { setCache(next); setError(""); } } catch(e) { if (live) setError(`更新未完成，保留已有缓存。${String(e)}`); } finally { if (live) setBusy(false); } }; void load(); const timer = window.setInterval(() => void load(), 600000); window.addEventListener("online",load); return () => { live=false; clearInterval(timer); window.removeEventListener("online",load); }; }, []);
 const refresh = async () => { setBusy(true); setError(""); setMessage(""); try { const next = await update(true); setMessage(next.recipes.length > cache.recipes.length ? `新增 ${next.recipes.length-cache.recipes.length} 款配方` : "本次未发现符合条件的新配方，已保留全部缓存。"); setCache(next); } catch(e) { setError(`更新失败，可稍后重试。${String(e)}`); } finally { setBusy(false); } };
 return <section className="mb-8 rounded-2xl border bg-card p-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-xl font-semibold">每日联网新增</h2><p className="mt-2 text-xs leading-6 text-muted-foreground">北京时间每日首次打开本页自动检查；停留时每 10 分钟检查跨日。每次最多新增 3 款，按来源编号与名称去重，配方和照片一起缓存。关闭应用期间不更新。</p></div><button disabled={busy} onClick={()=>void refresh()} className="rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50">{busy?"正在更新…":"立即检查新增"}</button></div><p className="mt-3 text-xs text-muted-foreground">最近成功检查：{cache.day || "尚未完成"} · 已缓存 {cache.recipes.length} 款 · 来源：<a href="https://www.thecocktaildb.com" target="_blank" rel="noreferrer" className="underline">TheCocktailDB</a></p><p className="mt-2 text-xs text-muted-foreground">联网配方精选 2–5 种材料，保留来源英文及原始单位；部分材料需另购。新增指加入本地库，不代表来源当天发布；来源有限，不保证每天有新品。</p>{error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}{message && <p role="status" className="mt-3 text-sm">{message}</p>}<div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">{cache.recipes.map(r=><details key={r.id} className="overflow-hidden rounded-xl border"><summary className="cursor-pointer"><img src={r.image} alt={`${r.name}成品参考`} loading="lazy" className="aspect-[4/3] w-full object-cover"/><span className="block p-3 font-medium">{r.name}<span className="mt-1 block text-xs font-normal text-muted-foreground">{r.added} 加入 · 展开配方</span></span></summary><div className="space-y-3 p-4 text-sm"><h3 className="font-semibold">材料 · 来源原始用量（不参与上方杯数换算）</h3><ul className="space-y-2">{r.ingredients.map(i=><li key={i}>{i}</li>)}</ul><h3 className="font-semibold">制作步骤（原文）</h3><p className="whitespace-pre-line leading-7">{r.steps}</p><a className="text-primary underline" href={`https://www.thecocktaildb.com/drink/${r.id}`} target="_blank" rel="noreferrer">查看配方与照片来源</a></div></details>)}</div>{!cache.recipes.length && !busy && <p className="mt-4 text-sm text-muted-foreground">暂无联网缓存，下方内置配方仍可离线使用。</p>}</section>;
}
