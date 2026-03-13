import { NextResponse } from "next/server";
import { getTranscriptionStatus } from "@/lib/assemblyai";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const result = await getTranscriptionStatus(id);
  return NextResponse.json(result);
}
