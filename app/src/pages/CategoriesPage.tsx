import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Plus, Trash2 } from "lucide-react";
import { useCategories } from "@/store/categories";
import type { Category } from "@/types";
export default function CategoriesPage() {
  const { items, refresh, create, remove } = useCategories();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [icon, setIcon] = useState("📁");
  const [description, setDescription] = useState("");
  useEffect(() => { refresh(); }, [refresh]);
  async function handleCreate() {
    if (!name.trim()) return;
    await create({ name: name.trim(), icon: icon.trim() || "📁", description: description.trim() || undefined });
    setName(""); setIcon("📁"); setDescription(""); setOpen(false);
  }
  return (
    <div className="flex h-full flex-col">
      <header className="flex h-14 items-center justify-between border-b px-6">
        <div>
          <h1 className="text-lg font-semibold">分类</h1>
          <p className="text-xs text-muted-foreground">管理个人事务的分组</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm"><Plus className="h-4 w-4" /> 新建分类</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>新建分类</DialogTitle>
              <DialogDescription>例如：工作 / 学习 / 生活 / 财务 / 项目 A</DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Input className="w-16 text-center" value={icon} onChange={(e) => setIcon(e.target.value)} maxLength={4} />
                <Input placeholder="分类名称" value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <Textarea placeholder="可选：分类描述" value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setOpen(false)}>取消</Button>
              <Button onClick={handleCreate} disabled={!name.trim()}>创建</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </header>
      <div className="grid flex-1 grid-cols-1 gap-3 overflow-y-auto p-6 md:grid-cols-2 lg:grid-cols-3">
        {items.length === 0 && (
          <Card className="col-span-full border-dashed">
            <CardHeader>
              <CardTitle>还没有分类</CardTitle>
              <CardDescription>点击右上角 “新建分类” 开始组织你的事务。</CardDescription>
            </CardHeader>
          </Card>
        )}
        {items.map((c: Category) => (
          <Card key={c.id}>
            <CardHeader className="flex flex-row items-start justify-between space-y-0">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <span className="text-xl">{c.icon || "📁"}</span>
                  <span>{c.name}</span>
                </CardTitle>
                {c.description && <CardDescription className="mt-1">{c.description}</CardDescription>}
              </div>
              <Button size="icon" variant="ghost" onClick={() => remove(c.id)} aria-label="删除分类">
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            </CardHeader>
            <CardContent>
              <Badge variant="secondary">创建于 {new Date(c.createdAt).toLocaleDateString()}</Badge>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
