# UX Session Processor — Technical Spec

## What this app does

A web app that takes UX testing session recordings and facilitator notes as input, and produces:
1. A structured session notes document (editable markdown)
2. Proposed Jira tickets with screenshots and recording links
3. Filed Jira tickets with attachments upon approval

The app is used by 2-3 people at Viam. It runs on Vercel and uses API keys stored as server-side environment variables.

---

## Tech stack

| Layer | Choice | Why |
|---|---|---|
| Framework | Next.js 15 (App Router) + TypeScript | Full-stack in one project, Vercel-native |
| UI | Tailwind CSS + shadcn/ui | Pre-built accessible components, minimal custom CSS |
| Markdown editor | `@uiw/react-md-editor` (npm package) | Well-maintained, has preview mode, toolbar, dark mode support. Drop-in React component. |
| Transcription | AssemblyAI (JS SDK: `assemblyai`) | Accurate speaker diarization, word-level timestamps, simple API |
| AI analysis | Anthropic Claude API (JS SDK: `@anthropic-ai/sdk`) | Powers transcript analysis, ticket proposals, screenshot validation |
| Video playback | Native HTML5 `<video>` element | No library needed. `video.currentTime` for seeking, `<canvas>` for screenshots |
| Jira | Atlassian REST API (direct fetch calls) | Create issues, upload attachments. No SDK needed. |
| Deployment | Vercel (free tier) | Auto-deploy from GitHub, environment variables for API keys |

### npm packages to install

```
npx create-next-app@latest ux-session-processor --typescript --tailwind --app --src-dir
npx shadcn@latest init
npx shadcn@latest add card badge checkbox select textarea button dialog tabs progress slider sonner table accordion switch label separator tooltip scroll-area
npm install @uiw/react-md-editor assemblyai @anthropic-ai/sdk idb
```

No other dependencies should be necessary. Do not install video player libraries, FFmpeg libraries, or markdown rendering libraries — those are handled by the tools above or native browser APIs.

---

## Environment variables

```env
ASSEMBLYAI_API_KEY=xxx          # Transcription
ANTHROPIC_API_KEY=xxx           # AI analysis
JIRA_BASE_URL=https://viam.atlassian.net
JIRA_USER_EMAIL=xxx@viam.com    # Account that owns the API token
JIRA_API_TOKEN=xxx              # Atlassian API token
```

All are server-side only (used in API routes, never exposed to the client). Set them in Vercel dashboard > Project Settings > Environment Variables for production.

---

## App structure

```
src/
  app/
    page.tsx                    # Upload screen
    session/[id]/page.tsx       # Review screen (notes + tickets + video)
    api/
      process/route.ts          # Orchestrates: upload audio → transcribe → analyze
      transcribe/route.ts       # AssemblyAI transcription
      analyze/route.ts          # Claude analysis of transcript + notes
      validate-screenshot/route.ts  # Claude vision: does screenshot match ticket?
      file-tickets/route.ts     # Create Jira issues with attachments
  components/
    upload-form.tsx             # File input + notes textarea
    processing-status.tsx       # Progress indicator during processing
    notes-editor.tsx            # Markdown editor wrapper
    ticket-list.tsx             # List of proposed ticket cards
    ticket-card.tsx             # Individual ticket with edit controls
    video-capture.tsx           # Video player + screenshot tool (dialog)
    screenshot-preview.tsx      # Thumbnail of captured screenshot on ticket card
  lib/
    assemblyai.ts               # Transcription helper
    anthropic.ts                # AI analysis helper (loads config files, builds system prompt)
    jira.ts                     # Jira API helper (create issue, upload attachment)
    storage.ts                  # IndexedDB session persistence (using idb)
    types.ts                    # Shared TypeScript types
  config/
    writeup-format.md           # Editable: notes structure template (loaded into system prompt)
    teams.json                  # Editable: team name → Jira ID mapping (loaded into system prompt)
```

---

## Data flow

### Step 1: Upload (client-side)

