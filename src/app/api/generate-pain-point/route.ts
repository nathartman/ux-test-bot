import { NextResponse } from "next/server";
import { generatePainPoint } from "@/lib/anthropic";

export const maxDuration = 15;

export async function POST(req: Request) {
  try {
    const { title, description } = (await req.json()) as {
      title: string;
      description: string;
    };
    const result = await generatePainPoint({ title, description });
    return NextResponse.json(result);
  } catch (err) {
    console.error("Pain point generation failed:", err);
    const message =
      err instanceof Error ? err.message : "Generation failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
