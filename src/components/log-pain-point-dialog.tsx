"use client";

import { useState, useCallback, useEffect } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { insertPainPoint, type PainPointInsert } from "@/lib/supabase";

interface LogPainPointDialogProps {
  open: boolean;
  onClose: () => void;
  onLogged: () => void;
  defaults: {
    severity: "High" | "Medium" | "Low" | "None";
    sessionDate: string;
    participantName: string;
    sourceTicketTitle: string;
    sourceTicketDescription: string;
    zoomLink: string;
    zoomPasscode: string;
    suggestedTimestampMs: number | null;
  };
}

export function LogPainPointDialog({
  open,
  onClose,
  onLogged,
  defaults,
}: LogPainPointDialogProps) {
  const [description, setDescription] = useState("");
  const [area, setArea] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;

    setDescription("");
    setArea("");
    setTags([]);
    setGenerating(true);

    fetch("/api/generate-pain-point", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: defaults.sourceTicketTitle,
        description: defaults.sourceTicketDescription,
      }),
    })
      .then((res) => {
        if (!res.ok) throw new Error("Generation failed");
        return res.json();
      })
      .then((data) => {
        setDescription(data.description ?? "");
        setArea(data.area ?? "");
        setTags(data.tags ?? []);
      })
      .catch(() => {
        setDescription(defaults.sourceTicketDescription);
      })
      .finally(() => setGenerating(false));
  }, [open, defaults.sourceTicketTitle, defaults.sourceTicketDescription]);

  const handleSave = useCallback(async () => {
    if (!description.trim()) return;
    setSaving(true);

    try {
      const point: PainPointInsert = {
        description: description.trim(),
        area: area || null,
        tags,
        severity: defaults.severity,
        session_date: defaults.sessionDate,
        participant_name: defaults.participantName,
        source_ticket_title: defaults.sourceTicketTitle,
        source_ticket_description: defaults.sourceTicketDescription,
        zoom_link: defaults.zoomLink || null,
        zoom_passcode: defaults.zoomPasscode || null,
        suggested_timestamp_ms: defaults.suggestedTimestampMs,
      };

      await insertPainPoint(point);
      toast.success("Pain point logged");
      onLogged();
      onClose();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to log pain point"
      );
    } finally {
      setSaving(false);
    }
  }, [description, area, tags, defaults, onLogged, onClose]);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Log as pain point</DialogTitle>
        </DialogHeader>

        {generating ? (
          <div className="flex items-center gap-3 py-8">
            <Loader2 className="size-4 animate-spin text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              Reframing as a pain point...
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="min-h-28"
                spellCheck={false}
              />
            </div>

            <div className="space-y-3">
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
                  <span>{defaults.participantName}</span>
                  <span>&middot;</span>
                  <span>{defaults.sessionDate}</span>
                  {area && (
                    <>
                      <span>&middot;</span>
                      <span>{area}</span>
                    </>
                  )}
                </div>
                {tags.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {tags.map((tag) => (
                      <Badge key={tag} variant="secondary">
                        {tag}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={onClose} disabled={saving}>
                  Cancel
                </Button>
                <Button
                  onClick={handleSave}
                  disabled={!description.trim() || saving}
                >
                  {saving ? "Saving…" : "Log pain point"}
                </Button>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
