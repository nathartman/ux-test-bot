import Anthropic from "@anthropic-ai/sdk";
import { readFileSync } from "fs";
import { join } from "path";
import type { AnalysisResult, TicketProposal, TranscriptData } from "./types";
import { fetchFeedback } from "./supabase";

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
});

export interface AnalyzeSessionInput {
  transcript: TranscriptData;
  facilitatorNotes: string;
  participantName: string;
  sessionDate: string;
  zoomLink: string;
  zoomPasscode: string;
}

function loadConfigFiles() {
  const configDir = join(process.cwd(), "src", "config");
  const writeupFormat = readFileSync(
    join(configDir, "writeup-format.md"),
    "utf-8"
  );
  const teamsJson = JSON.parse(
    readFileSync(join(configDir, "teams.json"), "utf-8")
  ) as Record<string, string>;

  const teamList = Object.entries(teamsJson)
    .map(([name, id]) => `- ${name} (ID: ${id})`)
    .join("\n");

  return { writeupFormat, teamList };
}

function splitWriteupFormat(): { summaryFormat: string; detailedFormat: string } {
  const { writeupFormat } = loadConfigFiles();
  const parts = writeupFormat.split(/\n---\n/);
  return {
    summaryFormat: parts[0].trim(),
    detailedFormat: parts.length > 1 ? parts[1].trim() : "",
  };
}

function buildSummaryNotesPrompt(): string {
  const { summaryFormat } = splitWriteupFormat();

  return `You are a UX researcher processing a usability testing session. You will receive a transcript with speaker labels and timestamps, plus the facilitator's own notes.

SOURCE WEIGHTING:
- Facilitator notes = PRIMARY source. Trust these over the transcript.
- Transcript = SECONDARY source. Use for details, exact quotes, and reconstructing task flow.
- When they conflict, trust the facilitator notes.

OUTPUT FORMAT:
Return ONLY a markdown string (not JSON, not wrapped in code fences) following this exact structure:
${summaryFormat}

IMPORTANT NOTES ON STRUCTURE:
- PAIN POINTS & FRICTION: Describe problems, not solutions. Focus on what went wrong for the user, how stuck they were, and what they said. Do NOT frame items as recommendations or suggestions for what the product should do. Just describe the pain.
- PARTICIPANT IDEAS & SUGGESTIONS: Capture these faithfully in the participant's own words. Do not evaluate feasibility or relevance — just record what they said and what prompted it. These are raw signal.

WRITING STYLE:
- Direct and specific, not academic
- Use the participant's name after introducing them
- Include exact quotes when illustrative
- Note when the facilitator had to intervene
- Reflect uncertainty when it exists`;
}

function buildDetailedNotesPrompt(): string {
  const { detailedFormat } = splitWriteupFormat();

  return `You are a UX researcher producing detailed session notes from a usability testing session. You will receive a transcript with speaker labels and timestamps, the facilitator's notes, AND the summary notes already generated from this session.

Your job is to produce ONLY the detailed chronological session notes section. This section will be stored in a knowledge base for long-term retrieval by LLMs — be very thorough.

SOURCE WEIGHTING:
- Facilitator notes = PRIMARY source. Trust these over the transcript.
- Transcript = SECONDARY source. Use for details, exact quotes, and reconstructing task flow.
- Summary notes = CONTEXT. Use to understand what was already captured, but produce your own thorough account.

OUTPUT FORMAT:
Return ONLY a markdown string (not JSON, not wrapped in code fences) following this structure:
${detailedFormat}

WRITING STYLE:
- Direct and specific, not academic
- Use the participant's name after introducing them
- Include direct quotes LIBERALLY — use exact words with timestamps in [MM:SS] format
- Note body language or tone cues if the facilitator mentioned them
- Note when the facilitator intervened and what they said
- Note what the participant tried that didn't work
- Include the participant's reasoning when they explain why they clicked something or expected something
- Use specific product terminology, feature names, and UI element names so this section is findable by keyword search
- More detail is better than less — err on the side of including too much`;
}

