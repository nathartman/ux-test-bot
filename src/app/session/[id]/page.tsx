"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useRouter, useParams } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ProcessingStatusIndicator } from "@/components/processing-status";
import { NotesEditor } from "@/components/notes-editor";
import { TicketReviewer } from "@/components/ticket-reviewer";
import { VideoCapture } from "@/components/video-capture";
import {
  getSession,
  saveSession,
  deleteSession,
  uploadScreenshot,
  getScreenshotUrls,
} from "@/lib/storage";
import { PRIORITY_OPTIONS } from "@/lib/jira-config";
import { Textarea } from "@/components/ui/textarea";
import {
  Bug,
  SquareCheckBig,
  ArrowUp,
  FileText,
  ExternalLink,
  CircleDot,
  SkipForward,
  Mail,
  Copy,
  Check,
} from "lucide-react";
import type {
  SessionStore,
  TranscriptData,
  TicketProposal,
} from "@/lib/types";

const ISSUE_TYPE_ICON: Record<
  TicketProposal["type"],
  { icon: React.ComponentType<{ className?: string }>; className: string }
> = {
  Bug: { icon: Bug, className: "text-red-600 dark:text-red-400" },
  Task: { icon: SquareCheckBig, className: "text-blue-600 dark:text-blue-400" },
  Improvement: { icon: ArrowUp, className: "text-green-600 dark:text-green-400" },
  Investigation: { icon: FileText, className: "text-orange-600 dark:text-orange-400" },
};

const POLL_INTERVAL_MS = 5_000;
const AUTOSAVE_DELAY_MS = 2_000;

