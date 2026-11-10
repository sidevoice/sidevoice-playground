// What the app's own helpers say of a model and its builds, as it says it (sidevoice-web ModelSetup.tsx sizeText,
// model-facts.tsx, model-languages.ts), in Spanish, for the recommender design sheet. No DOM.
import { COPY } from "./recommender-data.mjs";

/** `{name}` placeholders of a message filled in. */
export const fmt = (text, params = {}) => text.replace(/\{(\w+)\}/g, (_, name) => params[name] ?? "");

/** Bytes as people read them: MB below a gigabyte, else GB (ModelSetup.tsx sizeText). */
export function sizeText(bytes, language = "es") {
  if (!bytes) return "";
  const format = (value, unit) => value.toLocaleString(language, { maximumFractionDigits: value < 10 ? 1 : 0 }) + " " + unit;
  return bytes >= 1e9 ? format(bytes / 1e9, "GB") : format(Math.max(1, bytes / 1e6), "MB");
}
/** Megabytes, as people read them. */
export const mb = (value) => sizeText(value * 1e6);

/** A language's name in the interface's language (Spanish), as the panes list it (model-languages.ts languageName). */
export function languageName(tag) {
  try { return new Intl.DisplayNames(["es"], { type: "language" }).of(tag) ?? tag; } catch { return tag; }
}

const ENGINES = { "transformers-js": "Transformers.js", "sherpa-onnx": "Sherpa-ONNX", "whisper-cpp": "whisper.cpp", onnxruntime: "ONNX Runtime", mlx: "MLX" };
const GPU_APIS = { metal: "Metal", cuda: "CUDA", webgpu: "WebGPU" };

/** Its engine and precision. */
export const engineOf = (build) => [ENGINES[build.backend] ?? build.backend, build.precision].filter(Boolean).join(" · ");
/** What a build runs on, from the class the engine resolved for the device ("" for none). */
export const runsOn = (build) => build.acceleratorClass === "gpu" ? fmt(COPY["runtime.on.gpu"], { api: GPU_APIS[build.accelerator] ?? build.accelerator })
  : build.acceleratorClass === "cpu" ? COPY["runtime.on.cpu"] : "";
/** Its engine, precision and what it runs on: a build as the builds list names it. */
export const describeBuild = (build) => [engineOf(build), runsOn(build)].filter(Boolean).join(" · ");
/** Its download and its memory, as the builds list says them. */
export const buildSizes = (build) => fmt(COPY["runtime.sizes"], { download: mb(build.downloadMb), memory: mb(build.memoryMb) });
/** The hardware as the spec sheet and the Model list name it: the class, then the technical name where it says more. */
export function hardware(build) {
  const main = build.acceleratorClass === "gpu" ? COPY["runtime.hardware.gpu"] : build.acceleratorClass === "cpu" ? COPY["runtime.hardware.cpu"] : "";
  const name = build.acceleratorClass === "gpu" ? GPU_APIS[build.accelerator] ?? build.accelerator : "";
  return main ? { main, name: name && name !== main ? name : "" } : null;
}