async function buildTicketsSystemPrompt(): Promise<string> {
  const { teamList } = loadConfigFiles();

  let learningsBlock = "";
  try {
    const feedback = await fetchFeedback();
    if (feedback.length > 0) {
      const learningLines = feedback.map((f) => `- ${f.learning}`).join("\n");
      learningsBlock = `\n\nLEARNINGS FROM PREVIOUS SESSIONS (apply these preferences):\n${learningLines}`;
    }
  } catch {
    // Non-fatal: proceed without learnings
  }

  return `You are a UX researcher extracting actionable Jira tickets from a usability testing session. You will receive the researcher's edited session notes (PRIMARY source) and the original transcript (for additional context and timestamps).

Your job is to do a thorough, independent pass over the session and identify every issue that could become a ticket. The notes describe pain points and friction but do NOT pre-classify them as bugs vs improvements — that's your job. Read the full notes and transcript carefully. Don't just convert listed pain points into tickets 1:1; some pain points may warrant multiple tickets, some may not warrant any, and the transcript may reveal issues that the notes didn't emphasize.

SOURCE WEIGHTING:
- Session notes = PRIMARY source. These have been reviewed and edited by the researcher. Start here.
- Transcript = SECONDARY source. Use for timestamps, exact quotes, and catching issues the notes may have under-emphasized.
- The "Participant Ideas & Suggestions" section in the notes is for the researcher's reference only — do NOT generate tickets from user suggestions unless the underlying problem clearly warrants one.

OUTPUT FORMAT:
Return a JSON object with one key: "tickets".

"tickets" is an array of objects, each with:
{
  "title": "Short descriptive title",
  "type": "Bug" | "Task" | "Improvement" | "Investigation",
  "teams": ["team name from the allowed list"],
  "teamIds": ["team ID string"],
  "priority": "High" | "Medium" | "Low",
  "priorityId": "2" | "3" | "4",
  "description": "Detailed description with steps to reproduce for bugs, or observed behavior for improvements. For steps to reproduce, use a proper markdown numbered list (one step per line, formatted as '1. Step one\\n2. Step two'). When a relevant direct user quote exists in the transcript, include it as a blockquote on its own line (formatted as '> quote text'). Do NOT add any 'generated by Claude' or attribution line — that is added automatically.",
  "labels": ["ux-research"],
  "needsScreenshot": true | false,
  "suggestedTimestampMs": 123456 | null,
  "timestampContext": "Brief description of what should be visible at this moment" | null
}

TICKET CLASSIFICATION:
- Bug: Something is broken, crashes, shows wrong data, or behaves contrary to clear intent. The product did something wrong.
- Improvement: The product works as designed but the design caused confusion, friction, or failure for the user. The experience needs to be better.
- Task: A concrete work item that isn't a bug or UX improvement (e.g. "add loading state to X", "update copy on Y").
- Investigation: The issue is real but the root cause or right fix is unclear and needs further research.
When in doubt between Bug and Improvement, lean Improvement. Reserve Bug for clearly broken behavior.

TICKET RULES:
- Each ticket = one actionable item, not a theme
- For bugs: include steps to reproduce, expected vs actual behavior
- For improvements: frame around the observed user behavior and the problem it caused. Focus on the problem, not a specific solution — unless the fix is truly obvious.
- Write descriptions about what THIS participant did, not generic "users" statements. Reference "the participant" and describe the specific behavior you observed. Let the real incident make the case — don't editorialize with general UX principles.
- When the transcript contains a relevant direct quote from the user that illustrates the issue, include it in the description as a markdown blockquote (> quote). Keep it to the most impactful 1-2 sentences. No attribution needed.
- Never use Highest/Critical priority
- Always include the ux-research label
- Set needsScreenshot=true for bugs and issues that are unclear without visuals
- suggestedTimestampMs should point to the moment in the recording where the issue is most visible
- timestampContext describes what the reviewer should see at that timestamp

AVAILABLE TEAMS (use these exact names and IDs):
${teamList}${learningsBlock}`;
}

function formatTranscript(transcript: TranscriptData): string {
  if (transcript.utterances.length > 0) {
    return transcript.utterances
      .map((u) => {
        const startSec = Math.round(u.start / 1000);
        const mm = Math.floor(startSec / 60);
        const ss = String(startSec % 60).padStart(2, "0");
        return `[${mm}:${ss}] Speaker ${u.speaker}: ${u.text}`;
      })
      .join("\n");
  }
  return transcript.text;
}

function stripCodeFences(text: string): string {
  let raw = text.trim();
  if (raw.startsWith("```")) {
    raw = raw.replace(/^```(?:markdown|md|json)?\n?/, "").replace(/\n?```$/, "");
  }
  return raw;
}

