// The web's own types the mocks answer with. They resolve inside the web checkout the mocks are checked against:
// web-build.mjs copies this directory to <checkout>/.preview-mock/ and runs the web's TypeScript on it. Nothing at
// run time reads this file.
export type { Participant, RoomBinding } from "@sidevoice/protocol";
export type {
  LocalHostBridge, LocalHostInstallProgress, LocalHostPairing, LocalHostStatus, LocalHostVersion, LocalPairingCode,
} from "../apps/web/src/services/desktop-host";
export type { Pairing, PairingCodePayload } from "../apps/web/src/services/device-pairing";
