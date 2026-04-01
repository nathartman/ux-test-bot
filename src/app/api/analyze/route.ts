import { NextResponse } from "next/server";
import {
  generateSummaryNotes,
  generateDetailedNotes,
  type AnalyzeSessionInput,
} from "@/lib/anthropic";

export const maxDuration = 300;

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { phase, summaryNotes, ...input } = body as AnalyzeSessionInput & {
      phase?: "summary" | "detailed";
      summaryNotes?: string;
    };

    if (phase === "detailed") {
      if (!summaryNotes) {
        return NextResponse.json(
          { error: "summaryNotes required for detailed phase" },
          { status: 400 }
        );
      }
      const detailed = await generateDetailedNotes(input, summaryNotes);
      return NextResponse.json({ notes: detailed });
    }

    // Default: generate summary notes (phase 1)
    const notes = await generateSummaryNotes(input);
    return NextResponse.json({ notes });
  } catch (err) {
    console.error("Notes generation failed:", err);
    const message =
      err instanceof Error ? err.message : "Notes generation failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
