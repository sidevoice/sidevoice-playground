//! The engine's values as the runner answers them: the shapes sidevoice-engine's web build gives JavaScript (`Model`,
//! `ModelBuild`, `Reason`, `Voice`, `Progress`, in camelCase), so whoever reads a web build reads the runner alike.
//! Enums go by their stable ids, which are their names in lower case (`cpu`, `coreml`, `stt`, `female`). Audio
//! samples cross as base64 of little-endian f32.

use std::fmt::Debug;

use base64::engine::general_purpose::STANDARD;
use base64::Engine as _;
use serde_json::{json, Map, Value};
use sidevoice_engine::{
    Capability, LocalModel, LocalModelInfo, ModelBuild, Progress, Reason, SpeedRange, Voice,
};

#[cfg(test)]
mod tests;

/// A model, as `models()` lists it.
pub fn model(model: &LocalModelInfo) -> Value {
    let mut value = json!({
        "id": model.id,
        "family": model.family,
        "capabilities": model.capabilities.iter().map(capability).collect::<Vec<_>>(),
        "parametersM": model.parameters_m,
        "languages": model.languages,
        "license": model.license,
        "voices": model.voices.iter().map(voice).collect::<Vec<_>>(),
        "installed": model.installed,
        "builds": model.builds.iter().map(build).collect::<Vec<_>>(),
        "recommendedBuild": model.recommended_build,
    });
    if let Some(range) = model.speed {
        value["speed"] = speed(range);
    }
    value
}

/// `{ min, max }`: the speeds a model takes.
fn speed(range: SpeedRange) -> Value {
    json!({ "min": range.min, "max": range.max })
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

/// `{ id, name?, languages, gender? }`.
pub fn voice(voice: &Voice) -> Value {
    let mut value = json!({ "id": voice.id, "languages": voice.languages });
    if let Some(name) = &voice.name {
        value["name"] = name.as_str().into();
    }
    if let Some(gender) = voice.gender {
        value["gender"] = id(gender).into();
    }
    value
}

/// `{ event: "progress", job, files, done, received, size }`: how far job `job` has got.
pub fn progress(job: &str, progress: &Progress) -> Value {
    json!({
        "event": "progress",
        "job": job,
        "files": progress.files,
        "done": progress.done,
        "received": progress.received,
        "size": progress.size,
    })
}

/// What `load` answers: the handle the caller holds, and what the model can do.
pub fn loaded(handle: u32, loaded: &LocalModel) -> Value {
    json!({
        "handle": handle,
        "model": loaded.id(),
        "build": loaded.build(),
        "capabilities": loaded.capabilities().iter().map(capability).collect::<Vec<_>>(),
    })
}

/// Samples as base64 of their little-endian f32 bytes.
pub fn encode_samples(samples: &[f32]) -> String {
    let bytes: Vec<u8> = samples
        .iter()
        .flat_map(|sample| sample.to_le_bytes())
        .collect();
    STANDARD.encode(bytes)
}

/// Samples from base64 of little-endian f32 bytes, a trailing partial sample ignored; None if it is not base64.
pub fn decode_samples(text: &str) -> Option<Vec<f32>> {
    let bytes = STANDARD.decode(text).ok()?;
    let (chunks, _) = bytes.as_chunks::<4>();
    Some(
        chunks
            .iter()
            .map(|chunk| f32::from_le_bytes(*chunk))
            .collect(),
    )
}

/// A capability's id, as a web build names it: `end-of-turn`, else its name in lower case.
fn capability(capability: &Capability) -> String {
    match capability {
        Capability::EndOfTurn => "end-of-turn".to_owned(),
        other => id(other),
    }
}

/// An engine enum's stable id: its name in lower case (`CoreMl` → `coreml`).
fn id(value: impl Debug) -> String {
    format!("{value:?}").to_lowercase()
}
