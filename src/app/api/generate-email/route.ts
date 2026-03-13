import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

export const maxDuration = 60;

interface HighlightedIssue {
  title: string;
  type: string;
  teams: string[];
  priority: string;
  filedKey?: string;
  description: string;
  isPainPoint: boolean;
}

export async function POST(req: Request) {
  try {
    const { notes, tickets, highlightedIssues, participantName, sessionDate } =
      (await req.json()) as {
        notes: string;
        tickets: Array<{
          title: string;
          type: string;
          teams: string[];
          priority: string;
          filedKey?: string;
        }>;
        highlightedIssues: HighlightedIssue[];
        participantName: string;
        sessionDate: string;
      };

    const ticketSummary = tickets
      .map(
        (t) =>
          `- ${t.filedKey ?? ""} [${t.type}] ${t.title} (${t.teams.join(", ")}, ${t.priority})`
      )
      .join("\n");

    const highlightedSection = highlightedIssues
      .map((h) => {
        const tag = h.isPainPoint ? "[Pain point]" : `[${h.type}] ${h.filedKey ?? ""}`;
        return `- ${tag} ${h.title}\n  ${h.description.slice(0, 300)}`;
      })
      .join("\n\n");

    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 2048,
      messages: [
        {
          role: "user",
          content: `Write a short email summarizing a UX testing session. This will be sent to a product notes distribution list.

SESSION INFO:
- Participant: ${participantName}
- Date: ${sessionDate}

SESSION NOTES:
${notes}

ALL TICKETS FILED (for the summary count at the end):
${ticketSummary}

KEY ISSUES TO FOCUS ON (the user selected these as the most important takeaways):
${highlightedSection}

REQUIREMENTS:
- Start with a one-line intro (who was tested, what date)
- 2-4 key takeaways as bullet points, focused on the highlighted issues above. These should describe what was OBSERVED — user behaviors, confusion points, friction, what worked well. Do NOT include solutions, suggestions, or opinions about what should be built. Use the session notes for context around these issues.
- If there's anything else notable (e.g. participant background, unusual context, strong reactions), include a short "Other notes" section
- End with a brief ticket summary — not every ticket, just a count and general themes (e.g. "Filed 5 tickets: 3 bugs in the labeling flow, 1 improvement for onboarding, 1 investigation into model training UX")
- Tone: straightforward, concise, like an internal Slack post. Not corporate, not enthusiastic, not corny. No "exciting" or "great session" or "valuable insights." Just report what happened.
- Do NOT wrap in markdown code fences. Return plain text ready to paste into an email.
- Use plain text formatting — dashes for bullets, no markdown bold/italic.`,
        },
      ],
    });

    const textBlock = response.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      throw new Error("No text response from Claude");
    }

    return NextResponse.json({ email: textBlock.text.trim() });
  } catch (err) {
    console.error("Generate email error:", err);
    const message =
      err instanceof Error ? err.message : "Failed to generate email";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
