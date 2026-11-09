import { useState } from "react";
import { ChefHat, Clock, ExternalLink, Heart, Search } from "lucide-react";
import { open as openExternal } from "@tauri-apps/plugin-shell";
import { recipes } from "@/lib/recipes";
import { recipeMedia } from "@/lib/recipeMedia";
import { useLocalRecord } from "@/lib/useLocalRecord";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

async function showSource(url: string) {
  try {
    if ("__TAURI_INTERNALS__" in window) await openExternal(url);
    else window.open(url, "_blank", "noopener,noreferrer");
  } catch {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}

export default function RecipesPage() {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("全部");
  const [onlySaved, setOnlySaved] = useState(false);
  const [selected, setSelected] = useState(recipes[0].id);
  const [servings, setServings] = useState(2);
  const saved = useLocalRecord<string[]>("goldearth.recipes.favorites.v1", []);
  const visible = recipes.filter(r => (category === "全部" || r.category === category) && (!onlySaved || saved.value.includes(r.id)) && query.trim().split(/\s+/).every(q => `${r.name} ${r.ingredients.map(i => i.name).join(" ")}`.includes(q)));
  const recipe = visible.find(r => r.id === selected) || visible[0];
  return <div className="h-full overflow-y-auto p-5 md:p-8">
    <header className="mb-6 flex items-center gap-3"><ChefHat className="h-9 w-9 text-primary" /><div><p className="text-xs tracking-widest text-muted-foreground">DAILY KITCHEN</p><h1 className="text-2xl font-semibold">今天，在家好好吃饭</h1><p className="mt-1 text-sm text-muted-foreground">{recipes.length} 道家常菜 · 完整食材配方 · {Object.keys(recipeMedia).length} 道配有成品参考图</p></div></header>
    <div className="mb-4 flex flex-wrap gap-2"><div className="relative min-w-64 flex-1"><Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" /><Input aria-label="搜索菜名或食材" className="pl-9" placeholder="搜菜名或食材，例如：鸡蛋 番茄" value={query} onChange={e => setQuery(e.target.value)} /></div><Button variant={onlySaved ? "default" : "outline"} onClick={() => setOnlySaved(!onlySaved)}><Heart className="mr-2 h-4 w-4" />我的收藏</Button></div>
    <div className="mb-6 flex flex-wrap gap-2">{["全部", ...new Set(recipes.map(r => r.category))].map(c => <Button key={c} size="sm" variant={c === category ? "default" : "outline"} onClick={() => setCategory(c)}>{c}</Button>)}</div>
    {saved.error && <p role="alert" className="mb-3 text-destructive">{saved.error}</p>}
    {!recipe ? <p className="rounded-xl border border-dashed p-12 text-center text-muted-foreground">没有匹配的食谱，试试其他食材或清除筛选。</p> : <div className="grid items-start gap-6 lg:grid-cols-[minmax(260px,1fr)_minmax(320px,1.25fr)]">
      <div className="grid max-h-[70vh] gap-3 overflow-y-auto pr-1 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">{visible.map(r => <button key={r.id} onClick={() => setSelected(r.id)} className={`overflow-hidden rounded-xl border text-left transition-colors hover:bg-accent ${recipe.id === r.id ? "border-primary bg-primary/5" : "bg-card"}`}>{recipeMedia[r.id] && <img src={recipeMedia[r.id].src} alt="" className="h-32 w-full object-cover" />}<span className="block px-4 pt-4 text-xs text-primary">{r.category}</span><h2 className="my-2 px-4 text-lg font-medium">{r.name}{saved.value.includes(r.id) && <Heart className="ml-2 inline h-3 w-3 fill-primary text-primary" />}</h2><p className="line-clamp-2 min-h-10 px-4 text-sm text-muted-foreground">{r.ingredients.slice(0, 4).map(i => i.name).join(" · ")}</p><p className="mt-3 flex items-center gap-1 px-4 pb-4 text-xs text-muted-foreground"><Clock className="h-3 w-3" />{r.minutes} 分钟 · {r.servings} 人份</p></button>)}</div>
      <article className="rounded-2xl border bg-card p-5 md:p-7"><div className="flex items-start justify-between gap-3"><div><p className="text-xs text-primary">家常配方 / {recipe.category}</p><h2 className="mt-2 text-2xl font-semibold">{recipe.name}</h2></div><Button aria-label="收藏食谱" variant="outline" onClick={() => saved.save(saved.value.includes(recipe.id) ? saved.value.filter(id => id !== recipe.id) : [...saved.value, recipe.id])}><Heart className={`h-4 w-4 ${saved.value.includes(recipe.id) ? "fill-primary text-primary" : ""}`} /></Button></div>
        {recipeMedia[recipe.id] && <figure className="my-5"><img src={recipeMedia[recipe.id].src} alt={recipe.name + "成品参考"} className="aspect-[4/3] w-full rounded-xl object-cover" /><figcaption className="mt-2 text-xs leading-5 text-muted-foreground">成品参考，家常卖相会有差别。{recipeMedia[recipe.id].note} 照片：{recipeMedia[recipe.id].author}，{recipeMedia[recipe.id].license}。<Button size="sm" variant="ghost" className="ml-1 h-7 px-2" onClick={() => void showSource(recipeMedia[recipe.id].sourceUrl)}><ExternalLink className="mr-1 h-3 w-3" />来源</Button></figcaption></figure>}
        <div className="my-6 flex items-center justify-between border-y py-3"><span className="text-sm">食材清单</span><label className="flex items-center gap-2 text-sm">人数<select aria-label="用餐人数" className="rounded border bg-background p-1" value={servings} onChange={e => setServings(Number(e.target.value))}>{[1,2,3,4,6,8].map(n => <option key={n} value={n}>{n} 人</option>)}</select></label></div>
        <div className="grid grid-cols-2 gap-x-6 gap-y-3">{recipe.ingredients.map(i => <div key={i.name} className="flex justify-between gap-2 text-sm"><span>{i.name}</span><span className="text-muted-foreground">{Number((i.amount * servings / recipe.servings).toFixed(1))} {i.unit}</span></div>)}</div>
        <p className="mt-4 text-xs text-muted-foreground">用量按人数同比换算；鸡蛋等整件食材可取整，盐与调味料按口味调整，烹饪时间不按人数倍增。</p>
        <h3 className="mb-4 mt-7 font-semibold">开始下厨</h3><ol className="space-y-5">{recipe.steps.map((step, i) => <li key={i} className="flex gap-3"><span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">{i + 1}</span><p className="pt-0.5 text-sm leading-7">{step}</p></li>)}</ol>
        <p className="mt-6 border-t pt-4 text-xs text-muted-foreground">内置家常参考配方；含过敏原的食材请按个人情况替换。肉、蛋与四季豆须充分做熟。</p>
      </article>
    </div>}
  </div>;
}
