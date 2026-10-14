// The web's own types the mocks answer with. They resolve inside the web checkout the mocks are checked against:
// web-build.mjs copies this directory to <checkout>/.preview-mock/ and runs the web's TypeScript on it. Nothing at
// run time reads this file.
export type { Participant, RoomBinding, VoiceReply, VoiceSession } from "@sidevoice/protocol";
export type {
  LocalHostBridge, LocalHostInstallProgress, LocalHostPairing, LocalHostStatus, LocalHostVersion, LocalPairingCode,
} from "../apps/web/src/services/desktop-host";
export type { Pairing, PairingCodePayload } from "../apps/web/src/services/device-pairing";
export type { ModelCatalogs } from "../apps/web/src/services/model-catalogs.js";
export type {
  VoiceCallState, VoiceHost, VoiceSayEvent, VoiceSaying, VoiceSayOutcome, VoiceSettings, VoiceTurnEvent,
} from "@sidevoice/voice";
export type { CatalogStatus, LocalModelInfo, Progress, RemoteModelInfo, Voice } from "@sidevoice/engine";

// A try's take: sidevoice-web's seam pending in @sidevoice/voice (the web's contract gap #40, its
// apps/web/src/services/voice-take.ts). Declared here rather than imported, so that the mocks still check against a web
// without it (a failed check refuses the mocked preview); once the voice module ships it, it comes from
// "@sidevoice/voice" with the rest.
import type { VoiceHost as Host } from "@sidevoice/voice";
export interface VoiceTakeTurn {
  turn_id: string;
  speech_ms: number;
  pauses: { from_ms: number; to_ms: number }[];
  end_ms: number | null;
}
export interface VoiceTake {
  sampleRate: number;
  samples: Float32Array;
  started_at: number;
  ended_at: number;
  turns: VoiceTakeTurn[];
}
export type TakingVoiceHost = Host & {
  start(options?: { take?: boolean }): Promise<void>;
  onTake?(listener: (take: VoiceTake) => void): () => void;
  /** Optional output telemetry, normalized 0–1; independent of onLevel's microphone samples. */
  onPlaybackLevel?(listener: (level: number) => void): () => void;
};
