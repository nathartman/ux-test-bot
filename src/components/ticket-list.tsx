"use client";

import { useCallback, useState } from "react";
import { toast } from "sonner";
import type { TicketProposal } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Accordion } from "@/components/ui/accordion";
import { ScrollArea } from "@/components/ui/scroll-area";
import { TicketCard } from "./ticket-card";

interface TicketListProps {
  tickets: TicketProposal[];
  onTicketsChange: (tickets: TicketProposal[]) => void;
  videoUrl: string | null;
  onCaptureScreenshot: (ticketIndex: number) => void;
  screenshots: Record<string, Blob>;
  onFileTickets: () => Promise<void>;
}

export function TicketList({
  tickets,
  onTicketsChange,
  onCaptureScreenshot,
  screenshots,
  onFileTickets,
}: TicketListProps) {
  const approvedCount = tickets.filter((t) => t.included).length;
  const [filing, setFiling] = useState(false);

  const handleTicketChange = useCallback(
    (index: number, updated: TicketProposal) => {
      const next = [...tickets];
      next[index] = updated;
      onTicketsChange(next);
    },
    [tickets, onTicketsChange]
  );

  const handleFileTickets = useCallback(async () => {
    if (approvedCount === 0) {
      toast.error("No tickets selected");
      return;
    }
    setFiling(true);
    try {
      await onFileTickets();
    } finally {
      setFiling(false);
    }
  }, [approvedCount, onFileTickets]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b px-4 py-2">
        <h2 className="text-sm font-medium">
          Tickets{" "}
          <span className="tabular-nums text-muted-foreground">
            ({approvedCount}/{tickets.length})
          </span>
        </h2>
      </div>

      <ScrollArea className="flex-1">
        <Accordion type="multiple" className="w-full">
          {tickets.map((ticket, i) => (
            <TicketCard
              key={i}
              ticket={ticket}
              index={i}
              onChange={(updated) => handleTicketChange(i, updated)}
              onCaptureScreenshot={() => onCaptureScreenshot(i)}
              screenshot={screenshots[String(i)] ?? null}
            />
          ))}
        </Accordion>
      </ScrollArea>

      <div className="sticky bottom-0 border-t bg-background px-4 py-3">
        <Button
          className="w-full"
          disabled={approvedCount === 0 || filing}
          onClick={handleFileTickets}
        >
          {filing
            ? "Filing…"
            : `File ${approvedCount} approved ticket${approvedCount !== 1 ? "s" : ""}`}
        </Button>
      </div>
    </div>
  );
}