export async function generateSummaryNotes(
  input: AnalyzeSessionInput
): Promise<string> {
  const formattedTranscript = formatTranscript(input.transcript);

  const userMessage = `SESSION DETAILS:
- Participant: ${input.participantName}
- Date: ${input.sessionDate}
- Zoom recording: ${input.zoomLink} (Passcode: ${input.zoomPasscode})

FACILITATOR NOTES (PRIMARY SOURCE):
${input.facilitatorNotes}

TRANSCRIPT (SECONDARY SOURCE):
${formattedTranscript}`;

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 8192,
    system: buildSummaryNotesPrompt(),
    messages: [{ role: "user", content: userMessage }],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("No text response from Claude");
  }

  return stripCodeFences(textBlock.text);
}

export async function generateDetailedNotes(
  input: AnalyzeSessionInput,
  summaryNotes: string
): Promise<string> {
  const formattedTranscript = formatTranscript(input.transcript);

  const userMessage = `SESSION DETAILS:
- Participant: ${input.participantName}
- Date: ${input.sessionDate}
- Zoom recording: ${input.zoomLink} (Passcode: ${input.zoomPasscode})

FACILITATOR NOTES (PRIMARY SOURCE):
${input.facilitatorNotes}

TRANSCRIPT (SECONDARY SOURCE):
${formattedTranscript}

SUMMARY NOTES (already generated — for context only):
${summaryNotes}`;

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 12000,
    system: buildDetailedNotesPrompt(),
    messages: [{ role: "user", content: userMessage }],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("No text response from Claude");
  }

  return stripCodeFences(textBlock.text);
}

/** Combined call — for environments with longer timeouts (e.g. local dev) */
export async function generateNotes(
  input: AnalyzeSessionInput
): Promise<string> {
  const summary = await generateSummaryNotes(input);
  const detailed = await generateDetailedNotes(input, summary);
  return `${summary}\n\n---\n\n${detailed}`;
}

export interface GenerateTicketsInput {
  editedNotes: string;
  transcript: TranscriptData;
  participantName: string;
  sessionDate: string;
  zoomLink: string;
  zoomPasscode: string;
}

export async function generateTickets(
  input: GenerateTicketsInput
): Promise<TicketProposal[]> {
  const systemPrompt = await buildTicketsSystemPrompt();
  const formattedTranscript = formatTranscript(input.transcript);

  const userMessage = `SESSION DETAILS:
- Participant: ${input.participantName}
- Date: ${input.sessionDate}
- Zoom recording: ${input.zoomLink} (Passcode: ${input.zoomPasscode})

SESSION NOTES (PRIMARY SOURCE — reviewed and edited by the researcher):
${input.editedNotes}

TRANSCRIPT (SECONDARY SOURCE — for timestamps and additional context):
${formattedTranscript}`;

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 8192,
    system: systemPrompt,
    messages: [{ role: "user", content: userMessage }],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("No text response from Claude");
  }

  let raw = textBlock.text.trim();
  if (raw.startsWith("```")) {
    raw = raw.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
  }

  const parsed = JSON.parse(raw) as {
    tickets: Array<{
      title: string;
      type: "Bug" | "Task" | "Improvement" | "Investigation";
      teams?: string[];
      teamIds?: string[];
      team?: string;
      teamId?: string;
      priority: "High" | "Medium" | "Low";
      priorityId: "2" | "3" | "4";
      description: string;
      labels: string[];
      needsScreenshot: boolean;
      suggestedTimestampMs: number | null;
      timestampContext: string | null;
    }>;
  };

  return parsed.tickets.map((t) => ({
    title: t.title,
    type: t.type,
    teams: t.teams ?? (t.team ? [t.team] : []),
    teamIds: t.teamIds ?? (t.teamId ? [t.teamId] : []),
    priority: t.priority,
    priorityId: t.priorityId,
    description: t.description,
    labels: t.labels,
    needsScreenshot: t.needsScreenshot,
    suggestedTimestampMs: t.suggestedTimestampMs,
    timestampContext: t.timestampContext,
    included: true,
    ticketStatus: "pending" as const,
  }));
}

/** @deprecated Use generateNotes + generateTickets instead */
export async function analyzeSession(
  input: AnalyzeSessionInput
): Promise<AnalysisResult> {
  const notes = await generateNotes(input);
  const tickets = await generateTickets({
    editedNotes: notes,
    transcript: input.transcript,
    participantName: input.participantName,
    sessionDate: input.sessionDate,
    zoomLink: input.zoomLink,
    zoomPasscode: input.zoomPasscode,
  });
  return { notes, tickets };
}

