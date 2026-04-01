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
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [copied, setCopied] = useState(false);
  const [selectedTickets, setSelectedTickets] = useState<Set<number>>(new Set());

  // Load session on mount
  useEffect(() => {
    const loadSession = async () => {
      try {
        const sessionData = await getSession(sessionId);
        if (sessionData) {
          setSession(sessionData);
          // Load screenshot URLs
          if (sessionData.screenshots && sessionData.screenshots.length > 0) {
            const urls = await getScreenshotUrls(sessionData.screenshots);
            if (urls && urls.length > 0) {
              setVideoUrl(urls[0]);
              setThumbnailUrl(urls[0]);
            }
          }
        }
      } catch (error) {
        console.error("Failed to load session:", error);
        toast.error("Failed to load session");
      } finally {
        setLoading(false);
      }
    };

    loadSession();
  }, [sessionId]);

  // Setup polling
  useEffect(() => {
    if (!session) return;

    const poll = async () => {
      try {
        const updated = await getSession(sessionId);
        if (updated) {
          setSession(updated);
        }
      } catch (error) {
        console.error("Poll error:", error);
      }
    };

    pollingRef.current = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, [sessionId, session]);

  // Autosave mechanism
  useEffect(() => {
    if (!session) return;

    // Clear existing timer
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current);

    // Set new timer
    autosaveTimer.current = setTimeout(async () => {
      try {
        await saveSession(sessionId, session);
      } catch (error) {
        console.error("Autosave failed:", error);
      }
    }, AUTOSAVE_DELAY_MS);

    return () => {
      if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    };
  }, [session, sessionId]);

  const handleTitleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (session) {
      setSession({ ...session, title: e.target.value });
    }
  };

  const handleSessionNotesChange = (value: string) => {
    if (session) {
      setSession({ ...session, sessionNotes: value });
    }
  };

  const handleAnalysisNotesChange = (value: string) => {
    if (session) {
      setSession({ ...session, analysisNotes: value });
    }
  };

  const handleTicketsChange = (tickets: TicketProposal[]) => {
    if (session) {
      setSession({ ...session, tickets });
    }
  };

  const runAnalysis = useCallback(async () => {
    if (!session?.transcript) {
      toast.error("No transcript available");
      return;
    }

    analyzingRef.current = true;

    try {
      // Phase 1: Summary generation
      toast.loading("Generating summary analysis...");

      const summaryResponse = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transcript: session.transcript,
          phase: "summary",
        }),
      });

      if (!summaryResponse.ok) {
        throw new Error(`Phase 1 failed: ${summaryResponse.statusText}`);
      }

      const summaryData = (await summaryResponse.json()) as {
        analysis: string;
        tickets: TicketProposal[];
      };

      // Phase 2: Detailed notes
      toast.loading("Generating detailed notes...");

      const detailedResponse = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transcript: session.transcript,
          phase: "detailed",
        }),
      });

      if (!detailedResponse.ok) {
        throw new Error(`Phase 2 failed: ${detailedResponse.statusText}`);
      }

      const detailedData = (await detailedResponse.json()) as {
        analysis: string;
      };

      // Combine results
      const combinedAnalysis = `${summaryData.analysis}\n\n---\n\n${detailedData.analysis}`;

      // Update session
      const updatedSession = {
        ...session,
        analysisNotes: combinedAnalysis,
        tickets: summaryData.tickets,
        lastAnalyzed: new Date().toISOString(),
      };

      setSession(updatedSession);

      // Save immediately
      await saveSession(sessionId, updatedSession);

      toast.success("Analysis complete");
    } catch (error) {
      console.error("Analysis error:", error);
      toast.error(
        error instanceof Error ? error.message : "Analysis failed"
      );
    } finally {
      analyzingRef.current = false;
    }
  }, [session, sessionId]);

  const handleSaveScreenshot = useCallback(
    async (blob: Blob) => {
      try {
        if (!session) return;

        // Upload screenshot
        const fileName = `screenshot-${Date.now()}.png`;
        await uploadScreenshot(sessionId, blob, fileName);

        // Get URL and add to session
        const urls = await getScreenshotUrls([fileName]);
        if (urls && urls.length > 0) {
          const newScreenshots = [...(session.screenshots || []), fileName];
          const updatedSession = { ...session, screenshots: newScreenshots };
          setSession(updatedSession);
          await saveSession(sessionId, updatedSession);

          // Update video URL
          setVideoUrl(urls[0]);
          setThumbnailUrl(urls[0]);
          toast.success("Screenshot saved");
        }
      } catch (error) {
        console.error("Screenshot error:", error);
        toast.error("Failed to save screenshot");
      }
    },
    [session, sessionId]
  );

  const handleDeleteSession = useCallback(async () => {
    try {
      await deleteSession(sessionId);
      toast.success("Session deleted");
      router.push("/");
    } catch (error) {
      console.error("Delete error:", error);
      toast.error("Failed to delete session");
    }
  }, [sessionId, router]);

  const handleCopyEmail = useCallback(async () => {
    if (!session) return;

    const emailText = `
Session Title: ${session.title}

Session Notes:
${session.sessionNotes}

Analysis:
${session.analysisNotes}

${
  session.tickets && session.tickets.length > 0
    ? `
Proposed Tickets:
${session.tickets.map((t) => `- ${t.title} (${t.type})`).join("\n")}
`
    : ""
}
    `.trim();

    try {
      await navigator.clipboard.writeText(emailText);
      setCopied(true);
      toast.success("Copied to clipboard");
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error("Copy error:", error);
      toast.error("Failed to copy");
    }
  }, [session]);

  const handleSelectTicket = useCallback((index: number, selected: boolean) => {
    setSelectedTickets((prev) => {
      const newSet = new Set(prev);
      if (selected) {
        newSet.add(index);
      } else {
        newSet.delete(index);
      }
      return newSet;
    });
  }, []);

  if (loading) {
    return (
      <main className="flex items-center justify-center min-h-screen bg-gradient-to-br from-slate-900 to-slate-800">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white mx-auto mb-4"></div>
          <p className="text-white">Loading session...</p>
        </div>
      </main>
    );
  }

  if (!session) {
    return (
      <main className="flex items-center justify-center min-h-screen bg-gradient-to-br from-slate-900 to-slate-800">
        <div className="text-center">
          <p className="text-white mb-4">Session not found</p>
          <Button onClick={() => router.push("/")} className="bg-blue-600 hover:bg-blue-700">
            Return to Dashboard
          </Button>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 text-white">
      <div className="max-w-7xl mx-auto p-4 md:p-6">
        {/* Header */}
        <div className="mb-6">
          <div className="flex items-center gap-4 mb-4">
            <input
              type="text"
              value={session.title}
              onChange={handleTitleChange}
              placeholder="Session title"
              className="text-2xl md:text-3xl font-bold bg-transparent border-b-2 border-slate-600 focus:border-blue-500 outline-none w-full"
            />
            <span className="text-sm font-medium px-3 py-1 bg-blue-600 rounded-full whitespace-nowrap">
              {new Date(session.createdAt).toLocaleDateString()}
            </span>
          </div>

          <div className="flex flex-wrap gap-2 mb-6">
            <Button
              onClick={runAnalysis}
              disabled={analyzingRef.current}
              className="bg-green-600 hover:bg-green-700 disabled:opacity-50"
            >
              <span className="mr-2">✨</span>
              Run Analysis
            </Button>

            <Button
              onClick={() => setShowPreview(!showPreview)}
              className="bg-blue-600 hover:bg-blue-700"
            >
              <span className="mr-2">📹</span>
              {showPreview ? "Hide" : "Show"} Preview
            </Button>

            <Button
              onClick={handleCopyEmail}
              className="bg-blue-600 hover:bg-blue-700"
            >
              {copied ? <Check size={20} /> : <Copy size={20} />}
              <span className="ml-2">{copied ? "Copied" : "Copy"}</span>
            </Button>

            <Button
              onClick={handleDeleteSession}
              className="bg-red-600 hover:bg-red-700"
            >
              Delete
            </Button>
          </div>
        </div>

        {/* Preview */}
        {showPreview && videoUrl && (
          <div className="mb-6 rounded-lg overflow-hidden shadow-lg">
            <img
              src={videoUrl}
              alt="Session preview"
              className="w-full h-auto bg-slate-800"
            />
          </div>
        )}

        {/* Main Content Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Left Column */}
          <div className="space-y-6">
            {/* Session Notes */}
            <div className="bg-slate-800 rounded-lg p-4">
              <h2 className="text-lg font-semibold mb-2 flex items-center gap-2">
                <FileText size={20} />
                Session Notes
              </h2>
              <Textarea
                value={session.sessionNotes}
                onChange={(e) => handleSessionNotesChange(e.target.value)}
                placeholder="Observations, key moments, and context..."
                className="w-full h-32 bg-slate-700 border-slate-600 text-white placeholder-slate-400"
              />
            </div>

            {/* Video Capture */}
            <div className="bg-slate-800 rounded-lg p-4">
              <h2 className="text-lg font-semibold mb-2 flex items-center gap-2">
                <CircleDot size={20} />
                Capture
              </h2>
              <VideoCapture onCapture={handleSaveScreenshot} />
            </div>
          </div>

          {/* Right Column */}
          <div className="space-y-6">
            {/* Analysis Notes */}
            <div className="bg-slate-800 rounded-lg p-4">
              <h2 className="text-lg font-semibold mb-2">Analysis Notes</h2>
              <NotesEditor
                value={session.analysisNotes}
                onChange={handleAnalysisNotesChange}
              />
            </div>
          </div>
        </div>

        {/* Tickets Section */}
        {session.tickets && session.tickets.length > 0 && (
          <div className="mt-6 bg-slate-800 rounded-lg p-4">
            <h2 className="text-lg font-semibold mb-4">Proposed Tickets</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {session.tickets.map((ticket, index) => (
                <TicketReviewer
                  key={index}
                  ticket={ticket}
                  isSelected={selectedTickets.has(index)}
                  onSelect={(selected) => handleSelectTicket(index, selected)}
                  onUpdate={(updated) => {
                    const newTickets = [...session.tickets];
                    newTickets[index] = updated;
                    handleTicketsChange(newTickets);
                  }}
                />
              ))}
            </div>
          </div>
        )}

        {/* Processing Status */}
        {session.processingStatus && (
          <ProcessingStatusIndicator status={session.processingStatus} />
        )}

        {/* Footer */}
        <div className="mt-8 flex flex-wrap gap-2 justify-center pb-8">
          <Button onClick={() => router.push("/")} className="bg-slate-700 hover:bg-slate-600">
            <SkipForward size={20} className="mr-2" />
            Back to Dashboard
          </Button>
          <Button
            onClick={async () => {
              try {
                await saveSession(sessionId, session);
                toast.success("Session saved");
              } catch (error) {
                console.error("Save error:", error);
                toast.error("Failed to save session");
              }
            }}
            className="bg-blue-600 hover:bg-blue-700"
          >
            Save Session
          </Button>
          <Button onClick={() => router.push(`/export/${sessionId}`)} className="bg-slate-700 hover:bg-slate-600">
            <Mail size={20} className="mr-2" />
            Export & Send
          </Button>
          <Button
            onClick={handleDeleteSession}
            className="bg-red-600 hover:bg-red-700"
          >
            Clear session
          </Button>
        </div>
      </div>
    </main>
  );
}