/**
 * Meeting transcription — the provider slot.
 *
 * ZERO-COST MODE: V1 has NO transcription provider. Meeting Intelligence
 * works from the written record (Meeting Chat and meeting notes) and says so.
 * A future provider (a paid LiveKit/Deepgram path, an optional browser Beta,
 * another free service) implements this interface; nothing else changes:
 * its segments become one more untrusted, referenced source.
 */

export type TranscriptSegment = {
  meetingId: string;
  /** LiveKit participant identity — never inferred from the text. */
  participantIdentity: string | null;
  speakerLabel: string;
  startMs: number;
  endMs: number;
  text: string;
  confidence: number | null;
  /** Where the text came from, shown next to it (e.g. "Browser transcription (Beta)"). */
  source: string;
};

export interface TranscriptionProvider {
  readonly id: "none" | "browser-beta" | "livekit-egress";
  /** Shown to people: what this provider is and how far to trust it. */
  readonly label: string;
  /** Whether a host may start it at all (configured, and within cost rules). */
  available(): boolean;
}

/** The only provider in V1: nothing is transcribed, and nothing pretends to be. */
export const NO_TRANSCRIPTION: TranscriptionProvider = {
  id: "none",
  label: "Transcript unavailable",
  available: () => false,
};

export const transcriptionProvider = (): TranscriptionProvider => NO_TRANSCRIPTION;