User provides:
- **Audio file**: The .m4a audio file from the Zoom recording (~37 MB for a 1hr session). Zoom provides this as a separate file in the recording assets. This gets uploaded to AssemblyAI for transcription.
- **Video file**: The .mp4 recording (~330 MB for a 1hr session at 1920x1050). This stays in the browser (loaded into a `<video>` element via `URL.createObjectURL`). It is NEVER uploaded to the server. It's only used for screenshot capture in the review screen.
- **Facilitator notes**: Pasted into a textarea.
- **Zoom recording link + passcode**: A URL and passcode string. These get included in every Jira ticket description so engineers can access the full recording.
- **Participant name**: Text input. Used in the notes header and ticket descriptions.
- **Session date**: Date picker. Used in the notes header.

### Step 2: Transcription (server-side)

The audio file is uploaded to the server, which sends it to AssemblyAI:

```typescript
import { AssemblyAI } from 'assemblyai';

const client = new AssemblyAI({ apiKey: process.env.ASSEMBLYAI_API_KEY });

const transcript = await client.transcripts.transcribe({
  audio: audioBuffer,        // or a URL if hosted
  speaker_labels: true,       // Enable speaker diarization
  speakers_expected: 3,       // Facilitator + participant + maybe one observer
});

// Returns: transcript.utterances[] with .speaker, .text, .start, .end (milliseconds)
// Returns: transcript.words[] with .text, .start, .end, .speaker, .confidence
```

The response includes utterances (speaker-labeled segments with start/end timestamps in milliseconds) and word-level timestamps. Store the full response — the timestamps are used later for video seeking.

**Important:** Vercel serverless functions have a 60-second timeout on the Hobby plan. AssemblyAI transcription of a 1hr file takes a few minutes. You need to handle this asynchronously:
1. Submit the transcription job, get back a transcript ID
2. Return the ID to the client immediately
3. Client polls a status endpoint every 5 seconds until the transcript is ready
4. OR use AssemblyAI's webhook callback (preferred if possible with Vercel)

### Step 3: AI analysis (server-side)

Once the transcript is ready, send it to Claude along with the facilitator notes. This is one API call to the Anthropic SDK.

**Input to Claude:**
- The full transcript with speaker labels and timestamps
- The facilitator's notes (marked as PRIMARY source)
- The participant name, session date, and task description
- The Zoom recording link + passcode

**System prompt** (this encodes the analysis logic from the existing Claude skill):

The system prompt is assembled at runtime from two editable config files plus the static rules below. This makes the writeup format and team list easy to update without touching code.

**File: `src/config/writeup-format.md`** — Contains the notes structure (header table, task flow, bugs table, UX recommendations, etc.). Loaded at runtime and interpolated into the system prompt. Initialize this file with the content from the writeup format reference below, but it can be edited at any time to change the output format.

**File: `src/config/teams.json`** — Contains the team name → ID mapping. Loaded at runtime. Initialize with the team list from the Jira configuration section of this spec.

**Static prompt template (hardcoded in `lib/anthropic.ts`):**

```
You are a UX researcher processing a usability testing session. You will receive a transcript with speaker labels and timestamps, plus the facilitator's own notes.

SOURCE WEIGHTING:
- Facilitator notes = PRIMARY source. Trust these over the transcript.
- Transcript = SECONDARY source. Use for details, exact quotes, and reconstructing task flow.
- When they conflict, trust the facilitator notes.

OUTPUT FORMAT:
Return a JSON object with two top-level keys: "notes" and "tickets".

"notes" is a markdown string following this exact structure:
${writeupFormat}

"tickets" is an array of objects, each with:
{
  "title": "Short descriptive title",
  "type": "Bug" | "Task",
  "team": "team name from the allowed list",
  "teamId": "team ID string",
  "priority": "High" | "Medium" | "Low",
  "priorityId": "2" | "3" | "4",
  "description": "Detailed description with steps to reproduce for bugs, or observed behavior for improvements. End with: *This description was generated by Claude based on a user testing session transcript.*",
  "labels": ["ux-research"],
  "needsScreenshot": true | false,
  "suggestedTimestampMs": 123456 | null,
  "timestampContext": "Brief description of what should be visible at this moment" | null
}

TICKET RULES:
- Separate bugs (broken behavior) from improvements (Task type)
- Each ticket = one actionable item, not a theme
- For bugs: include steps to reproduce, expected vs actual behavior
- For improvements: frame around observed user behavior
- Never use Highest/Critical priority
- Always include the ux-research label
- Set needsScreenshot=true for bugs and issues that are unclear without visuals
- suggestedTimestampMs should point to the moment in the recording where the issue is most visible
- timestampContext describes what the reviewer should see at that timestamp

AVAILABLE TEAMS (use these exact names and IDs):
${teamList}

WRITING STYLE:
- Direct and specific, not academic
- Use the participant's name after introducing them
- Include exact quotes when illustrative
- Note when the facilitator had to intervene
- Reflect uncertainty when it exists
```

