use serde_json::json;
use sidevoice_engine::{Accelerator, Capability, Gender, Model, ModelBuild, Reason, Voice};

use super::{audio_bytes, model, samples};

/// The shape the page's screens read (web/catalog.mjs), as the engine's web build gives it.
#[test]
fn a_model_reads_as_the_web_build_lists_it() {
    let listed = Model {
        id: "kokoro-82m-v1.0".into(),
        family: "kokoro".into(),
        capabilities: vec![Capability::Tts],
        parameters_m: 82,
        languages: vec!["en".into(), "es".into()],
        license: "Apache-2.0".into(),
        voices: vec![Voice {
            id: "af_bella".into(),
            languages: vec!["en".into()],
            gender: Some(Gender::Female),
        }],
        installed: false,
        builds: vec![
            ModelBuild {
                id: "kokoro-82m-v1.0-sherpa-onnx-fp32".into(),
                backend: "sherpa-onnx".into(),
                accelerator: Some(Accelerator::CoreMl),
                precision: "fp32".into(),
                download_bytes: 300,
                memory_mb: 400,
                available: true,
                reasons: vec![],
                installed: false,
            },
            ModelBuild {
                id: "kokoro-82m-v1.0-transformers-js-q8".into(),
                backend: "transformers-js".into(),
                accelerator: None,
                precision: "q8".into(),
                download_bytes: 90,
                memory_mb: 200,
                available: false,
                reasons: vec![
                    Reason::with_numbers("memory", 4096, 2048),
                    Reason::new("backend-not-in-this-build"),
                ],
                installed: false,
            },
        ],
        recommended_build: Some("kokoro-82m-v1.0-sherpa-onnx-fp32".into()),
    };
    assert_eq!(
        model(&listed),
        json!({
            "id": "kokoro-82m-v1.0",
            "family": "kokoro",
            "capabilities": ["tts"],
            "parametersM": 82,
            "languages": ["en", "es"],
            "license": "Apache-2.0",
            "voices": [{ "id": "af_bella", "languages": ["en"], "gender": "female" }],
            "installed": false,
            "builds": [
                {
                    "id": "kokoro-82m-v1.0-sherpa-onnx-fp32", "backend": "sherpa-onnx", "accelerator": "coreml",
                    "precision": "fp32", "downloadBytes": 300, "memoryMb": 400, "available": true, "reasons": [],
                    "installed": false,
                },
                {
                    "id": "kokoro-82m-v1.0-transformers-js-q8", "backend": "transformers-js", "accelerator": null,
                    "precision": "q8", "downloadBytes": 90, "memoryMb": 200, "available": false,
                    "reasons": [
                        { "code": "memory", "params": { "needs": 4096, "has": 2048 } },
                        { "code": "backend-not-in-this-build", "params": {} },
                    ],
                    "installed": false,
                },
            ],
            "recommendedBuild": "kokoro-82m-v1.0-sherpa-onnx-fp32",
        })
    );
}

#[test]
fn audio_crosses_as_little_endian_bytes() {
    let bytes = audio_bytes(24_000, &[0.5, -1.0]);
    assert_eq!(&bytes[..4], &24_000u32.to_le_bytes());
    assert_eq!(samples(&bytes[4..]), vec![0.5, -1.0]);
    assert_eq!(samples(&[0, 0, 0]), Vec::<f32>::new());
}
