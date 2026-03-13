"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { createSession } from "@/lib/storage";
import { Loader2 } from "lucide-react";
import { FileDropzone } from "./file-dropzone";

type UploadStep = "idle" | "uploading-audio" | "submitting-job" | "done";

export function UploadForm() {
  const router = useRouter();

  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [participantName, setParticipantName] = useState("");
  const [sessionDate, setSessionDate] = useState(
    () => new Date().toISOString().split("T")[0]
  );
  const [facilitatorNotes, setFacilitatorNotes] = useState("");
  const [zoomLink, setZoomLink] = useState("");
  const [zoomPasscode, setZoomPasscode] = useState("");
  const [uploadStep, setUploadStep] = useState<UploadStep>("idle");

  const isValid =
    audioFile && participantName.trim() && facilitatorNotes.trim();
  const isSubmitting = uploadStep !== "idle";

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!isValid || isSubmitting) return;

      try {
        // Store video object URL in sessionStorage (never uploaded)
        if (videoFile) {
          const url = URL.createObjectURL(videoFile);
          sessionStorage.setItem("videoObjectUrl", url);
        }

        // 1. Upload audio directly to AssemblyAI
        setUploadStep("uploading-audio");

        const uploadResponse = await fetch(
          "https://api.assemblyai.com/v2/upload",
          {
            method: "POST",
            headers: {
              Authorization: process.env.NEXT_PUBLIC_ASSEMBLYAI_API_KEY!,
            },
            body: audioFile,
          }
        );

        if (!uploadResponse.ok) {
          throw new Error(
            `Audio upload failed: ${uploadResponse.status} ${uploadResponse.statusText}`
          );
        }

        const { upload_url } = await uploadResponse.json();

        // 2. Submit transcription job via our API route
        setUploadStep("submitting-job");

        const transcribeResponse = await fetch("/api/transcribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ audioUrl: upload_url }),
        });

        if (!transcribeResponse.ok) {
          throw new Error(
            `Transcription submission failed: ${transcribeResponse.status}`
          );
        }

        const { transcriptId } = await transcribeResponse.json();

        // 3. Save session to Supabase
        const sessionId = await createSession(
          {
            participantName,
            sessionDate,
            zoomLink,
            zoomPasscode,
            createdAt: new Date().toISOString(),
          },
          {
            facilitatorNotes,
            transcriptId,
            audioUrl: upload_url,
            status: "transcribing",
          }
        );

        setUploadStep("done");
        router.push(`/session/${sessionId}`);
      } catch (err) {
        console.error("Processing failed:", err);
        toast.error(
          err instanceof Error ? err.message : "Something went wrong"
        );
        setUploadStep("idle");
      }
    },
    [
      isValid,
      isSubmitting,
      audioFile,
      videoFile,
      participantName,
      sessionDate,
      zoomLink,
      zoomPasscode,
      facilitatorNotes,
      router,
    ]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        handleSubmit(e as unknown as React.FormEvent);
      }
    },
    [handleSubmit]
  );

  const stepLabel: Record<UploadStep, string> = {
    idle: "",
    "uploading-audio": "Uploading audio to AssemblyAI…",
    "submitting-job": "Starting transcription…",
    done: "Redirecting…",
  };

  return (
    <Card className="w-full max-w-2xl">
      <CardContent className="pt-6">
        <form
          onSubmit={handleSubmit}
          onKeyDown={handleKeyDown}
          className="space-y-6"
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Audio recording</Label>
              <FileDropzone
                accept=".m4a,.mp3,.wav"
                file={audioFile}
                onFileChange={setAudioFile}
                label="audio file"
                disabled={isSubmitting}
              />
            </div>

            <div className="space-y-2">
              <Label>Video recording</Label>
              <FileDropzone
                accept=".mp4"
                file={videoFile}
                onFileChange={setVideoFile}
                label="video file"
                disabled={isSubmitting}
              />
            </div>
          </div>

          <Separator />

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="participant">Participant name</Label>
              <Input
                id="participant"
                placeholder="e.g. Jane Doe"
                value={participantName}
                disabled={isSubmitting}
                autoComplete="off"
                spellCheck={false}
                onChange={(e) => setParticipantName(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="date">Session date</Label>
              <Input
                id="date"
                type="date"
                value={sessionDate}
                disabled={isSubmitting}
                onChange={(e) => setSessionDate(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="notes">Facilitator notes</Label>
            <Textarea
              id="notes"
              placeholder="Paste your session notes here"
              className="min-h-40 max-h-[400px]"
              value={facilitatorNotes}
              disabled={isSubmitting}
              spellCheck={false}
              onChange={(e) => setFacilitatorNotes(e.target.value)}
            />
          </div>

          <Separator />

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="zoom-link">Zoom recording link</Label>
              <Input
                id="zoom-link"
                type="url"
                placeholder="https://zoom.us/rec/share/..."
                value={zoomLink}
                disabled={isSubmitting}
                autoComplete="off"
                onChange={(e) => setZoomLink(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="zoom-passcode">Zoom passcode</Label>
              <Input
                id="zoom-passcode"
                placeholder="Passcode"
                value={zoomPasscode}
                disabled={isSubmitting}
                autoComplete="off"
                onChange={(e) => setZoomPasscode(e.target.value)}
              />
            </div>
          </div>

          {isSubmitting && (
            <div className="flex items-center gap-3">
              <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                {stepLabel[uploadStep]}
              </p>
            </div>
          )}

          <Button
            type="submit"
            size="lg"
            className="w-full"
            disabled={!isValid || isSubmitting}
          >
            {isSubmitting ? "Processing…" : "Process session"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