**Initial content for `src/config/writeup-format.md`:**

```markdown
HEADER TABLE:
| Field | Content |
|---|---|
| Date | Session date |
| Participant | Name, background, relevant experience, what they DON'T have experience with |
| Facilitator(s) | Who ran the session |
| Task | The end-to-end task the participant was asked to complete |
| Duration | Approximate session length |

TASK FLOW & KEY OBSERVATIONS:
Organize chronologically by what the participant did, not by feature area. Use numbered sections like:
1. Account Creation & First Impressions
2. Understanding the Core Concept
3. Next major task phase
Within each section use bullet points for individual observations. Bold key findings. Use format **Finding:** Explanation. Include exact quotes when illustrative. Note when the facilitator had to intervene.

BUGS TABLE:
| # | Bug | Details | Severity |
With severity values: High, Medium, Low (never Critical)

UX RECOMMENDATIONS:
Group by theme (not by task phase) like Navigation & Mental Model, Clickability & Affordances, etc. Use format **Recommendation:** Context and rationale.

DOCUMENTATION ISSUES:
If docs came up during the session, note problems separately.

WHAT WORKED WELL:
Always include positives.

PARTICIPANT CLOSING THOUGHT:
If the participant offered a summary reflection, include it.
```

**Output from Claude:** A JSON object with `notes` (markdown string) and `tickets` (array of ticket objects).

Parse the JSON and return it to the client. The client now has everything it needs to render the review screen.

### Step 4: Review (client-side)

The review screen has two main panels (use shadcn `Tabs` or a side-by-side layout with shadcn `Resizable`):

**Left panel: Notes editor**
- Uses `@uiw/react-md-editor` with the AI-generated markdown pre-filled
- User can edit freely
- "Copy to clipboard" button at the top (copies the markdown)
- The notes are the user's deliverable — they'll paste this into a Google Doc

**Right panel: Ticket list**
- Each ticket rendered as a shadcn `Card` containing:
  - `Checkbox` to include/exclude the ticket
  - Editable `Input` for the title
  - `Badge` showing Bug or Task (clickable to toggle)
  - `Select` dropdowns for Team and Priority (pre-filled from AI suggestions)
  - Editable `Textarea` for the description
  - If `needsScreenshot` is true: a "Capture screenshot" button that opens the video capture dialog
  - If a screenshot has already been captured: a thumbnail preview
- A "File approved tickets" button at the bottom

**Screenshot capture (dialog):**
When the user clicks "Capture screenshot" on a ticket:
1. Open a shadcn `Dialog` (large, near-fullscreen)
2. The dialog contains:
   - The HTML5 `<video>` element, seeked to `suggestedTimestampMs / 1000`
   - Standard video controls (play/pause, scrub)
   - A text note showing `timestampContext` ("You should see: the user clicking the plus button but nothing happening")
   - +1s / -1s / +5s / -5s buttons to nudge the timestamp
   - A "Capture" button
3. When "Capture" is clicked:
   - Draw the current video frame to an offscreen `<canvas>`
   - Export as PNG blob
   - Store in component state (associated with this ticket)
   - Close the dialog
   - Show a thumbnail preview on the ticket card

**Screenshot capture code (this is the entire implementation):**

