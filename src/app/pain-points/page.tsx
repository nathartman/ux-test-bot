"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  fetchPainPoints,
  deletePainPoint,
  type PainPoint,
} from "@/lib/supabase";
import { getPriorityColor } from "@/lib/jira-config";
import { Trash2 } from "lucide-react";

type GroupBy = "area" | "tags" | "none";

export default function PainPointsPage() {
  const router = useRouter();
  const [points, setPoints] = useState<PainPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [groupBy, setGroupBy] = useState<GroupBy>("area");

  useEffect(() => {
    fetchPainPoints()
      .then(setPoints)
      .catch((err) => {
        console.error(err);
        toast.error("Failed to load pain points");
      })
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    if (!search.trim()) return points;
    const q = search.toLowerCase();
    return points.filter(
      (p) =>
        p.description.toLowerCase().includes(q) ||
        p.area?.toLowerCase().includes(q) ||
        p.source_ticket_title?.toLowerCase().includes(q) ||
        p.tags.some((t) => t.toLowerCase().includes(q)) ||
        p.participant_name?.toLowerCase().includes(q)
    );
  }, [points, search]);

  const grouped = useMemo(() => {
    if (groupBy === "none") return { All: filtered };

    const map: Record<string, PainPoint[]> = {};

    for (const p of filtered) {
      if (groupBy === "area") {
        const key = p.area || "Uncategorized";
        (map[key] ??= []).push(p);
      } else {
        if (p.tags.length === 0) {
          (map["Untagged"] ??= []).push(p);
        } else {
          for (const tag of p.tags) {
            (map[tag] ??= []).push(p);
          }
        }
      }
    }

    // Sort groups by count descending
    const sorted = Object.entries(map).sort(
      (a, b) => b[1].length - a[1].length
    );
    return Object.fromEntries(sorted);
  }, [filtered, groupBy]);

  const handleDelete = useCallback(
    async (id: string) => {
      try {
        await deletePainPoint(id);
        setPoints((prev) => prev.filter((p) => p.id !== id));
        toast.success("Pain point deleted");
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Failed to delete"
        );
      }
    },
    []
  );

  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-center justify-between border-b px-4 py-2">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => router.push("/")}
          >
            &larr; Back
          </Button>
          <h1 className="text-sm font-medium">Pain Points</h1>
          <span className="text-xs text-muted-foreground tabular-nums">
            {filtered.length} total
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search"
            className="h-7 w-48 text-xs"
            autoComplete="off"
            spellCheck={false}
          />
          <div className="inline-flex gap-0 rounded-lg border p-0.5">
            {(["area", "tags", "none"] as const).map((g) => (
              <button
                key={g}
                onClick={() => setGroupBy(g)}
                className={`rounded-md px-2 py-0.5 text-xs font-medium transition-colors duration-150 ease-out ${
                  groupBy === g
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {g === "none" ? "Flat" : g === "area" ? "By area" : "By tag"}
              </button>
            ))}
          </div>
        </div>
      </header>

      {loading ? (
        <div className="flex flex-1 items-center justify-center">
          <p className="text-sm text-muted-foreground">Loading...</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2">
          <p className="text-sm text-muted-foreground">
            {points.length === 0
              ? "No pain points logged yet."
              : "No results match your search."}
          </p>
        </div>
      ) : (
        <ScrollArea className="flex-1">
          <div className="space-y-6 p-6">
            {Object.entries(grouped).map(([groupName, items]) => (
              <div key={groupName}>
                <div className="mb-3 flex items-center gap-2">
                  <h2 className="text-sm font-medium">{groupName}</h2>
                  <Badge variant="secondary" className="tabular-nums">
                    {items.length}
                  </Badge>
                </div>
                <div className="space-y-2">
                  {items.map((p) => (
                    <div
                      key={p.id}
                      className="group flex items-start gap-3 rounded-lg border px-4 py-3"
                    >
                      <div className="min-w-0 flex-1 space-y-1.5">
                        {p.source_ticket_title && (
                          <p className="text-xs font-medium text-muted-foreground">
                            {p.source_ticket_title}
                          </p>
                        )}
                        <p className="text-sm">{p.description}</p>
                        <div className="flex flex-wrap items-center gap-2">
                          {p.severity && (
                            <span
                              className={`inline-flex h-5 items-center rounded-full px-2 text-xs font-medium ${getPriorityColor(
                                p.severity === "High"
                                  ? "2"
                                  : p.severity === "Medium"
                                    ? "3"
                                    : "4"
                              )}`}
                            >
                              {p.severity}
                            </span>
                          )}
                          {p.tags.map((tag) => (
                            <Badge key={tag} variant="outline">
                              {tag}
                            </Badge>
                          ))}
                          {p.participant_name && (
                            <span className="text-xs text-muted-foreground">
                              {p.participant_name}
                            </span>
                          )}
                          {p.session_date && (
                            <span className="text-xs text-muted-foreground tabular-nums">
                              {p.session_date}
                            </span>
                          )}
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        className="shrink-0 opacity-0 transition-opacity duration-150 group-hover:opacity-100"
                        onClick={() => handleDelete(p.id)}
                        aria-label="Delete pain point"
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  ))}
                </div>
                <Separator className="mt-6" />
              </div>
            ))}
          </div>
        </ScrollArea>
      )}
    </div>
  );
}
