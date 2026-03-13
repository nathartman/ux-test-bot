"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { UploadForm } from "@/components/upload-form";
import {
  listSessions,
  deleteSession,
  createSession,
  saveSession,
  uploadScreenshot,
  getLegacySession,
  clearLegacySession,
} from "@/lib/storage";
import {
  fetchPainPoints,
  deletePainPoint,
  type PainPoint,
} from "@/lib/supabase";
import { getPriorityColor } from "@/lib/jira-config";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Trash2 } from "lucide-react";
import type { SessionListItem, ProcessingStatus } from "@/lib/types";

type Tab = "new" | "past" | "pain-points";
type GroupBy = "area" | "tags" | "none";

function statusLabel(status: ProcessingStatus): string {
  switch (status) {
    case "filed":
      return "Complete";
    case "reviewing-tickets":
      return "Reviewing tickets";
    case "reviewing-notes":
      return "Reviewing notes";
    case "generating-tickets":
      return "Generating tickets";
    case "analyzing":
      return "Analyzing";
    case "transcribing":
      return "Transcribing";
    default:
      return "In progress";
  }
}

export default function HomePage() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("new");
  const [sessions, setSessions] = useState<SessionListItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [migrating, setMigrating] = useState(false);

  // Pain points state
  const [painPoints, setPainPoints] = useState<PainPoint[]>([]);
  const [painLoading, setPainLoading] = useState(false);
  const [painLoaded, setPainLoaded] = useState(false);
  const [search, setSearch] = useState("");
  const [groupBy, setGroupBy] = useState<GroupBy>("area");

  useEffect(() => {
    (async () => {
      try {
        const legacy = await getLegacySession();
        if (legacy) {
          setMigrating(true);
          const id = await createSession(legacy.metadata, {
            facilitatorNotes: legacy.facilitatorNotes,
            transcriptId: legacy.transcriptId ?? undefined,
            audioUrl: legacy.audioUrl ?? undefined,
            status: legacy.status,
          });
          await saveSession(id, {
            transcript: legacy.transcript,
            notesMarkdown: legacy.notesMarkdown,
            tickets: legacy.tickets,
            proposedTickets: legacy.proposedTickets,
          });
          if (legacy.screenshots) {
            for (const [key, blob] of Object.entries(legacy.screenshots)) {
              try {
                await uploadScreenshot(id, parseInt(key, 10), blob);
              } catch {
                // Best effort
              }
            }
          }
          await clearLegacySession();
          setMigrating(false);
        }
      } catch {
        setMigrating(false);
      }

      const list = await listSessions();
      setSessions(list);
      setLoaded(true);
    })();
  }, []);

  // Load pain points on first tab switch
  useEffect(() => {
    if (tab !== "pain-points" || painLoaded) return;
    setPainLoading(true);
    fetchPainPoints()
      .then(setPainPoints)
      .catch((err) => {
        console.error(err);
        toast.error("Failed to load pain points");
      })
      .finally(() => {
        setPainLoading(false);
        setPainLoaded(true);
      });
  }, [tab, painLoaded]);

  const filtered = useMemo(() => {
    if (!search.trim()) return painPoints;
    const q = search.toLowerCase();
    return painPoints.filter(
      (p) =>
        p.description.toLowerCase().includes(q) ||
        p.area?.toLowerCase().includes(q) ||
        p.source_ticket_title?.toLowerCase().includes(q) ||
        p.tags.some((t) => t.toLowerCase().includes(q)) ||
        p.participant_name?.toLowerCase().includes(q)
    );
  }, [painPoints, search]);

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
    const sorted = Object.entries(map).sort(
      (a, b) => b[1].length - a[1].length
    );
    return Object.fromEntries(sorted);
  }, [filtered, groupBy]);

  const handleDeletePainPoint = useCallback(async (id: string) => {
    try {
      await deletePainPoint(id);
      setPainPoints((prev) => prev.filter((p) => p.id !== id));
      toast.success("Pain point deleted");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to delete"
      );
    }
  }, []);

  if (!loaded) return null;

  const tabs: Array<{ key: Tab; label: string; count?: number }> = [
    { key: "new", label: "New Session" },
    { key: "past", label: "Past Sessions", count: sessions.length },
    { key: "pain-points", label: "Pain Points" },
  ];

  return (
    <main className="flex min-h-screen flex-col items-center px-4 py-12">
      <div className="w-full max-w-2xl">
        {/* Tabs */}
        <div className="mb-8 border-b">
          <div className="flex">
            {tabs.map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`relative px-4 py-2 text-sm font-medium transition-colors duration-150 ease-out ${
                  tab === t.key
                    ? "text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {t.label}
                {t.count != null && t.count > 0 && (
                  <span className="ml-1.5 inline-flex items-center justify-center rounded bg-muted px-1.5 py-px text-[10px] tabular-nums text-muted-foreground">
                    {t.count}
                  </span>
                )}
                {tab === t.key && (
                  <span className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-foreground" />
                )}
              </button>
            ))}
          </div>
        </div>

        {/* New Session */}
        {tab === "new" && (
          <div className="flex flex-col items-center">
            {migrating && (
              <p className="mb-4 text-sm text-muted-foreground">
                Migrating existing session…
              </p>
            )}
            <UploadForm />
          </div>
        )}

        {/* Past Sessions */}
        {tab === "past" && (
          <>
            {sessions.length === 0 ? (
              <p className="py-12 text-center text-sm text-muted-foreground">
                No sessions yet. Start a new session to get going.
              </p>
            ) : (
              <div className="divide-y rounded-lg border">
                {sessions.map((s) => (
                  <div
                    key={s.id}
                    className="flex items-center gap-4 px-4 py-3"
                  >
                    <button
                      type="button"
                      onClick={() => router.push(`/session/${s.id}`)}
                      className="flex flex-1 items-center gap-4 text-left"
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">
                          {s.participantName}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {s.sessionDate ?? "No date"}
                        </p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="text-xs text-muted-foreground">
                          {statusLabel(s.status)}
                        </p>
                        {s.ticketCount > 0 && (
                          <p className="text-xs tabular-nums text-muted-foreground">
                            {s.filedCount}/{s.ticketCount} filed
                          </p>
                        )}
                      </div>
                    </button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="shrink-0 text-xs text-muted-foreground hover:text-destructive"
                      onClick={async () => {
                        await deleteSession(s.id);
                        setSessions((prev) =>
                          prev.filter((p) => p.id !== s.id)
                        );
                      }}
                    >
                      Delete
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {/* Pain Points */}
        {tab === "pain-points" && (
          <>
            <div className="mb-4 flex items-center justify-between gap-3">
              <span className="text-xs text-muted-foreground tabular-nums">
                {filtered.length} total
              </span>
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
                      {g === "none"
                        ? "Flat"
                        : g === "area"
                          ? "By area"
                          : "By tag"}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {painLoading ? (
              <p className="py-12 text-center text-sm text-muted-foreground">
                Loading…
              </p>
            ) : filtered.length === 0 ? (
              <p className="py-12 text-center text-sm text-muted-foreground">
                {painPoints.length === 0
                  ? "No pain points logged yet."
                  : "No results match your search."}
              </p>
            ) : (
              <div>
                <div className="space-y-6">
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
                              </div>
                              {(p.participant_name || p.session_date) && (
                                <p className="text-xs text-muted-foreground">
                                  {[p.participant_name, p.session_date].filter(Boolean).join(" · ")}
                                </p>
                              )}
                            </div>
                            <Button
                              variant="ghost"
                              size="icon-xs"
                              className="shrink-0 opacity-0 transition-opacity duration-150 group-hover:opacity-100"
                              onClick={() => handleDeletePainPoint(p.id)}
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
              </div>
            )}
          </>
        )}
      </div>
    </main>
  );
}
