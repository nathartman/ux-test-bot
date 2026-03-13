"use client";

import { useRef, useState, useCallback, useEffect } from "react";
import type { TicketProposal } from "@/lib/types";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ScreenshotPreview } from "./screenshot-preview";

function captureFrame(videoElement: HTMLVideoElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const canvas = document.createElement("canvas");
    canvas.width = videoElement.videoWidth;
    canvas.height = videoElement.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      reject(new Error("Could not get canvas context"));
      return;
    }
    ctx.drawImage(videoElement, 0, 0);
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error("Canvas toBlob returned null"));
      },
      "image/png"
    );
  });
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

interface VideoCaptureProps {
  open: boolean;
  videoUrl: string;
  ticket: TicketProposal;
  onCapture: (blob: Blob) => void;
  onClose: () => void;
  onUpdateTimestamp: (ms: number) => void;
  existingScreenshot: Blob | null;
}

export function VideoCapture({
  open,
  videoUrl,
  ticket,
  onCapture,
  onClose,
  onUpdateTimestamp,
  existingScreenshot,
}: VideoCaptureProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [capturing, setCapturing] = useState(false);
  const hasSeekedRef = useRef(false);

  const suggestedSec = ticket.suggestedTimestampMs
    ? ticket.suggestedTimestampMs / 1000
    : null;

  const seekTo = useCallback((time: number) => {
    const video = videoRef.current;
    if (!video) return;
    const clamped = Math.max(0, Math.min(time, video.duration || Infinity));
    video.currentTime = clamped;
    setCurrentTime(clamped);
  }, []);

  const nudge = useCallback(
    (delta: number) => {
      const video = videoRef.current;
      if (!video) return;
      seekTo(video.currentTime + delta);
    },
    [seekTo]
  );

  // Reset seek guard when dialog opens
  useEffect(() => {
    if (open) {
      hasSeekedRef.current = false;
    }
  }, [open]);

  // Seek once when video is ready
  const handleCanPlay = useCallback(() => {
    if (hasSeekedRef.current) return;
    hasSeekedRef.current = true;
    if (suggestedSec != null) {
      const video = videoRef.current;
      if (video) {
        video.currentTime = suggestedSec;
        setCurrentTime(suggestedSec);
      }
    }
  }, [suggestedSec]);

  const handleTimeUpdate = useCallback(() => {
    const video = videoRef.current;
    if (video) setCurrentTime(video.currentTime);
  }, []);

  const handleCapture = useCallback(async () => {
    const video = videoRef.current;
    if (!video || capturing) return;
    setCapturing(true);
    try {
      video.pause();
      const blob = await captureFrame(video);
      onCapture(blob);
    } catch (err) {
      console.error("Capture failed:", err);
    } finally {
      setCapturing(false);
    }
  }, [capturing, onCapture]);

  const jumpToSuggested = useCallback(() => {
    if (suggestedSec != null) seekTo(suggestedSec);
  }, [suggestedSec, seekTo]);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-[90vw] sm:max-w-[90vw] w-full max-h-[90vh]">
        <DialogHeader>
          <DialogTitle className="text-balance">
            {ticket.title}
          </DialogTitle>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
            {suggestedSec != null && (
              <button
                onClick={jumpToSuggested}
                className="underline underline-offset-2 tabular-nums hover:text-foreground"
              >
                Suggested timestamp: {formatTime(suggestedSec)}
              </button>
            )}
            {ticket.timestampContext && (
              <span>{ticket.timestampContext}</span>
            )}
          </div>
        </DialogHeader>

        <div className="space-y-4">
          <video
            ref={videoRef}
            src={videoUrl}
            controls
            playsInline
            muted
            onCanPlay={handleCanPlay}
            onTimeUpdate={handleTimeUpdate}
            className="w-full rounded-lg bg-black"
            style={{ maxHeight: "70vh" }}
          />

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => nudge(-5)}
                aria-label="Back 5 seconds"
              >
                -5s
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => nudge(-1)}
                aria-label="Back 1 second"
              >
                -1s
              </Button>
              <span className="min-w-16 text-center text-sm tabular-nums">
                {formatTime(currentTime)}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => nudge(1)}
                aria-label="Forward 1 second"
              >
                +1s
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => nudge(5)}
                aria-label="Forward 5 seconds"
              >
                +5s
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => onUpdateTimestamp(Math.round(currentTime * 1000))}
              >
                Set as timestamp
              </Button>
            </div>

            <Button onClick={handleCapture} disabled={capturing}>
              {capturing
                ? "Capturing…"
                : existingScreenshot
                  ? "Recapture"
                  : "Capture screenshot"}
            </Button>
          </div>

          {existingScreenshot && (
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">
                Current screenshot:
              </p>
              <ScreenshotPreview src={existingScreenshot} />
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
