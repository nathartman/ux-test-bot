import { NextResponse } from "next/server";
import { validateScreenshot } from "@/lib/anthropic";

export const maxDuration = 30;

export async function POST(req: Request) {
  try {
    const { screenshotBase64, ticket } = (await req.json()) as {
      screenshotBase64: string;
      ticket: {
        title: string;
        description: string;
        timestampContext: string | null;
      };
    };
    const result = await validateScreenshot(screenshotBase64, ticket);
    return NextResponse.json(result);
  } catch (err) {
    console.error("Screenshot validation failed:", err);
    return NextResponse.json(
      { valid: true, reason: "Validation unavailable" },
      { status: 200 }
    );
  }
}
