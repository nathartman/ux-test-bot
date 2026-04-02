"use client";

import type { TicketProposal } from "@/lib/types";
import { TEAMS, TEAM_NAMES, PRIORITY_OPTIONS } from "@/lib/jira-config";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { ScreenshotPreview } from "./screenshot-preview";


interface TicketCardProps {
  ticket: TicketProposal;
  index: number;
  onChange: (updated: TicketProposal) => void;
  onCaptureScreenshot: () => void;
  screenshots: (Blob | string)[];
}

export function TicketCard({
  ticket,
  index,
  onChange,
  onCaptureScreenshot,
  screenshots,
}: TicketCardProps) {
  function patch(fields: Partial<TicketProposal>) {
    onChange({ ...ticket, ...fields });
  }

  const typeBadgeVariant =
    ticket.type === "Bug" ? "destructive" : "secondary";

  return (
    <AccordionItem value={`ticket-${index}`}>
      <div className="flex items-center gap-3 px-4 py-2">
        <Checkbox
          checked={ticket.included}
          onCheckedChange={(checked) =>
            patch({ included: checked === true })
          }
          aria-label={`Include ticket: ${ticket.title}`}
        />

        <AccordionTrigger className="flex-1 py-1.5 hover:no-underline">
          <div className="flex flex-1 items-center gap-2 pr-2">
            <span
              className={`flex-1 truncate text-left text-sm ${
                ticket.included
                  ? "text-foreground"
                  : "text-muted-foreground line-through"
              }`}
            >
              {ticket.title}
            </span>
            <Badge
              variant={typeBadgeVariant}
              className="shrink-0 cursor-pointer"
              onClick={(e) => {
                e.stopPropagation();
                patch({
                  type: ticket.type === "Bug" ? "Task" : "Bug",
                });
              }}
            >
              {ticket.type}
            </Badge>
            {ticket.teams.map((t) => (
              <Badge key={t} variant="outline" className="shrink-0">
                {t}
              </Badge>
            ))}
            {screenshots.length > 0 && (
              <div className="flex items-center gap-1">
                <div className="size-2 shrink-0 rounded-full bg-green-500" />
                {screenshots.length > 1 && (
                  <span className="text-[10px] tabular-nums text-muted-foreground">{screenshots.length}</span>
                )}
              </div>
            )}
          </div>
        </AccordionTrigger>
      </div>

      <AccordionContent className="px-4 pb-4">
        <div className="space-y-4 pl-7">
          <div className="space-y-2">
            <Label htmlFor={`title-${index}`}>Title</Label>
            <Input
              id={`title-${index}`}
              value={ticket.title}
              spellCheck={false}
              onChange={(e) => patch({ title: e.target.value })}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Team</Label>
              <Select
                value={ticket.teams[0] ?? ""}
                onValueChange={(team) =>
                  patch({ teams: [team], teamIds: [TEAMS[team] ?? ""] })
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TEAM_NAMES.map((name) => (
                    <SelectItem key={name} value={name}>
                      {name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Priority</Label>
              <Select
                value={ticket.priorityId}
                onValueChange={(priorityId) => {
                  const opt = PRIORITY_OPTIONS.find(
                    (o) => o.id === priorityId
                  );
                  if (opt) {
                    patch({
                      priority: opt.label as TicketProposal["priority"],
                      priorityId: opt.id as TicketProposal["priorityId"],
                    });
                  }
                }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PRIORITY_OPTIONS.map((opt) => (
                    <SelectItem key={opt.id} value={opt.id}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor={`desc-${index}`}>Description</Label>
            <Textarea
              id={`desc-${index}`}
              value={ticket.description}
              className="min-h-24"
              spellCheck={false}
              onChange={(e) => patch({ description: e.target.value })}
            />
          </div>

          {ticket.needsScreenshot && (
            <div className="space-y-2">
              {screenshots.length > 0 && (
                <div className="flex flex-wrap items-start gap-3">
                  {screenshots.map((src, si) => (
                    <ScreenshotPreview key={si} src={src} />
                  ))}
                </div>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={onCaptureScreenshot}
              >
                {screenshots.length > 0 ? "Add screenshot" : "Capture screenshot"}
              </Button>
              {ticket.timestampContext && (
                <p className="text-xs text-muted-foreground">
                  Expected: {ticket.timestampContext}
                </p>
              )}
            </div>
          )}
        </div>
      </AccordionContent>
    </AccordionItem>
  );
}