export default function SessionPage() {
  const router = useRouter();
  const params = useParams();
  const sessionId = params.id as string;
  const [session, setSession] = useState<SessionStore | null>(null);
  const [loading, setLoading] = useState(true);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const analyzingRef = useRef(false);
  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [emailStep, setEmailStep] = useState<"hidden" | "select" | "draft">("hidden");
  const [emailSelected, setEmailSelected] = useState<Set<number>>(new Set());
  const [emailDraft, setEmailDraft] = useState<string | null>(null);
  const [emailLoading, setEmailLoading] = useState(false);
  const [emailCopied, setEmailCopied] = useState(false);

  const loadSession = useCallback(async () => {
    const s = await getSession(sessionId);
    if (!s) {
      router.replace("/");
      return;
    }
    setSession(s);

    const urls = await getScreenshotUrls(sessionId);
    if (Object.keys(urls).length > 0) {
      setScreenshotUrls(urls);
    }

    const storedUrl = sessionStorage.getItem("videoObjectUrl");
    if (storedUrl) {
      try {
        const probe = await fetch(storedUrl);
        if (probe.ok) {
          setVideoUrl(storedUrl);
        } else {
          sessionStorage.removeItem("videoObjectUrl");
        }
      } catch {
        sessionStorage.removeItem("videoObjectUrl");
      }
    }

    setLoading(false);
  }, [router, sessionId]);

  useEffect(() => {
    loadSession();
  }, [loadSession]);

  // --- Debounced auto-save ---

  const scheduleAutosave = useCallback(
    (patch: Partial<SessionStore>) => {
      if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
      autosaveTimer.current = setTimeout(async () => {
        await saveSession(sessionId, patch);
      }, AUTOSAVE_DELAY_MS);
    },
    [sessionId]
  );

  // --- Transcription polling ---

  const pollTranscription = useCallback(async () => {
    if (!session?.transcriptId) return;

    try {
      const res = await fetch(`/api/transcribe/${session.transcriptId}`);
      if (!res.ok) throw new Error(`Poll failed: ${res.status}`);

      const data = await res.json();

      if (data.status === "completed") {
        if (pollingRef.current) {
          clearInterval(pollingRef.current);
          pollingRef.current = null;
        }

        const transcript: TranscriptData = {
          utterances: data.utterances ?? [],
          words: data.words ?? [],
          text: data.text ?? "",
        };

        await saveSession(sessionId, { transcript, status: "analyzing" });
        setSession((prev) =>
          prev ? { ...prev, transcript, status: "analyzing" } : prev
        );
        toast.success("Transcription complete");
      } else if (data.status === "error") {
        if (pollingRef.current) {
          clearInterval(pollingRef.current);
          pollingRef.current = null;
        }
        toast.error("Transcription failed. Please try again.");
      }
    } catch (err) {
      console.error("Polling error:", err);
    }
  }, [session?.transcriptId, sessionId]);

  useEffect(() => {
    if (session?.status !== "transcribing" || !session.transcriptId) return;

    pollTranscription();
    pollingRef.current = setInterval(pollTranscription, POLL_INTERVAL_MS);

    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    };
  }, [session?.status, session?.transcriptId, pollTranscription]);

  // --- Generate notes (step 1 of analysis) ---

  const runAnalysis = useCallback(async () => {
    if (!session?.transcript || analyzingRef.current) return;
    analyzingRef.current = true;

    const payload = {
      transcript: session.transcript,
      facilitatorNotes: session.facilitatorNotes,
      participantName: session.metadata.participantName,
      sessionDate: session.metadata.sessionDate,
      zoomLink: session.metadata.zoomLink,
      zoomPasscode: session.metadata.zoomPasscode,
    };

    try {
      // Phase 1: Generate summary notes (overview, pain points, ideas)
      const summaryRes = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, phase: "summary" }),
      });

      if (!summaryRes.ok) {
        const body = await summaryRes.json().catch(() => ({}));
        throw new Error(
          (body as { error?: string }).error ||
            `Summary generation failed: ${summaryRes.status}`
        );
      }

      const { notes: summaryNotes } = await summaryRes.json();

      // Phase 2: Generate detailed session notes (chronological with quotes)
      const detailedRes = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, phase: "detailed", summaryNotes }),
      });

      if (!detailedRes.ok) {
        const body = await detailedRes.json().catch(() => ({}));
        throw new Error(
          (body as { error?: string }).error ||
            `Detailed notes generation failed: ${detailedRes.status}`
        );
      }

      const { notes: detailedNotes } = await detailedRes.json();

      // Combine: summary sections + divider + detailed notes
      const combinedNotes = `${summaryNotes}\n\n---\n\n${detailedNotes}`;

      await saveSession(sessionId, {
        notesMarkdown: combinedNotes,
        status: "reviewing-notes",
      });

      setSession((prev) =>
        prev
          ? {
              ...prev,
              notesMarkdown: combinedNotes,
              status: "reviewing-notes",
            }
          : prev
      );

      toast.success("Session notes generated");
    } catch (err) {
      console.error("Analysis error:", err);
      toast.error(
        err instanceof Error ? err.message : "Notes generation failed"
      );
      // Reset status so user can retry
      await saveSession(sessionId, { status: "analyze-failed" });
      setSession((prev) =>
        prev ? { ...prev, status: "analyze-failed" } : prev
      );
      analyzingRef.current = false;
    }
  }, [session, sessionId]);

  useEffect(() => {
    if (session?.status === "analyzing" && session.transcript) {
      runAnalysis();
    }
  }, [session?.status, session?.transcript, runAnalysis]);

  // --- Notes handlers ---

  const handleNotesChange = useCallback(
    (value: string) => {
      setSession((prev) =>
        prev ? { ...prev, notesMarkdown: value } : prev
      );
      scheduleAutosave({ notesMarkdown: value });
    },
    [scheduleAutosave]
  );

  // --- Generate tickets (step 2, after notes are edited) ---

  const generatingTicketsRef = useRef(false);

  const handleDoneNotes = useCallback(async () => {
    if (!session?.transcript || generatingTicketsRef.current) return;
    generatingTicketsRef.current = true;

    await saveSession(sessionId, { status: "generating-tickets" });
    setSession((prev) =>
      prev ? { ...prev, status: "generating-tickets" } : prev
    );

    try {
      const res = await fetch("/api/generate-tickets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          editedNotes: session.notesMarkdown,
          transcript: session.transcript,
          participantName: session.metadata.participantName,
          sessionDate: session.metadata.sessionDate,
          zoomLink: session.metadata.zoomLink,
          zoomPasscode: session.metadata.zoomPasscode,
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(
          (body as { error?: string }).error ||
            `Ticket generation failed: ${res.status}`
        );
      }

      const { tickets } = await res.json();

      await saveSession(sessionId, {
        tickets,
        proposedTickets: JSON.parse(JSON.stringify(tickets)),
        status: "reviewing-tickets",
      });
      setSession((prev) =>
        prev
          ? {
              ...prev,
              tickets,
              proposedTickets: JSON.parse(JSON.stringify(tickets)),
              status: "reviewing-tickets",
            }
          : prev
      );

      toast.success("Tickets generated from your notes");
    } catch (err) {
      console.error("Ticket generation error:", err);
      toast.error(
        err instanceof Error ? err.message : "Ticket generation failed"
      );
      await saveSession(sessionId, { status: "reviewing-notes" });
      setSession((prev) =>
        prev ? { ...prev, status: "reviewing-notes" } : prev
      );
      generatingTicketsRef.current = false;
    }
  }, [session, sessionId]);

  // --- Ticket handlers ---

  const handleTicketChange = useCallback(
    (index: number, ticket: TicketProposal) => {
      setSession((prev) => {
        if (!prev) return prev;
        const tickets = [...prev.tickets];
        tickets[index] = ticket;
        return { ...prev, tickets };
      });
      setSession((prev) => {
        if (prev) scheduleAutosave({ tickets: prev.tickets });
        return prev;
      });
    },
    [scheduleAutosave]
  );

  // --- Screenshot capture ---

  const [captureTarget, setCaptureTarget] = useState<number | null>(null);
  const [screenshotUrls, setScreenshotUrls] = useState<Record<string, string>>({});
  const [screenshotBlobs, setScreenshotBlobs] = useState<Record<string, Blob>>({});
  const [screenshotWarnings, setScreenshotWarnings] = useState<
    Record<string, string>
  >({});

  const handleCaptureScreenshot = useCallback((ticketIndex: number) => {
    setCaptureTarget(ticketIndex);
  }, []);

  const handleScreenshotCaptured = useCallback(
    async (blob: Blob) => {
      if (captureTarget === null) return;

      const key = String(captureTarget);
      setScreenshotBlobs((prev) => ({ ...prev, [key]: blob }));
      setCaptureTarget(null);

      try {
        const url = await uploadScreenshot(sessionId, captureTarget, blob);
        setScreenshotUrls((prev) => ({ ...prev, [key]: url }));
      } catch (err) {
        console.error("Failed to upload screenshot:", err);
      }

      const ticket = session?.tickets[captureTarget];
      if (ticket) {
        try {
          const reader = new FileReader();
          const base64 = await new Promise<string>((resolve) => {
            reader.onloadend = () => {
              const result = reader.result as string;
              resolve(result.split(",")[1]);
            };
            reader.readAsDataURL(blob);
          });

          const res = await fetch("/api/validate-screenshot", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              screenshotBase64: base64,
              ticket: {
                title: ticket.title,
                description: ticket.description,
                timestampContext: ticket.timestampContext,
              },
            }),
          });

          if (res.ok) {
            const result = await res.json();
            if (!result.valid) {
              setScreenshotWarnings((prev) => ({
                ...prev,
                [key]: result.reason,
              }));
            } else {
              setScreenshotWarnings((prev) => {
                const next = { ...prev };
                delete next[key];
                return next;
              });
            }
          }
        } catch {
          // Validation is best-effort
        }
      }
    },
    [captureTarget, sessionId, session?.tickets]
  );


  // --- File single ticket ---

  const handleFileTicket = useCallback(
    async (index: number) => {
      if (!session) return;
      const ticket = session.tickets[index];

      const screenshotBlob = screenshotBlobs[String(index)];
      const screenshotEntries: Record<string, string> = {};
      if (screenshotBlob) {
        const base64 = await new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => {
            const result = reader.result as string;
            resolve(result.split(",")[1]);
          };
          reader.readAsDataURL(screenshotBlob);
        });
        screenshotEntries["0"] = base64;
      }

      const res = await fetch("/api/file-tickets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tickets: [{ ...ticket, included: true }],
          screenshots: screenshotEntries,
          zoomLink: session.metadata.zoomLink,
          zoomPasscode: session.metadata.zoomPasscode,
          sessionDate: session.metadata.sessionDate,
          participantName: session.metadata.participantName,
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(
          (body as { error?: string }).error || `Filing failed: ${res.status}`
        );
      }

      const results = (await res.json()) as Array<{
        ticketKey: string;
        url: string;
        success: boolean;
        error?: string;
      }>;

      const r = results[0];
      if (!r?.success) {
        throw new Error(r?.error || "Jira ticket creation failed");
      }

      toast.success(`Created ${r.ticketKey}`, {
        action: {
          label: "Open",
          onClick: () => window.open(r.url, "_blank"),
        },
      });

      const updatedTicket: TicketProposal = {
        ...ticket,
        ticketStatus: "filed",
        filedKey: r.ticketKey,
        filedUrl: r.url,
        included: false,
      };

      setSession((prev) => {
        if (!prev) return prev;
        const tickets = [...prev.tickets];
        tickets[index] = updatedTicket;
        return { ...prev, tickets };
      });

      await saveSession(sessionId, {
        tickets: session.tickets.map((t, i) =>
          i === index ? updatedTicket : t
        ),
      });
    },
    [session, sessionId, screenshotBlobs]
  );

  // --- Check if all tickets are done ---

  const allTicketsDone =
    session?.tickets.every(
      (t) => t.ticketStatus !== "pending"
    ) ?? false;

  const filedCount =
    session?.tickets.filter((t) => t.ticketStatus === "filed").length ?? 0;
  const painPointCount =
    session?.tickets.filter((t) => t.ticketStatus === "pain-point").length ?? 0;
  const skippedCount =
    session?.tickets.filter((t) => t.ticketStatus === "skipped").length ?? 0;

  // --- Finish session: learn from edits ---

  const handleFinishSession = useCallback(async () => {
    if (!session) return;

    await saveSession(sessionId, { status: "learning" });
    setSession((prev) =>
      prev ? { ...prev, status: "learning" } : prev
    );

    try {
      const proposed = (session.proposedTickets ?? []).map((t) => ({
        title: t.title,
        type: t.type,
        priority: t.priority,
        teams: t.teams,
        description: t.description,
      }));

      const actual = session.tickets
        .filter((t) => t.ticketStatus !== "skipped")
        .map((t) => ({
          title: t.title,
          type: t.type,
          priority: t.priority,
          teams: t.teams,
          description: t.description,
          ticketStatus: t.ticketStatus,
          loggedAsPainPoint: t.loggedAsPainPoint,
        }));

      const res = await fetch("/api/learn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          proposedTickets: proposed,
          actualTickets: actual,
          sessionDate: session.metadata.sessionDate,
          participantName: session.metadata.participantName,
        }),
      });

      if (res.ok) {
        const { learnings } = await res.json();
        if (learnings.length > 0) {
          toast.success(
            `${learnings.length} learning${learnings.length !== 1 ? "s" : ""} saved for next session`
          );
        }
      }
    } catch (err) {
      console.error("Learning failed:", err);
    }

    await saveSession(sessionId, { status: "filed", learningCompleted: true });
    setSession((prev) =>
      prev ? { ...prev, status: "filed", learningCompleted: true } : prev
    );
  }, [session, sessionId]);

  // --- Render ---

  if (loading) return null;
  if (!session) return null;

  // Processing states
  if (
    session.status === "uploading" ||
    session.status === "transcribing" ||
    session.status === "analyzing" ||
    session.status === "analyze-failed" ||
    session.status === "generating-tickets" ||
    session.status === "learning"
  ) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center px-4">
        <div className="w-full max-w-md space-y-6">
          <div>
            <h1 className="text-lg font-medium text-balance">
              Processing session
            </h1>
            <p className="text-sm text-muted-foreground">
              {session.metadata.participantName} &mdash;{" "}
              {session.metadata.sessionDate || "No date"}
            </p>
          </div>

          <ProcessingStatusIndicator status={session.status} />

          {session.status === "transcribing" && (
            <p className="text-xs text-muted-foreground">
              Polling every 5 seconds. You can leave this tab open.
            </p>
          )}

          {session.status === "analyzing" && (
            <p className="text-xs text-muted-foreground">
              Generating session notes. This may take 60&ndash;90 seconds.
            </p>
          )}

          {session.status === "analyze-failed" && (
            <div className="space-y-2">
              <p className="text-xs text-destructive">
                Notes generation failed. This can happen with long transcripts.
              </p>
              <button
                className="text-sm underline text-primary"
                onClick={() => {
                  analyzingRef.current = false;
                  saveSession(sessionId, { status: "analyzing" });
                  setSession((prev) =>
                    prev ? { ...prev, status: "analyzing" } : prev
                  );
                }}
              >
                Retry
              </button>
            </div>
          )}

          {session.status === "generating-tickets" && (
            <p className="text-xs text-muted-foreground">
              Generating tickets from your edited notes. This may take
              30&ndash;60 seconds.
            </p>
          )}
        </div>
      </main>
    );
  }

  // Phase 1: Notes review (full-width)
  if (session.status === "reviewing-notes") {
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
            <span className="text-sm text-muted-foreground">
              {session.metadata.participantName} &mdash;{" "}
              {session.metadata.sessionDate || "No date"}
            </span>
          </div>
          <Button size="sm" onClick={handleDoneNotes}>
            Done editing &rarr; Generate tickets
          </Button>
        </header>
        <div className="flex-1 overflow-hidden">
          <NotesEditor
            value={session.notesMarkdown}
            onChange={handleNotesChange}
          />
        </div>
      </div>
    );
  }

  // Phase 2: Ticket review (one by one)
  if (session.status === "reviewing-tickets") {
    return (
      <div className="flex h-screen flex-col">
        {/* Summary banner when all done */}
        {allTicketsDone && (
          <div className="flex items-center justify-between bg-muted px-4 py-3">
            <p className="text-sm">
              All done. {filedCount} filed
              {painPointCount > 0 &&
                `, ${painPointCount} pain point${painPointCount !== 1 ? "s" : ""}`}
              {skippedCount > 0 &&
                `, ${skippedCount} skipped`}
              .
            </p>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={async () => {
                  await saveSession(sessionId, { status: "reviewing-notes" });
                  setSession((prev) =>
                    prev ? { ...prev, status: "reviewing-notes" } : prev
                  );
                }}
              >
                &larr; Back to notes
              </Button>
              <Button
                size="sm"
                onClick={
                  session.learningCompleted
                    ? async () => {
                        await saveSession(sessionId, { status: "filed" });
                        setSession((prev) =>
                          prev ? { ...prev, status: "filed" } : prev
                        );
                      }
                    : handleFinishSession
                }
              >
                {session.learningCompleted ? "View summary" : "Finish session"}
              </Button>
            </div>
          </div>
        )}

        <header className="flex items-center justify-between border-b px-4 py-2">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={async () => {
                await saveSession(sessionId, { status: "reviewing-notes" });
                setSession((prev) =>
                  prev ? { ...prev, status: "reviewing-notes" } : prev
                );
              }}
            >
              &larr; Back to notes
            </Button>
            <span className="text-sm text-muted-foreground">
              {session.metadata.participantName} &mdash;{" "}
              {session.metadata.sessionDate || "No date"}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {videoUrl && (
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span className="size-1.5 rounded-full bg-green-500" />
                Video loaded
              </span>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                const input = document.createElement("input");
                input.type = "file";
                input.accept = ".mp4";
                input.onchange = (e) => {
                  const file = (e.target as HTMLInputElement).files?.[0];
                  if (file) {
                    if (videoUrl) URL.revokeObjectURL(videoUrl);
                    const url = URL.createObjectURL(file);
                    sessionStorage.setItem("videoObjectUrl", url);
                    setVideoUrl(url);
                  }
                };
                input.click();
              }}
            >
              {videoUrl ? "Change video" : "Load video for screenshots"}
            </Button>
          </div>
        </header>

        <div className="flex-1 overflow-hidden">
          <TicketReviewer
            tickets={session.tickets}
            onTicketChange={handleTicketChange}
            onFileTicket={handleFileTicket}
            onCaptureScreenshot={handleCaptureScreenshot}
            screenshots={{ ...screenshotUrls, ...screenshotBlobs }}
            onRemoveScreenshot={(key) => {
              setScreenshotUrls((prev) => {
                const next = { ...prev };
                delete next[key];
                return next;
              });
              setScreenshotBlobs((prev) => {
                const next = { ...prev };
                delete next[key];
                return next;
              });
              setScreenshotWarnings((prev) => {
                const next = { ...prev };
                delete next[key];
                return next;
              });
            }}
            screenshotWarnings={screenshotWarnings}
            onDismissWarning={(key) =>
              setScreenshotWarnings((prev) => {
                const next = { ...prev };
                delete next[key];
                return next;
              })
            }
            sessionMetadata={session.metadata}
          />
        </div>

        {/* Video capture dialog */}
        {videoUrl &&
          captureTarget !== null &&
          session.tickets[captureTarget] && (
            <VideoCapture
              open
              videoUrl={videoUrl}
              ticket={session.tickets[captureTarget]}
              onCapture={handleScreenshotCaptured}
              onClose={() => setCaptureTarget(null)}
              onUpdateTimestamp={(ms) => {
                handleTicketChange(captureTarget, {
                  ...session.tickets[captureTarget],
                  suggestedTimestampMs: ms,
                });
              }}
              existingScreenshot={
                screenshotBlobs[String(captureTarget)] ?? null
              }
            />
          )}
      </div>
    );
  }

  // Filed: summary
  const filedTickets = session.tickets.filter(
    (t) => t.ticketStatus === "filed" && t.filedUrl
  );
  const painPointTickets = session.tickets.filter(
    (t) => t.ticketStatus === "pain-point"
  );
  const selectableTickets = session.tickets
    .map((t, i) => ({ ticket: t, originalIndex: i }))
    .filter(
      ({ ticket: t }) =>
        (t.ticketStatus === "filed" && t.filedUrl) ||
        t.ticketStatus === "pain-point"
    );

  function toggleEmailSelection(index: number) {
    setEmailSelected((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  // Ticket row component used in both summary and selection screens
  function TicketRow({
    ticket: t,
    selectable,
    selected,
    onToggle,
  }: {
    ticket: TicketProposal;
    selectable?: boolean;
    selected?: boolean;
    onToggle?: () => void;
  }) {
    const isPainPoint = t.ticketStatus === "pain-point";
    const typeInfo = ISSUE_TYPE_ICON[t.type];
    const TypeIcon = typeInfo.icon;
    const priority = PRIORITY_OPTIONS.find((p) => p.id === t.priorityId);

    const rowClass = selectable
      ? `flex w-full items-start gap-3 px-4 py-3 text-left cursor-pointer transition-colors duration-150 ease-out ${
          selected ? "bg-accent" : "hover:bg-muted/50"
        }`
      : "flex w-full items-start gap-3 px-4 py-3 text-left transition-colors duration-150 ease-out hover:bg-muted/50";

    const content = (
      <>
        {selectable ? (
          <div
            className={`flex size-5 shrink-0 items-center justify-center rounded border transition-colors duration-150 ease-out ${
              selected
                ? "border-primary bg-primary text-primary-foreground"
                : "border-muted-foreground/30"
            }`}
          >
            {selected && <Check className="size-3.5" />}
          </div>
        ) : isPainPoint ? (
          <CircleDot className="size-4 shrink-0 text-violet-500" />
        ) : (
          <TypeIcon className={`size-4 shrink-0 ${typeInfo.className}`} />
        )}
        <div className="flex-1 min-w-0 space-y-1">
          <p className="text-sm font-medium leading-snug">{t.title}</p>
          <div className="flex flex-wrap items-center gap-1.5">
            {isPainPoint ? (
              <span className="inline-flex items-center gap-1 rounded border border-violet-200 dark:border-violet-800 px-1.5 py-0.5 text-xs text-violet-600 dark:text-violet-400">
                Pain point
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded border border-border/60 px-1.5 py-0.5 text-xs font-medium font-mono text-muted-foreground">
                <TypeIcon className={`size-3 ${typeInfo.className}`} />
                {t.filedKey}
              </span>
            )}
            {t.teams.map((team) => (
              <span key={team} className="inline-flex items-center rounded border border-border/60 px-1.5 py-0.5 text-xs text-muted-foreground">
                {team}
              </span>
            ))}
            {priority && priority.id !== "5" && (
              <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium ${priority.color}`}>
                {priority.shortLabel}
              </span>
            )}
          </div>
        </div>
        {!selectable && !isPainPoint && (
          <ExternalLink className="size-3.5 shrink-0 text-muted-foreground/50" />
        )}
      </>
    );

    if (selectable) {
      return (
        <button type="button" onClick={onToggle} className={rowClass}>
          {content}
        </button>
      );
    }

    if (!isPainPoint && t.filedUrl) {
      return (
        <a href={t.filedUrl} target="_blank" rel="noopener noreferrer" className={rowClass}>
          {content}
        </a>
      );
    }

    return <div className={rowClass}>{content}</div>;
  }

  // --- Email selection screen ---
  if (emailStep === "select") {
    return (
      <main className="flex min-h-screen flex-col items-center px-4 py-16">
        <div className="w-full max-w-2xl space-y-6">
          <div className="space-y-1">
            <h1 className="text-lg font-semibold">Select key takeaways</h1>
            <p className="text-sm text-muted-foreground">
              Choose the issues you want the email to focus on.
            </p>
          </div>

          <div className="divide-y rounded-lg border">
            {selectableTickets.map(({ ticket, originalIndex }) => (
              <TicketRow
                key={originalIndex}
                ticket={ticket}
                selectable
                selected={emailSelected.has(originalIndex)}
                onToggle={() => toggleEmailSelection(originalIndex)}
              />
            ))}
          </div>

          <div className="flex gap-2 pt-2">
            <Button
              variant="outline"
              onClick={() => {
                setEmailStep("hidden");
                setEmailSelected(new Set());
              }}
            >
              Cancel
            </Button>
            <Button
              disabled={emailSelected.size === 0 || emailLoading}
              onClick={async () => {
                setEmailLoading(true);
                try {
                  const allFiled = session.tickets
                    .filter((t) => t.ticketStatus === "filed")
                    .map((t) => ({
                      title: t.title,
                      type: t.type,
                      teams: t.teams,
                      priority: t.priority,
                      filedKey: t.filedKey,
                    }));
                  const highlighted = Array.from(emailSelected).map((i) => {
                    const t = session.tickets[i];
                    return {
                      title: t.title,
                      type: t.type,
                      teams: t.teams,
                      priority: t.priority,
                      filedKey: t.filedKey,
                      description: t.description,
                      isPainPoint: t.ticketStatus === "pain-point",
                    };
                  });
                  const res = await fetch("/api/generate-email", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      notes: session.notesMarkdown,
                      tickets: allFiled,
                      highlightedIssues: highlighted,
                      participantName: session.metadata.participantName,
                      sessionDate: session.metadata.sessionDate,
                    }),
                  });
                  if (!res.ok) throw new Error("Failed to generate email");
                  const data = await res.json();
                  setEmailDraft(data.email);
                  setEmailStep("draft");
                } catch (err) {
                  toast.error(
                    err instanceof Error ? err.message : "Failed to generate email"
                  );
                } finally {
                  setEmailLoading(false);
                }
              }}
            >
              <Mail className="size-4" />
              {emailLoading
                ? "Generating…"
                : `Generate email (${emailSelected.size} selected)`}
            </Button>
          </div>
        </div>
      </main>
    );
  }

  // --- Email draft screen ---
  if (emailStep === "draft" && emailDraft !== null) {
    return (
      <main className="flex min-h-screen flex-col items-center px-4 py-16">
        <div className="w-full max-w-2xl space-y-6">
          <div className="space-y-1">
            <h1 className="text-lg font-semibold">Email draft</h1>
            <p className="text-sm text-muted-foreground">
              Edit as needed, then copy and paste into your email.
            </p>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-end">
              <Button
                variant="ghost"
                size="sm"
                className="h-7 gap-1.5 text-xs"
                onClick={() => {
                  navigator.clipboard.writeText(emailDraft);
                  setEmailCopied(true);
                  setTimeout(() => setEmailCopied(false), 2000);
                }}
              >
                {emailCopied ? (
                  <Check className="size-3" />
                ) : (
                  <Copy className="size-3" />
                )}
                {emailCopied ? "Copied" : "Copy"}
              </Button>
            </div>
            <Textarea
              value={emailDraft}
              onChange={(e) => setEmailDraft(e.target.value)}
              className="min-h-80 font-mono text-xs leading-relaxed"
              spellCheck={false}
            />
          </div>

          <div className="flex gap-2 pt-2">
            <Button
              variant="outline"
              onClick={() => {
                setEmailStep("hidden");
                setEmailDraft(null);
                setEmailSelected(new Set());
              }}
            >
              Back to summary
            </Button>
          </div>
        </div>
      </main>
    );
  }

  // --- Summary screen ---
  return (
    <main className="flex min-h-screen flex-col items-center px-4 py-16">
      <div className="w-full max-w-xl space-y-8">
        <div className="space-y-2 text-center">
          <h1 className="text-lg font-semibold text-balance">Session complete</h1>
          <p className="text-sm text-muted-foreground">
            {session.metadata.participantName} &mdash; {session.metadata.sessionDate}
          </p>
        </div>

        {/* Stats row */}
        <div className="flex justify-center gap-6">
          {[
            { label: "Filed", value: filedCount, icon: SquareCheckBig, color: "text-green-600 dark:text-green-400" },
            { label: "Pain points", value: painPointCount, icon: CircleDot, color: "text-violet-600 dark:text-violet-400" },
            { label: "Skipped", value: skippedCount, icon: SkipForward, color: "text-muted-foreground" },
          ].map((stat) => {
            const Icon = stat.icon;
            return (
              <div key={stat.label} className="flex items-center gap-2 text-sm">
                <Icon className={`size-4 ${stat.color}`} />
                <span className="tabular-nums font-medium">{stat.value}</span>
                <span className="text-muted-foreground">{stat.label}</span>
              </div>
            );
          })}
        </div>

        {/* Filed tickets */}
        {filedTickets.length > 0 && (
          <div className="space-y-2">
            <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Filed tickets
            </h2>
            <div className="divide-y rounded-lg border">
              {filedTickets.map((t) => (
                <TicketRow key={t.filedKey} ticket={t} />
              ))}
            </div>
          </div>
        )}

        {/* Pain points */}
        {painPointTickets.length > 0 && (
          <div className="space-y-2">
            <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Pain points logged
            </h2>
            <div className="divide-y rounded-lg border">
              {painPointTickets.map((t, i) => (
                <TicketRow key={i} ticket={t} />
              ))}
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="flex justify-center gap-2 pt-2">
          <Button
            variant="outline"
            onClick={async () => {
              await saveSession(sessionId, { status: "reviewing-tickets" });
              setSession((prev) =>
                prev ? { ...prev, status: "reviewing-tickets" } : prev
              );
            }}
          >
            Back to tickets
          </Button>
          <Button
            variant="outline"
            onClick={() => setEmailStep("select")}
          >
            <Mail className="size-4" />
            Generate email
          </Button>
          <Button
            onClick={async () => {
              await deleteSession(sessionId);
              router.push("/");
            }}
          >
            Clear session
          </Button>
        </div>
      </div>
    </main>
  );
}
