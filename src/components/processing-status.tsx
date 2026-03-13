"use client";

import type { ProcessingStatus } from "@/lib/types";
import { Loader2 } from "lucide-react";

const STATUS_LABELS: Record<ProcessingStatus, string> = {
  uploading: "Uploading audio",
  transcribing: "Transcribing (this takes 1–3 minutes)",
  analyzing: "Generating session notes",
  "reviewing-notes": "Ready for review",
  "generating-tickets": "Generating tickets from your notes",
  "reviewing-tickets": "Reviewing tickets",
  learning: "Learning from your edits",
  filed: "Tickets filed",
};

interface ProcessingStatusProps {
  status: ProcessingStatus;
}

export function ProcessingStatusIndicator({ status }: ProcessingStatusProps) {
  return (
    <div className="flex items-center gap-3">
      <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" />
      <p className="text-sm text-muted-foreground">{STATUS_LABELS[status]}</p>
    </div>
  );
}
