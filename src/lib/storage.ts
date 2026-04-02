import { supabase } from "./supabase";
import type {
  SessionStore,
  SessionListItem,
  SessionMetadata,
  ProcessingStatus,
  TicketProposal,
  TranscriptData,
} from "./types";

const SCREENSHOT_BUCKET = "session-screenshots";

// --- Row shape from Supabase ---

interface SessionRow {
  id: string;
  participant_name: string;
  session_date: string | null;
  zoom_link: string | null;
  zoom_passcode: string | null;
  facilitator_notes: string;
  transcript_id: string | null;
  audio_url: string | null;
  transcript: TranscriptData | null;
  notes_markdown: string;
  tickets: TicketProposal[];
  proposed_tickets: TicketProposal[];
  status: string;
  created_at: string;
  updated_at: string;
}

function rowToSession(row: SessionRow): SessionStore {
  return {
    id: row.id,
    metadata: {
      participantName: row.participant_name,
      sessionDate: row.session_date ?? "",
      zoomLink: row.zoom_link ?? "",
      zoomPasscode: row.zoom_passcode ?? "",
      createdAt: row.created_at,
    },
    facilitatorNotes: row.facilitator_notes,
    transcriptId: row.transcript_id,
    audioUrl: row.audio_url,
    transcript: row.transcript,
    notesMarkdown: row.notes_markdown,
    tickets: (row.tickets ?? []).map(migrateTicket),
    proposedTickets: (row.proposed_tickets ?? []).map(migrateTicket),
    status: row.status as ProcessingStatus,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function migrateTicket(t: any): TicketProposal {
  const teams = (t.teams ?? (t.team ? [t.team] : [])).map((n: string) =>
    n === "Fleet 1" ? "Fleet" : n
  );
  const teamIds = t.teamIds ?? (t.teamId ? [t.teamId] : []);
  return {
    ...t,
    teams,
    teamIds,
    ticketStatus: t.ticketStatus ?? "pending",
    included: t.included ?? true,
  };
}

// --- CRUD ---

export async function createSession(
  metadata: SessionMetadata,
  extra?: Partial<{
    facilitatorNotes: string;
    transcriptId: string;
    audioUrl: string;
    status: ProcessingStatus;
  }>
): Promise<string> {
  const { data, error } = await supabase
    .from("sessions")
    .insert({
      participant_name: metadata.participantName,
      session_date: metadata.sessionDate,
      zoom_link: metadata.zoomLink,
      zoom_passcode: metadata.zoomPasscode,
      facilitator_notes: extra?.facilitatorNotes ?? "",
      transcript_id: extra?.transcriptId ?? null,
      audio_url: extra?.audioUrl ?? null,
      status: extra?.status ?? "uploading",
    })
    .select("id")
    .single();

  if (error) throw new Error(`Failed to create session: ${error.message}`);
  return data.id;
}

export async function getSession(
  id: string
): Promise<SessionStore | undefined> {
  const { data, error } = await supabase
    .from("sessions")
    .select("*")
    .eq("id", id)
    .single();

  if (error) {
    if (error.code === "PGRST116") return undefined;
    throw new Error(`Failed to load session: ${error.message}`);
  }

  return rowToSession(data as SessionRow);
}

export async function saveSession(
  id: string,
  patch: Partial<SessionStore>
): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const row: Record<string, any> = { updated_at: new Date().toISOString() };

  if (patch.metadata) {
    row.participant_name = patch.metadata.participantName;
    row.session_date = patch.metadata.sessionDate;
    row.zoom_link = patch.metadata.zoomLink;
    row.zoom_passcode = patch.metadata.zoomPasscode;
  }
  if (patch.facilitatorNotes !== undefined)
    row.facilitator_notes = patch.facilitatorNotes;
  if (patch.transcriptId !== undefined)
    row.transcript_id = patch.transcriptId;
  if (patch.audioUrl !== undefined) row.audio_url = patch.audioUrl;
  if (patch.transcript !== undefined) row.transcript = patch.transcript;
  if (patch.notesMarkdown !== undefined)
    row.notes_markdown = patch.notesMarkdown;
  if (patch.tickets !== undefined) row.tickets = patch.tickets;
  if (patch.proposedTickets !== undefined)
    row.proposed_tickets = patch.proposedTickets;
  if (patch.status !== undefined) row.status = patch.status;

  const { error } = await supabase
    .from("sessions")
    .update(row)
    .eq("id", id);

  if (error) throw new Error(`Failed to save session: ${error.message}`);
}

export async function listSessions(): Promise<SessionListItem[]> {
  const { data, error } = await supabase
    .from("sessions")
    .select(
      "id, participant_name, session_date, status, tickets, created_at"
    )
    .order("created_at", { ascending: false });

  if (error) throw new Error(`Failed to list sessions: ${error.message}`);

  return (data ?? []).map((row) => {
    const tickets = (row.tickets ?? []) as TicketProposal[];
    return {
      id: row.id,
      participantName: row.participant_name,
      sessionDate: row.session_date,
      status: row.status as ProcessingStatus,
      ticketCount: tickets.length,
      filedCount: tickets.filter((t) => t.ticketStatus === "filed").length,
      createdAt: row.created_at,
    };
  });
}

export async function deleteSession(id: string): Promise<void> {
  const { error: storageError } = await supabase.storage
    .from(SCREENSHOT_BUCKET)
    .list(id)
    .then(async ({ data: files }) => {
      if (files && files.length > 0) {
        return supabase.storage
          .from(SCREENSHOT_BUCKET)
          .remove(files.map((f) => `${id}/${f.name}`));
      }
      return { error: null };
    });

  if (storageError) {
    console.error("Failed to delete screenshots:", storageError);
  }

  const { error } = await supabase.from("sessions").delete().eq("id", id);
  if (error) throw new Error(`Failed to delete session: ${error.message}`);
}

// --- Screenshots ---

export async function uploadScreenshot(
  sessionId: string,
  ticketIndex: number,
  blob: Blob,
  screenshotIndex: number = 0
): Promise<string> {
  const path = `${sessionId}/${ticketIndex}_${screenshotIndex}.png`;

  const { error } = await supabase.storage
    .from(SCREENSHOT_BUCKET)
    .upload(path, blob, { contentType: "image/png", upsert: true });

  if (error)
    throw new Error(`Failed to upload screenshot: ${error.message}`);

  const { data } = supabase.storage
    .from(SCREENSHOT_BUCKET)
    .getPublicUrl(path);

  return data.publicUrl;
}

export async function getScreenshotUrls(
  sessionId: string
): Promise<Record<string, string[]>> {
  const { data: files, error } = await supabase.storage
    .from(SCREENSHOT_BUCKET)
    .list(sessionId);

  if (error || !files) return {};

  const urls: Record<string, string[]> = {};
  for (const file of files) {
    const base = file.name.replace(".png", "");
    // Support both old format (ticketIndex.png) and new (ticketIndex_screenshotIndex.png)
    const ticketIndex = base.includes("_") ? base.split("_")[0] : base;
    const { data } = supabase.storage
      .from(SCREENSHOT_BUCKET)
      .getPublicUrl(`${sessionId}/${file.name}`);
    if (!urls[ticketIndex]) urls[ticketIndex] = [];
    urls[ticketIndex].push(data.publicUrl);
  }
  return urls;
}

// --- Legacy IndexedDB migration ---

export async function getLegacySession(): Promise<
  (SessionStore & { screenshots?: Record<string, Blob> }) | undefined
> {
  try {
    const { openDB } = await import("idb");
    const db = await openDB("ux-session-processor", 1);
    const session = await db.get("sessions", "current");
    if (!session) return undefined;
    return session;
  } catch {
    return undefined;
  }
}

export async function clearLegacySession(): Promise<void> {
  try {
    const { openDB } = await import("idb");
    const db = await openDB("ux-session-processor", 1);
    await db.delete("sessions", "current");
  } catch {
    // IndexedDB may not exist
  }
}