```typescript
function captureScreenshot(videoElement: HTMLVideoElement): Promise<Blob> {
  return new Promise((resolve) => {
    const canvas = document.createElement('canvas');
    canvas.width = videoElement.videoWidth;
    canvas.height = videoElement.videoHeight;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(videoElement, 0, 0);
    canvas.toBlob((blob) => resolve(blob!), 'image/png');
  });
}
```

**Screenshot validation:**
After capturing, the app sends the screenshot to the `/api/validate-screenshot` endpoint, which calls Claude's vision API:

```typescript
const response = await anthropic.messages.create({
  model: 'claude-sonnet-4-20250514',
  max_tokens: 200,
  messages: [{
    role: 'user',
    content: [
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: screenshotBase64 } },
      { type: 'text', text: `This screenshot was captured from a UX testing session recording as evidence for this Jira ticket:\n\nTitle: ${ticket.title}\nDescription: ${ticket.description}\n\nExpected to show: ${ticket.timestampContext}\n\nDoes this screenshot appear to show what the ticket is describing? Reply with a JSON object: { "valid": true/false, "reason": "brief explanation" }` }
    ]
  }]
});
```

If the screenshot doesn't match, show a warning toast (shadcn `Sonner`) suggesting the user adjust the timestamp and recapture. Don't block them — it's a suggestion, not a gate.

### Step 5: File tickets (server-side)

When the user clicks "File approved tickets", the client sends the approved tickets (with screenshots as base64) to `/api/file-tickets`.

For each ticket:

1. **Create the Jira issue:**

```typescript
const issueBody = {
  fields: {
    project: { key: 'APP' },
    issuetype: { name: ticket.type },    // "Bug" or "Task"
    summary: ticket.title,
    description: buildDescription(ticket, zoomLink, zoomPasscode),
    priority: { id: ticket.priorityId },
    customfield_10074: [{ id: ticket.teamId }],  // Team (REQUIRED)
    labels: ticket.labels,
  }
};

const response = await fetch(`${JIRA_BASE_URL}/rest/api/3/issue`, {
  method: 'POST',
  headers: {
    'Authorization': `Basic ${Buffer.from(`${JIRA_USER_EMAIL}:${JIRA_API_TOKEN}`).toString('base64')}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify(issueBody),
});

const issue = await response.json(); // { id, key, self }
```

2. **Upload screenshot attachment (if present):**

```typescript
const formData = new FormData();
formData.append('file', new Blob([screenshotBuffer], { type: 'image/png' }), `${issue.key}-screenshot.png`);

await fetch(`${JIRA_BASE_URL}/rest/api/3/issue/${issue.key}/attachments`, {
  method: 'POST',
  headers: {
    'Authorization': `Basic ${Buffer.from(`${JIRA_USER_EMAIL}:${JIRA_API_TOKEN}`).toString('base64')}`,
    'X-Atlassian-Token': 'no-check',
  },
  body: formData,
});
```

3. **Build the ticket description:**

Every ticket description should end with:
```
---
**Recording:** [Zoom recording link](${zoomLink}) (Passcode: ${zoomPasscode})
**Timestamp:** ${formattedTimestamp} in the recording

