// The web's own types the mocks answer with. They resolve inside the web checkout the mocks are checked against:
// web-build.mjs copies this directory to <checkout>/.preview-mock/ and runs the web's TypeScript on it. Nothing at
// run time reads this file.
export type { Participant, RoomBinding, VoiceReply, VoiceSession } from "@sidevoice/protocol";
export type {
  LocalHostBridge, LocalHostInstallProgress, LocalHostPairing, LocalHostStatus, LocalHostVersion, LocalPairingCode, PairingsStore,
  ResetBridge,
} from "../apps/web/src/host/types";
export type { Pairing, PairingCodePayload } from "../apps/web/src/services/device-pairing";
export type { ModelCatalogs } from "../apps/web/src/services/model-catalogs.js";
export type {
  VoiceCallHost, VoiceCallState, VoiceHost, VoiceSayEvent, VoiceSaying, VoiceSayOutcome, VoiceSettings, VoiceTake, VoiceTurnEvent,
} from "@sidevoice/voice";
export type { CatalogStatus, LocalModelInfo, Progress, RemoteModelInfo, Voice } from "@sidevoice/engine";
