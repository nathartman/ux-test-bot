import { NextResponse } from "next/server";
import {
  generateTickets,
  type GenerateTicketsInput,
} from "@/lib/anthropic";

export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const input = (await req.json()) as GenerateTicketsInput;
    const tickets = await generateTickets(input);
    return NextResponse.json({ tickets });
  } catch (err) {
    console.error("Ticket generation failed:", err);
    const message =
      err instanceof Error ? err.message : "Ticket generation failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
