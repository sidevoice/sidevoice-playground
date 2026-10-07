// Audio in and out of the page, with no engine involved: record from the microphone or read an uploaded file into
// mono PCM at a chosen rate (Whisper wants 16 kHz), and play PCM back (Kokoro speaks at 24 kHz).

/** Decodes any audio file the browser understands into mono Float32 PCM at `rate`. */
export async function decodeToPcm(bytes, rate = 16000) {
  const decoded = await new AudioContext().decodeAudioData(bytes.slice(0));
  const frames = Math.ceil(decoded.duration * rate);
  const offline = new OfflineAudioContext(1, frames, rate);
  const source = offline.createBufferSource();
  source.buffer = decoded;
  source.connect(offline.destination);
  source.start();
  return { samples: (await offline.startRendering()).getChannelData(0), rate };
}

/** Starts recording; the returned `stop()` resolves to the recording as mono PCM at `rate`. */
export async function record(rate = 16000) {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const recorder = new MediaRecorder(stream);
  const chunks = [];
  recorder.ondataavailable = (event) => chunks.push(event.data);
  recorder.start();
  return {
    stop: () =>
      new Promise((resolve, reject) => {
        recorder.onstop = async () => {
          stream.getTracks().forEach((track) => track.stop());
          try {
            resolve(await decodeToPcm(await new Blob(chunks).arrayBuffer(), rate));
          } catch (error) {
            reject(error);
          }
        };
        recorder.stop();
      }),
  };
}

/** A WAV file (16-bit PCM, mono) of `samples` at `rate`, for an <audio> element or a download. */
export function toWav(samples, rate) {
  const view = new DataView(new ArrayBuffer(44 + samples.length * 2));
  const text = (at, s) => [...s].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)));
  text(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  text(8, "WAVEfmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, samples.length * 2, true);
  samples.forEach((s, i) => view.setInt16(44 + i * 2, Math.max(-1, Math.min(1, s)) * 0x7fff, true));
  return new Blob([view], { type: "audio/wav" });
}
