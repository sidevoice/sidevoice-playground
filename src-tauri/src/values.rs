//! The engine's values as the page reads them: the shapes sidevoice-engine's web build gives JavaScript (`Model`,
//! `ModelBuild`, `Reason`, `Voice`, `Progress`, in camelCase), so the page's screens read either engine alike. Enums
//! go by their stable ids, which are their names in lower case (`cpu`, `coreml`, `stt`, `female`).

use std::fmt::Debug;

use serde_json::{json, Map, Value};
use sidevoice_engine::{LoadedModel, Model, ModelBuild, Progress, Reason, Voice};

#[cfg(test)]
mod tests;

/// A model, as `models()` lists it.
pub fn model(model: &Model) -> Value {
    json!({
        "id": model.id,
        "family": model.family,
        "capabilities": model.capabilities.iter().map(id).collect::<Vec<_>>(),
        "parametersM": model.parameters_m,
        "languages": model.languages,
        "license": model.license,
        "voices": model.voices.iter().map(voice).collect::<Vec<_>>(),
        "installed": model.installed,
        "builds": model.builds.iter().map(build).collect::<Vec<_>>(),
        "recommendedBuild": model.recommended_build,
    })
}

fn build(build: &ModelBuild) -> Value {
    json!({
        "id": build.id,
        "backend": build.backend,
        "accelerator": build.accelerator.map(id),
        "precision": build.precision,
        "downloadBytes": build.download_bytes,
        "memoryMb": build.memory_mb,
        "available": build.available,
        "reasons": build.reasons.iter().map(reason).collect::<Vec<_>>(),
        "installed": build.installed,
    })
}

/// Why a build does not run here: `{ code, params: { needs?, has? } }`.
fn reason(reason: &Reason) -> Value {
    let mut params = Map::new();
    if let Some(needs) = reason.needs {
        params.insert("needs".into(), needs.into());
    }
    if let Some(has) = reason.has {
        params.insert("has".into(), has.into());
    }
    json!({ "code": reason.code, "params": params })
}

/// `{ id, languages, gender? }`.
pub fn voice(voice: &Voice) -> Value {
    let mut value = json!({ "id": voice.id, "languages": voice.languages });
    if let Some(gender) = voice.gender {
        value["gender"] = id(gender).into();
    }
    value
}

/// `{ job, files, done, received, size }`, the payload of a `native-progress` event.
pub fn progress(job: &str, progress: &Progress) -> Value {
    json!({
        "job": job,
        "files": progress.files,
        "done": progress.done,
        "received": progress.received,
        "size": progress.size,
    })
}

/// What `native_load` answers: the handle the page holds, and what the model can do.
pub fn loaded(handle: u32, loaded: &LoadedModel) -> Value {
    json!({
        "handle": handle,
        "model": loaded.id(),
        "build": loaded.build(),
        "capabilities": loaded.capabilities().iter().map(id).collect::<Vec<_>>(),
    })
}

/// Spoken audio for the page: its sample rate (u32 LE), then its samples (f32 LE).
pub fn audio_bytes(sample_rate: u32, samples: &[f32]) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(4 + samples.len() * 4);
    bytes.extend_from_slice(&sample_rate.to_le_bytes());
    for sample in samples {
        bytes.extend_from_slice(&sample.to_le_bytes());
    }
    bytes
}

/// Samples from the page: f32 LE, a trailing partial sample ignored.
pub fn samples(bytes: &[u8]) -> Vec<f32> {
    bytes
        .chunks_exact(4)
        .map(|chunk| f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]))
        .collect()
}

/// An engine enum's stable id: its name in lower case (`CoreMl` → `coreml`).
fn id(value: impl Debug) -> String {
    format!("{value:?}").to_lowercase()
}
