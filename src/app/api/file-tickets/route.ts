import { NextResponse } from "next/server";
import type { TicketProposal } from "@/lib/types";
import { fileTickets, executeAdditionalInstructions } from "@/lib/jira";

export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const {
      tickets,
      screenshots,
      zoomLink,
      zoomPasscode,
      sessionDate,
      participantName,
    } = (await req.json()) as {
      tickets: TicketProposal[];
      screenshots: Record<string, string>;
      zoomLink: string;
      zoomPasscode: string;
      sessionDate: string;
      participantName: string;
    };

    const blobScreenshots: Record<string, Blob[]> = {};
    for (const [key, base64] of Object.entries(screenshots)) {
      const buffer = Buffer.from(base64, "base64");
      const blob = new Blob([buffer], { type: "image/png" });
      // Keys are "ticketIndex_screenshotIndex" (e.g. "0_0", "0_1")
      const ticketIndex = key.includes("_") ? key.split("_")[0] : key;
      if (!blobScreenshots[ticketIndex]) blobScreenshots[ticketIndex] = [];
      blobScreenshots[ticketIndex].push(blob);
    }

    const results = await fileTickets(
      tickets,
      blobScreenshots,
      zoomLink,
      zoomPasscode,
      sessionDate,
      participantName
    );

    for (let i = 0; i < tickets.length; i++) {
      const ticket = tickets[i];
      const result = results[i];
      if (result?.success && ticket.additionalInstructions?.trim()) {
        try {
          await executeAdditionalInstructions(
            result.ticketKey,
            ticket.additionalInstructions
          );
        } catch (err) {
          console.error(
            `Additional instructions failed for ${result.ticketKey}:`,
            err
          );
        }
      }
    }

    return NextResponse.json(results);
  } catch (err) {
    console.error("File tickets error:", err);
    const message =
      err instanceof Error ? err.message : "Failed to file tickets";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