export async function validateScreenshot(
  screenshotBase64: string,
  ticket: {
    title: string;
    description: string;
    timestampContext: string | null;
  }
): Promise<{ valid: boolean; reason: string }> {
  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 200,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: "image/png",
              data: screenshotBase64,
            },
          },
          {
            type: "text",
            text: `This screenshot was captured from a UX testing session recording as evidence for this Jira ticket:\n\nTitle: ${ticket.title}\nDescription: ${ticket.description}\n\nExpected to show: ${ticket.timestampContext ?? "N/A"}\n\nDoes this screenshot appear to show what the ticket is describing? Reply with a JSON object: { "valid": true/false, "reason": "brief explanation" }`,
          },
        ],
      },
    ],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    return { valid: true, reason: "Could not parse validation response" };
  }

  let raw = textBlock.text.trim();
  if (raw.startsWith("```")) {
    raw = raw.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
  }

  try {
    return JSON.parse(raw) as { valid: boolean; reason: string };
  } catch {
    return { valid: true, reason: "Could not parse validation response" };
  }
}

export async function rewriteText(
  selectedText: string,
  instruction: string,
  fullContext: string
): Promise<string> {
  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 2048,
    messages: [
      {
        role: "user",
        content: `Rewrite the following text according to the user's instruction. Return ONLY the rewritten text, no explanation, no wrapping quotes, no markdown code fences.

Instruction: ${instruction}

Text to rewrite:
${selectedText}

Context (the full document this excerpt is from):
${fullContext}`,
      },
    ],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("No text response from Claude");
  }

  return textBlock.text.trim();
}

export interface GeneratedPainPoint {
  description: string;
  area: string;
  tags: string[];
}

export async function generatePainPoint(ticket: {
  title: string;
  description: string;
}): Promise<GeneratedPainPoint> {
  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 512,
    messages: [
      {
        role: "user",
        content: `Reframe this Jira ticket as a user pain point for a UX research database.

Ticket title: ${ticket.title}
Ticket description: ${ticket.description}

Return a JSON object with:
- "description": 1-3 sentences describing the PROBLEM the user experienced (not a solution or fix). Be specific about what happened and why it was painful.
- "area": a short category label (e.g. "Navigation", "Onboarding", "Data Management", "Configuration", "Visual Feedback", "Performance")
- "tags": an array of 2-4 short lowercase tags for clustering (e.g. ["confusing-ui", "missing-feedback", "error-handling"])

Return ONLY the JSON, no explanation.`,
      },
    ],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("No text response from Claude");
  }

  let raw = textBlock.text.trim();
  if (raw.startsWith("```")) {
    raw = raw.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
  }

  return JSON.parse(raw) as GeneratedPainPoint;
}

export async function extractLearnings(
  proposedTickets: Array<{ title: string; type: string; priority: string; teams: string[]; description: string }>,
  actualTickets: Array<{ title: string; type: string; priority: string; teams: string[]; description: string; ticketStatus: string; loggedAsPainPoint?: boolean }>
): Promise<string[]> {
  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 2048,
    messages: [
      {
        role: "user",
        content: `You are analyzing a UX researcher's edits to AI-proposed Jira tickets. Compare the proposed tickets with what the user actually did (filed or logged as a pain point — possibly with edits). Skipped tickets are excluded from this data and should not be considered. Extract concise, actionable learnings for improving future ticket generation.

Focus on patterns like:
- Issue type changes (e.g. "Bug was changed to Improvement")
- Priority adjustments
- Team reassignments
- Tickets logged as pain points instead of filed (these were too broad or solution-oriented)
- Description rewrites (what framing did the user prefer?)

PROPOSED TICKETS:
${JSON.stringify(proposedTickets, null, 2)}

ACTUAL OUTCOMES:
${JSON.stringify(actualTickets, null, 2)}

Return a JSON array of learning strings. Each should be a concise directive, like:
- "Prefer Improvement over Bug for UX suggestions that aren't broken behavior"
- "Route labeling/annotation issues to Computer Vision, not Data"
- "Don't generate tickets for minor visual polish"

Only include meaningful, recurring patterns. If no meaningful learnings, return an empty array.
Return ONLY the JSON array, no explanation.`,
      },
    ],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") return [];

  let raw = textBlock.text.trim();
  if (raw.startsWith("```")) {
    raw = raw.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
  }

  try {
    return JSON.parse(raw) as string[];
  } catch {
    return [];
  }
}