*This ticket was generated from a UX testing session on ${sessionDate} with ${participantName}. Description generated by Claude.*
```

4. **Return results to client:**

Return an array of `{ ticketKey: "APP-1234", url: "https://viam.atlassian.net/browse/APP-1234", success: boolean }`.

The client shows a success toast for each filed ticket with a link to the Jira issue.

---

## Handling large audio files on Vercel

Vercel's serverless functions have a 4.5MB request body limit on the Hobby plan. A 1-hour audio file will exceed this. Two options:

**Option A (recommended): Direct upload to AssemblyAI from the client.**
AssemblyAI accepts audio via URL. The client can upload the audio file directly to AssemblyAI's upload endpoint (which returns a temporary URL), then pass that URL to your API route to start transcription. This avoids sending the audio through your Vercel function entirely.

```typescript
// Client-side: upload directly to AssemblyAI's upload endpoint
const uploadResponse = await fetch('https://api.assemblyai.com/v2/upload', {
  method: 'POST',
  headers: { 'Authorization': ASSEMBLYAI_API_KEY }, // NOTE: This means the key is exposed client-side
  body: audioFile,
});
const { upload_url } = await uploadResponse.json();
// Then pass upload_url to your API route
```

Problem: this exposes the AssemblyAI API key to the client. Since only 2-3 trusted people use this app, this is an acceptable tradeoff. Alternatively, you can proxy the upload through a Vercel Edge Function (which has a larger body limit of 4MB streaming) or use Vercel Blob Storage as an intermediary.

**Option B: Use Vercel Blob Storage.**
Upload the audio to Vercel Blob first (supports large files), get a URL, then pass that URL to AssemblyAI. This keeps all API keys server-side. Adds one more dependency (`@vercel/blob`) but is cleaner.

Go with Option B if IT has concerns about key exposure. Otherwise Option A is simpler.

---

## Polling for transcription status

Since transcription takes 1-5 minutes:

```typescript
// API route: POST /api/transcribe
// Starts the job and returns the transcript ID
export async function POST(req: Request) {
  const { audioUrl } = await req.json();
  const client = new AssemblyAI({ apiKey: process.env.ASSEMBLYAI_API_KEY! });

  // Submit the job (don't wait for completion)
  const transcript = await client.transcripts.submit({
    audio_url: audioUrl,
    speaker_labels: true,
    speakers_expected: 3,
  });

  return Response.json({ transcriptId: transcript.id });
}

