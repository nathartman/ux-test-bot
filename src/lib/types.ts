export type ProcessingStatus =
  | "uploading"
  | "transcribing"
  | "analyzing"
  | "analyze-failed"
  | "reviewing-notes"
  | "generating-tickets"
  | "reviewing-tickets"
  | "learning"
  | "filed";

export type TicketStatus = "pending" | "skipped" | "filed" | "pain-point";

export interface SessionMetadata {
  participantName: string;
  sessionDate: string;
  zoomLink: string;
  zoomPasscode: string;
  createdAt: string;
}

export interface Utterance {
  speaker: string;
  text: string;
  start: number;
  end: number;
}

export interface Word {
  text: string;
  start: number;
  end: number;
  speaker: string;
  confidence: number;
}

export interface TranscriptData {
  utterances: Utterance[];
  words: Word[];
  text: string;
}

export interface TicketProposal {
  title: string;
  type: "Bug" | "Task" | "Improvement" | "Investigation";
  teams: string[];
  teamIds: string[];
  priority: "High" | "Medium" | "Low" | "None";
  priorityId: "2" | "3" | "4" | "5";
  description: string;
  labels: string[];
  needsScreenshot: boolean;
  suggestedTimestampMs: number | null;
  timestampContext: string | null;
  included: boolean;
  ticketStatus: TicketStatus;
  needsDesign?: boolean;
  additionalInstructions?: string;
  filedKey?: string;
  filedUrl?: string;
  loggedAsPainPoint?: boolean;
}

export interface AnalysisResult {
  notes: string;
  tickets: TicketProposal[];
}

export interface SessionStore {
  id: string;
  metadata: SessionMetadata;
  facilitatorNotes: string;
  transcriptId: string | null;
  audioUrl: string | null;
  transcript: TranscriptData | null;
  notesMarkdown: string;
  tickets: TicketProposal[];
  proposedTickets: TicketProposal[];
  status: ProcessingStatus;
  learningCompleted?: boolean;
}

export interface SessionListItem {
  id: string;
  participantName: string;
  sessionDate: string | null;
  status: ProcessingStatus;
  ticketCount: number;
  filedCount: number;
  createdAt: string;
}

export interface FileTicketResult {
  ticketKey: string;
  url: string;
  success: boolean;
  error?: string;
}
