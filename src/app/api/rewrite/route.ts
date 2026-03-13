import { NextResponse } from "next/server";
import { rewriteText } from "@/lib/anthropic";

export const maxDuration = 30;

export async function POST(req: Request) {
  try {
    const { selectedText, instruction, fullContext } = (await req.json()) as {
      selectedText: string;
      instruction: string;
      fullContext: string;
    };

    const rewritten = await rewriteText(selectedText, instruction, fullContext);
    return NextResponse.json({ rewritten });
  } catch (err) {
    console.error("Rewrite failed:", err);
    const message =
      err instanceof Error ? err.message : "Rewrite failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