// API route: GET /api/transcribe/[id]
// Client polls this until status is 'completed'
export async function GET(req: Request, { params }: { params: { id: string } }) {
  const client = new AssemblyAI({ apiKey: process.env.ASSEMBLYAI_API_KEY! });
  const transcript = await client.transcripts.get(params.id);

  return Response.json({
    status: transcript.status,          // 'queued' | 'processing' | 'completed' | 'error'
    utterances: transcript.status === 'completed' ? transcript.utterances : null,
    words: transcript.status === 'completed' ? transcript.words : null,
    text: transcript.status === 'completed' ? transcript.text : null,
  });
}
```

Client polls every 5 seconds and shows a progress indicator (shadcn `Progress` component) with status messages: "Uploading audio..." → "Transcribing (this takes 1-3 minutes)..." → "Analyzing with AI..." → "Done!"

---

## Viam-specific Jira configuration

Hardcode these values in `lib/jira.ts`:

- Cloud ID: `0e4716ff-dbb4-45e2-89a8-c5c898f5fba5`
- Project key: `APP`
- Issue types: Bug (ID: 10084), Task (ID: 10082). No other types.
- Required field: `customfield_10074` (Team) — always include, pass as `[{ id: "teamId" }]`
- Always add label: `ux-research`
- Max priority: High (ID: 2). Never use Highest (1).

Team dropdown options (hardcode in the UI):

| Team | ID |
|---|---|
| Computer Vision | 10405 |
| Core | 10532 |
| Data | 10506 |
| Design | 10371 |
| Developer Relations | 10251 |
| Documentation | 10247 |
| Fleet 1 | 10246 |
| Forward Deployed Eng | 10745 |
| Machine Learning | 10507 |
| Micro RDK | 10502 |
| Mobile | 10497 |
| Motion Execution | 10580 |
| Motion Planning | 10241 |
| NetCode | 10505 |
| Product | 10249 |
| SDK | 10504 |
| Solution Eng | 10530 |
| SRE | 10250 |
| Surface Finishing | 10712 |
| Sensing | 10613 |
| Visualization | 10529 |
| IT | 10513 |

---

## UI layout summary

### Screen 1: Upload (`/`)

Simple centered form:
- File input for audio file (`.m4a`, `.mp3`, `.wav`) — labeled "Audio recording"
- File input for video file (`.mp4`) — labeled "Video recording (stays in your browser, used for screenshots only)"
- Input for participant name
- Date picker for session date
- Textarea for facilitator notes
- Input for Zoom recording link
- Input for Zoom passcode
- "Process session" button

Use shadcn `Card` as the form container. Keep it clean.

### Screen 2: Review (`/session/[id]`)

Two-panel layout using shadcn `Resizable` (or just CSS grid with a fixed split):

**Left: Notes**
- `@uiw/react-md-editor` taking full height
- Toolbar at the top: "Copy markdown" button

**Right: Tickets**
- Scrollable list of `TicketCard` components
- Each card is collapsible (shadcn `Accordion` or `Collapsible`)
- Summary row (always visible): checkbox, title, type badge, team badge, screenshot indicator
- Expanded view: all editable fields + capture button
- Bottom bar (sticky): "File N approved tickets" button + count

### Screenshot dialog

shadcn `Dialog` at near-fullscreen size:
- Video player (native `<video>`, full width)
- Row of nudge buttons: -5s, -1s, +1s, +5s
- Current timestamp display
- Context note from AI: "Expected: [timestampContext]"
- "Capture screenshot" button
- If already captured: shows previous screenshot with "Recapture" option

---

## What NOT to build

- No user authentication (trusted internal tool, API keys are server-side)
- No database (session state persists in browser storage — see below)
- No file storage service (video stays in browser memory, audio goes direct to AssemblyAI)
- No video clip extraction (screenshots + Zoom recording links are sufficient)
- No email sending (user copies markdown and sends manually if needed)

---

## Session persistence

Use IndexedDB (via the `idb` npm package — add `npm install idb` to the install list) to persist session state in the browser. IndexedDB handles large blobs (screenshots) much better than localStorage, which has a ~5-10MB limit.

**What to persist (save on every meaningful edit):**
- Session metadata: participant name, date, Zoom link, passcode
- Facilitator notes (original input)
- Transcript data (the full AssemblyAI/VTT response — avoid re-transcribing)
- Notes markdown (the editable document)
- Tickets array (with all user edits to titles, descriptions, priorities, etc.)
- Screenshot blobs (stored as Blobs in IndexedDB, not base64)
- Processing status (which steps are complete)

**Behavior:**
- On the upload page, if a saved session exists, show a banner: "You have an in-progress session from [date] with [participant]. Resume or start new?" with two buttons.
- "Resume" navigates to the review screen with all state restored.
- "Start new" clears the saved session and shows the empty upload form.
- On the review screen, auto-save to IndexedDB on every change (debounced, ~2 seconds after last edit).
- After all tickets are successfully filed, show a prompt: "All tickets filed. Clear this session?" — don't auto-clear.
- Only store one session at a time. This is a processing tool, not a repository.

**IndexedDB schema:**
```typescript
interface SessionStore {
  id: 'current';                    // Always 'current' — one session at a time
  metadata: {
    participantName: string;
    sessionDate: string;
    zoomLink: string;
    zoomPasscode: string;
    createdAt: string;
  };
  facilitatorNotes: string;
  transcript: TranscriptData | null;  // The full AssemblyAI response
  notesMarkdown: string;
  tickets: TicketProposal[];
  screenshots: Record<string, Blob>;  // keyed by ticket index or ID
  status: 'uploading' | 'transcribing' | 'analyzing' | 'reviewing' | 'filed';
}
```

The video file is NOT persisted (too large at ~330 MB). If the user closes and reopens, they'll need to re-select the video file to capture new screenshots, but all existing screenshots are preserved. Show a note on resume: "Re-select the video file if you need to capture more screenshots."

---

## Build order (suggested)

1. **Scaffold**: Next.js + shadcn/ui + Tailwind setup, install all packages
2. **Upload form**: Build the UI for Screen 1 (static, no API calls yet)
3. **Transcription pipeline**: `/api/transcribe` route + polling logic + progress UI
4. **AI analysis**: `/api/analyze` route with the system prompt, parse JSON response
5. **Notes editor**: Wire up `@uiw/react-md-editor` with the AI-generated markdown
6. **Ticket list**: Render proposed tickets as editable cards
7. **Video + screenshot**: Video player dialog, canvas capture, validation call
8. **File tickets**: Jira API integration, attachment upload, success toasts
9. **Polish**: Error handling, loading states, edge cases

Each step is independently testable. Don't try to build everything at once.