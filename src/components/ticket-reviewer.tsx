"use client";

import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import { toast } from "sonner";
import type { TicketProposal } from "@/lib/types";
import {
  TEAMS,
  TEAM_NAMES,
  PRIORITY_OPTIONS,
  getPriorityColor,
} from "@/lib/jira-config";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { ScreenshotPreview } from "./screenshot-preview";
import { LogPainPointDialog } from "./log-pain-point-dialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Bug, SquareCheckBig, ArrowUp, FileText, Check, SkipForward, Plus, X } from "lucide-react";

const ISSUE_TYPE_CONFIG: Array<{
  name: TicketProposal["type"];
  icon: React.ComponentType<{ className?: string }>;
  activeClass: string;
  iconClass: string;
  label: string;
}> = [
  {
    name: "Bug",
    label: "Bug",
    activeClass: "bg-red-100 dark:bg-red-900/40",
    iconClass: "text-red-600 dark:text-red-400",
    icon: Bug,
  },
  {
    name: "Task",
    label: "Task",
    activeClass: "bg-blue-100 dark:bg-blue-900/40",
    iconClass: "text-blue-600 dark:text-blue-400",
    icon: SquareCheckBig,
  },
  {
    name: "Improvement",
    label: "Improvement",
    activeClass: "bg-green-100 dark:bg-green-900/40",
    iconClass: "text-green-600 dark:text-green-400",
    icon: ArrowUp,
  },
  {
    name: "Investigation",
    label: "Investigation",
    activeClass: "bg-orange-100 dark:bg-orange-900/40",
    iconClass: "text-orange-600 dark:text-orange-400",
    icon: FileText,
  },
];

// --- Multi-select dropdown for teams ---

