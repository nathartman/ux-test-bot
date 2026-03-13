import { AssemblyAI } from "assemblyai";

const client = new AssemblyAI({
  apiKey: process.env.ASSEMBLYAI_API_KEY!,
});

export async function submitTranscription(audioUrl: string) {
  const transcript = await client.transcripts.submit({
    audio_url: audioUrl,
    speech_models: ["universal-3-pro", "universal-2"] as never,
    speaker_labels: true,
    speakers_expected: 3,
  });
  return { transcriptId: transcript.id };
}

export async function getTranscriptionStatus(id: string) {
  const transcript = await client.transcripts.get(id);
  return {
    status: transcript.status,
    utterances:
      transcript.status === "completed" ? transcript.utterances : null,
    words: transcript.status === "completed" ? transcript.words : null,
    text: transcript.status === "completed" ? transcript.text : null,
  };
}
