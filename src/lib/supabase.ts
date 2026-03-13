import { createClient } from "@supabase/supabase-js";

export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export interface PainPoint {
  id: string;
  description: string;
  area: string | null;
  tags: string[];
  severity: "High" | "Medium" | "Low" | "None" | null;
  session_date: string | null;
  participant_name: string | null;
  source_ticket_title: string | null;
  source_ticket_description: string | null;
  zoom_link: string | null;
  zoom_passcode: string | null;
  suggested_timestamp_ms: number | null;
  created_at: string;
}

export type PainPointInsert = Omit<PainPoint, "id" | "created_at">;

export async function insertPainPoint(
  point: PainPointInsert
): Promise<PainPoint> {
  const { data, error } = await supabase
    .from("pain_points")
    .insert(point)
    .select()
    .single();

  if (error) throw new Error(`Failed to log pain point: ${error.message}`);
  return data as PainPoint;
}

export async function fetchPainPoints(): Promise<PainPoint[]> {
  const { data, error } = await supabase
    .from("pain_points")
    .select()
    .order("created_at", { ascending: false });

  if (error) throw new Error(`Failed to fetch pain points: ${error.message}`);
  return (data as PainPoint[]) ?? [];
}

export async function deletePainPoint(id: string): Promise<void> {
  const { error } = await supabase.from("pain_points").delete().eq("id", id);
  if (error) throw new Error(`Failed to delete pain point: ${error.message}`);
}

// --- Feedback / Learnings ---

export interface Feedback {
  id: string;
  learning: string;
  session_date: string | null;
  participant_name: string | null;
  created_at: string;
}

export async function insertFeedback(
  learnings: string[],
  sessionDate: string,
  participantName: string
): Promise<void> {
  if (learnings.length === 0) return;

  const rows = learnings.map((learning) => ({
    learning,
    session_date: sessionDate,
    participant_name: participantName,
  }));

  const { error } = await supabase.from("feedback").insert(rows);
  if (error) throw new Error(`Failed to save feedback: ${error.message}`);
}

export async function fetchFeedback(): Promise<Feedback[]> {
  const { data, error } = await supabase
    .from("feedback")
    .select()
    .order("created_at", { ascending: false });

  if (error) throw new Error(`Failed to fetch feedback: ${error.message}`);
  return (data as Feedback[]) ?? [];
}
