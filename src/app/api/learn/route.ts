import { NextResponse } from "next/server";
import { extractLearnings } from "@/lib/anthropic";
import { insertFeedback } from "@/lib/supabase";

export const maxDuration = 30;

export async function POST(req: Request) {
  try {
    const { proposedTickets, actualTickets, sessionDate, participantName } =
      (await req.json()) as {
        proposedTickets: Array<{
          title: string;
          type: string;
          priority: string;
          teams: string[];
          description: string;
        }>;
        actualTickets: Array<{
          title: string;
          type: string;
          priority: string;
          teams: string[];
          description: string;
          ticketStatus: string;
          loggedAsPainPoint?: boolean;
        }>;
        sessionDate: string;
        participantName: string;
      };

    const learnings = await extractLearnings(proposedTickets, actualTickets);

    if (learnings.length > 0) {
      await insertFeedback(learnings, sessionDate, participantName);
    }

    return NextResponse.json({ learnings });
  } catch (err) {
    console.error("Learning extraction failed:", err);
    const message =
      err instanceof Error ? err.message : "Learning extraction failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