function TeamMultiSelect({
  value,
  onChange,
  disabled,
}: {
  value: string[];
  onChange: (teams: string[], teamIds: string[]) => void;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick, true);
    return () => document.removeEventListener("mousedown", handleClick, true);
  }, [open]);

  const display =
    value.length === 0
      ? "Select teams…"
      : value.length === 1
        ? value[0]
        : `${value.length} teams`;

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className="flex h-8 w-full items-center justify-between rounded-lg border border-input bg-transparent px-2.5 text-sm transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 dark:bg-input/30"
      >
        <span className="truncate">{display}</span>
        <svg
          className="ml-1.5 size-3.5 shrink-0 text-muted-foreground"
          viewBox="0 0 16 16"
          fill="none"
        >
          <path
            d="M4 6l4 4 4-4"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      {open && (
        <div className="absolute left-0 z-50 mt-1 w-full rounded-lg border bg-popover p-1 shadow-md">
          {TEAM_NAMES.map((name) => {
            const checked = value.includes(name);
            return (
              <label
                key={name}
                className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent"
              >
                <Checkbox
                  checked={checked}
                  onCheckedChange={(c) => {
                    const next = c
                      ? [...value, name]
                      : value.filter((t) => t !== name);
                    onChange(
                      next,
                      next.map((n) => TEAMS[n] ?? "")
                    );
                  }}
                />
                {name}
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}

// --- Main component ---

interface TicketReviewerProps {
  tickets: TicketProposal[];
  onTicketChange: (index: number, ticket: TicketProposal) => void;
  onFileTicket: (index: number) => Promise<void>;
  onCaptureScreenshot: (index: number) => void;
  screenshots: Record<string, Blob | string>;
  screenshotWarnings: Record<string, string>;
  onDismissWarning: (key: string) => void;
  sessionMetadata: {
    participantName: string;
    sessionDate: string;
    zoomLink: string;
    zoomPasscode: string;
  };
}

export function TicketReviewer({
  tickets,
  onTicketChange,
  onFileTicket,
  onCaptureScreenshot,
  screenshots,
  screenshotWarnings,
  onDismissWarning,
  sessionMetadata,
}: TicketReviewerProps) {
  const [painPointOpen, setPainPointOpen] = useState(false);
  const [sidebarFilter, setSidebarFilter] = useState<"pending" | "filed" | "pain-point" | "skipped">("pending");

  const [activeIndex, setActiveIndex] = useState(() => {
    const firstPending = tickets.findIndex(
      (t) => t.ticketStatus === "pending"
    );
    return firstPending >= 0 ? firstPending : 0;
  });
  const [filing, setFiling] = useState(false);

  const ticket = tickets[activeIndex];

  const stats = useMemo(() => {
    let filed = 0;
    let skipped = 0;
    let pending = 0;
    let painPoints = 0;
    for (const t of tickets) {
      if (t.ticketStatus === "filed") filed++;
      else if (t.ticketStatus === "skipped") skipped++;
      else if (t.ticketStatus === "pain-point") painPoints++;
      else pending++;
    }
    return { filed, skipped, painPoints, pending };
  }, [tickets]);

  const filteredIndices = useMemo(() => {
    const indices: number[] = [];
    tickets.forEach((t, i) => {
      if (t.ticketStatus === sidebarFilter) {
        indices.push(i);
      }
    });
    return indices;
  }, [tickets, sidebarFilter]);

  const advanceToNextPending = useCallback(() => {
    const nextPending = tickets.findIndex(
      (t, i) => i > activeIndex && t.ticketStatus === "pending"
    );
    if (nextPending >= 0) {
      setActiveIndex(nextPending);
      return;
    }
    const firstPending = tickets.findIndex(
      (t) => t.ticketStatus === "pending"
    );
    if (firstPending >= 0) {
      setActiveIndex(firstPending);
    }
  }, [tickets, activeIndex]);

  function patch(fields: Partial<TicketProposal>) {
    onTicketChange(activeIndex, { ...ticket, ...fields });
  }

  const handleSkip = useCallback(() => {
    onTicketChange(activeIndex, {
      ...ticket,
      ticketStatus: "skipped",
      included: false,
    });
    advanceToNextPending();
  }, [activeIndex, ticket, onTicketChange, advanceToNextPending]);

  const handleFile = useCallback(async () => {
    setFiling(true);
    try {
      await onFileTicket(activeIndex);
      advanceToNextPending();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Filing failed"
      );
    } finally {
      setFiling(false);
    }
  }, [activeIndex, onFileTicket, advanceToNextPending]);

  const handleUnskip = useCallback(() => {
    onTicketChange(activeIndex, {
      ...ticket,
      ticketStatus: "pending",
      included: true,
    });
  }, [activeIndex, ticket, onTicketChange]);

  if (!ticket) return null;

  const isDone = ticket.ticketStatus === "filed" || ticket.ticketStatus === "pain-point";
  const isFiled = isDone;
  const screenshot = screenshots[String(activeIndex)] ?? null;
  const hasQuickWinLabel = ticket.labels.includes("design-engineer-quick-win");


  return (
    <div className="flex h-full">
      {/* Left sidebar */}
      <div className="flex w-[360px] shrink-0 flex-col overflow-hidden border-r">
        <div className="border-b px-1.5 pt-1.5 pb-0">
          <div className="flex">
            {([
              { key: "pending", label: "Pending", count: stats.pending },
              { key: "filed", label: "Filed", count: stats.filed },
              { key: "pain-point", label: "Logged", count: stats.painPoints },
              { key: "skipped", label: "Skipped", count: stats.skipped },
            ] as const).map((tab) => (
              <button
                key={tab.key}
                onClick={() => setSidebarFilter(tab.key)}
                className={`relative px-2 py-1.5 text-xs font-medium transition-colors duration-150 ease-out ${
                  sidebarFilter === tab.key
                    ? "text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {tab.label} <span className="ml-0.5 inline-flex items-center justify-center rounded bg-muted px-1 py-px text-[10px] tabular-nums text-muted-foreground">{tab.count}</span>
                {sidebarFilter === tab.key && (
                  <span className="absolute inset-x-1 bottom-0 h-0.5 rounded-full bg-foreground" />
                )}
              </button>
            ))}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          <div className="space-y-0.5 p-2">
            {filteredIndices.map((i) => {
              const t = tickets[i];
              return (
              <button
                key={i}
                onClick={() => setActiveIndex(i)}
                className={`flex w-full items-start gap-2 rounded-md px-2.5 py-2 text-left text-sm transition-colors duration-150 ease-out ${
                  i === activeIndex
                    ? "bg-accent text-accent-foreground"
                    : "hover:bg-muted"
                }`}
              >
                {t.ticketStatus === "pain-point" && (
                  <Check className="mt-0.5 size-3.5 shrink-0 text-violet-500" />
                )}
                {t.ticketStatus === "skipped" && (
                  <SkipForward className="mt-0.5 size-3.5 shrink-0 text-muted-foreground/50" />
                )}
                {t.ticketStatus === "pending" && (
                  <span className="mt-1.5 size-2 shrink-0 rounded-full border border-muted-foreground/40" />
                )}
                <div className="flex-1 min-w-0">
                  <span className="line-clamp-2">{t.title}</span>
                  {t.ticketStatus === "filed" && t.filedKey && (() => {
                    const cfg = ISSUE_TYPE_CONFIG.find((c) => c.name === t.type);
                    const Icon = cfg?.icon;
                    return (
                      <div className="mt-1 flex flex-wrap items-center gap-1">
                        <span className="inline-flex items-center gap-1 rounded border border-border/60 px-1.5 py-0.5 text-xs font-medium font-mono text-muted-foreground">
                          {Icon && <Icon className={`size-3 ${cfg?.iconClass ?? ""}`} />}
                          {t.filedKey}
                        </span>
                        {t.teams.map((team) => (
                          <span key={team} className="inline-flex items-center rounded border border-border/60 px-1.5 py-0.5 text-xs text-muted-foreground">
                            {team}
                          </span>
                        ))}
                      </div>
                    );
                  })()}
                </div>
              </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Right: ticket detail */}
      <div className="flex flex-1 flex-col overflow-hidden">
        <ScrollArea className="flex-1">
          <div className="space-y-5 p-6">
            {/* Status badges */}
            <div className="flex flex-wrap items-center gap-2">
              {isFiled && ticket.filedKey && (
                <a
                  href={ticket.filedUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-muted-foreground underline underline-offset-2"
                >
                  {ticket.filedKey}
                </a>
              )}
              {ticket.ticketStatus === "skipped" && (
                <span className="text-xs text-muted-foreground">Skipped</span>
              )}
              {ticket.ticketStatus === "pain-point" && (
                <Badge variant="secondary" className="text-violet-600 dark:text-violet-400">
                  Pain point logged
                </Badge>
              )}
            </div>

            {/* Title */}
            <div className="space-y-2">
              <Label htmlFor="ticket-title">Title</Label>
              <Input
                id="ticket-title"
                value={ticket.title}
                spellCheck={false}
                disabled={isFiled}
                onChange={(e) => patch({ title: e.target.value })}
              />
            </div>

            {/* Issue Type, Priority, Team, Quick Win — all on one row */}
            <div className="flex flex-wrap items-end gap-4">
              <div className="shrink-0 flex flex-col h-fit space-y-2">
                <Label>Type</Label>
                <TooltipProvider delayDuration={200}>
                  <div className="inline-flex h-8 items-center gap-0 rounded-lg border p-0.5">
                    {ISSUE_TYPE_CONFIG.map((cfg) => {
                      const Icon = cfg.icon;
                      return (
                        <Tooltip key={cfg.name}>
                          <TooltipTrigger asChild>
                            <button
                              type="button"
                              disabled={isFiled}
                              onClick={() => patch({ type: cfg.name })}
                              aria-label={cfg.label}
                              className={`rounded-md px-1.5 py-1 transition-colors duration-150 ease-out disabled:pointer-events-none disabled:opacity-50 ${
                                ticket.type === cfg.name
                                  ? cfg.activeClass
                                  : "opacity-40 hover:opacity-70"
                              }`}
                            >
                              <Icon className={`size-4 ${ticket.type === cfg.name ? cfg.iconClass : ""}`} />
                            </button>
                          </TooltipTrigger>
                          <TooltipContent side="bottom" className="text-xs">
                            {cfg.label}
                          </TooltipContent>
                        </Tooltip>
                      );
                    })}
                  </div>
                </TooltipProvider>
              </div>

              <div className="shrink-0 space-y-2">
                <Label>Priority</Label>
                <div className="inline-flex h-8 items-center gap-0 rounded-lg border p-0.5">
                  {PRIORITY_OPTIONS.map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      disabled={isFiled}
                      onClick={() =>
                        patch({
                          priority: opt.label as TicketProposal["priority"],
                          priorityId: opt.id as TicketProposal["priorityId"],
                        })
                      }
                      className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors duration-150 ease-out ${
                        ticket.priorityId === opt.id
                          ? opt.color
                          : "text-muted-foreground hover:text-foreground"
                      } disabled:pointer-events-none disabled:opacity-50`}
                    >
                      {opt.shortLabel}
                    </button>
                  ))}
                </div>
              </div>

              <div className="min-w-40 flex-1 space-y-2">
                <Label>Team</Label>
                <TeamMultiSelect
                  value={ticket.teams}
                  onChange={(teams, teamIds) => patch({ teams, teamIds })}
                  disabled={isFiled}
                />
              </div>

              <div className="shrink-0 space-y-2">
                <Label>Quick win</Label>
                <div className="flex h-8 items-center">
                  <Switch
                    checked={hasQuickWinLabel}
                    disabled={isFiled}
                    onCheckedChange={(checked) => {
                      const next = checked
                        ? [...ticket.labels, "design-engineer-quick-win"]
                        : ticket.labels.filter(
                            (l) => l !== "design-engineer-quick-win"
                          );
                      patch({ labels: next });
                    }}
                  />
                </div>
              </div>

              <div className="shrink-0 space-y-2">
                <Label>Add design subtask</Label>
                <div className="flex h-8 items-center">
                  <Switch
                    checked={ticket.needsDesign ?? false}
                    disabled={isFiled}
                    onCheckedChange={(checked) => patch({ needsDesign: checked })}
                  />
                </div>
              </div>
            </div>

            {/* Description */}
            <div className="space-y-2">
              <Label htmlFor="ticket-desc">Description</Label>
              <Textarea
                id="ticket-desc"
                value={ticket.description}
                className="min-h-32"
                spellCheck={false}
                disabled={isFiled}
                onChange={(e) => patch({ description: e.target.value })}
              />
            </div>

            {/* Additional instructions */}
            {!isFiled && (
              ticket.additionalInstructions != null ? (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="ticket-instructions">Additional instructions</Label>
                    <button
                      type="button"
                      onClick={() => patch({ additionalInstructions: undefined })}
                      className="rounded-md p-0.5 text-muted-foreground transition-colors duration-150 ease-out hover:text-foreground"
                      aria-label="Remove additional instructions"
                    >
                      <X className="size-3.5" />
                    </button>
                  </div>
                  <Textarea
                    id="ticket-instructions"
                    value={ticket.additionalInstructions}
                    placeholder='e.g. "Assign to Nat Hartman and mark as To Do"'
                    className="min-h-20"
                    spellCheck={false}
                    onChange={(e) => patch({ additionalInstructions: e.target.value })}
                  />
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => patch({ additionalInstructions: "" })}
                  className="inline-flex items-center gap-1.5 rounded-md text-sm text-muted-foreground transition-colors duration-150 ease-out hover:text-foreground"
                >
                  <Plus className="size-3.5" />
                  Additional instructions
                </button>
              )
            )}

            {/* Timestamp + Screenshot */}
            {(ticket.suggestedTimestampMs || ticket.timestampContext) && (
              <>
                <Separator />
                <div className="space-y-3">
                  <div className="space-y-1">
                    {ticket.suggestedTimestampMs != null && (
                      <p className="text-sm">
                        <span className="text-muted-foreground">Timestamp in recording: </span>
                        <span className="font-medium tabular-nums">
                          {Math.floor(ticket.suggestedTimestampMs / 60000)}:
                          {String(
                            Math.floor((ticket.suggestedTimestampMs % 60000) / 1000)
                          ).padStart(2, "0")}
                        </span>
                      </p>
                    )}
                    {ticket.timestampContext && (
                      <p className="text-sm text-muted-foreground">
                        {ticket.timestampContext}
                      </p>
                    )}
                  </div>

                  <div className="space-y-2">
                    {screenshot ? (
                      <div className="flex items-start gap-3">
                        <ScreenshotPreview src={screenshot} />
                        {!isFiled && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => onCaptureScreenshot(activeIndex)}
                          >
                            Recapture
                          </Button>
                        )}
                      </div>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => onCaptureScreenshot(activeIndex)}
                        disabled={isFiled}
                      >
                        Capture screenshot
                      </Button>
                    )}
                    {screenshotWarnings[String(activeIndex)] && (
                      <div className="flex items-start justify-between gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 dark:border-amber-800 dark:bg-amber-950/30">
                        <p className="text-xs text-amber-800 dark:text-amber-300">
                          Screenshot may not match: {screenshotWarnings[String(activeIndex)]}
                        </p>
                        <button
                          onClick={() => onDismissWarning(String(activeIndex))}
                          className="shrink-0 text-xs text-amber-600 hover:text-amber-800 dark:text-amber-400 dark:hover:text-amber-200"
                          aria-label="Dismiss warning"
                        >
                          &times;
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
        </ScrollArea>

        {/* Action bar */}
        <div className="flex items-center justify-between border-t px-6 py-3">
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={activeIndex === 0}
              onClick={() => setActiveIndex((i) => Math.max(0, i - 1))}
            >
              &larr; Prev
            </Button>
            <span className="text-xs text-muted-foreground tabular-nums">
              {activeIndex + 1} / {tickets.length}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={activeIndex === tickets.length - 1}
              onClick={() =>
                setActiveIndex((i) => Math.min(tickets.length - 1, i + 1))
              }
            >
              Next &rarr;
            </Button>
          </div>

          <div className="flex items-center gap-2">
            {ticket.ticketStatus === "pending" && (
              <>
                <Button variant="outline" onClick={handleSkip}>
                  Skip
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setPainPointOpen(true)}
                >
                  Log pain point
                </Button>
                <Button onClick={handleFile} disabled={filing}>
                  {filing ? "Filing…" : "File to Jira"}
                </Button>
              </>
            )}
            {ticket.ticketStatus === "skipped" && (
              <Button variant="outline" onClick={handleUnskip}>
                Restore
              </Button>
            )}
            {ticket.ticketStatus === "filed" && ticket.filedUrl && (
              <Button
                variant="outline"
                onClick={() => window.open(ticket.filedUrl, "_blank")}
              >
                Open in Jira
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Pain point dialog */}
      <LogPainPointDialog
        open={painPointOpen}
        onClose={() => setPainPointOpen(false)}
        onLogged={() => {
          onTicketChange(activeIndex, {
            ...ticket,
            loggedAsPainPoint: true,
            ticketStatus: "pain-point",
          });
          advanceToNextPending();
        }}
        defaults={{
          severity: ticket.priority,
          sessionDate: sessionMetadata.sessionDate,
          participantName: sessionMetadata.participantName,
          sourceTicketTitle: ticket.title,
          sourceTicketDescription: ticket.description,
          zoomLink: sessionMetadata.zoomLink,
          zoomPasscode: sessionMetadata.zoomPasscode,
          suggestedTimestampMs: ticket.suggestedTimestampMs,
        }}
      />
    </div>
  );
}
