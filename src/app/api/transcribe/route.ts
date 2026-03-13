import { NextResponse } from "next/server";
import { submitTranscription } from "@/lib/assemblyai";

export async function POST(req: Request) {
  try {
    const { audioUrl } = (await req.json()) as { audioUrl: string };
    const result = await submitTranscription(audioUrl);
    return NextResponse.json(result);
  } catch (err) {
    console.error("Transcribe submit error:", err);
    const message =
      err instanceof Error ? err.message : "Transcription submission failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
