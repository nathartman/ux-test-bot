import { NextResponse } from "next/server";
import { generateNotes, type AnalyzeSessionInput } from "@/lib/anthropic";

export const maxDuration = 120;

export async function POST(req: Request) {
  try {
    const input = (await req.json()) as AnalyzeSessionInput;
    const notes = await generateNotes(input);
    return NextResponse.json({ notes });
  } catch (err) {
    console.error("Notes generation failed:", err);
    const message =
      err instanceof Error ? err.message : "Notes generation failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
