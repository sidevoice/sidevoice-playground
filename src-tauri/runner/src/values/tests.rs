use serde_json::json;
use sidevoice_engine::{
    Accelerator, Capability, Gender, LocalModelInfo, ModelBuild, Reason, SpeedRange, Voice,
};

use super::{decode_samples, encode_samples, model};

/// The shape a web build's `models()` gives JavaScript.
#[test]
fn a_model_reads_as_the_web_build_lists_it() {
    let listed = LocalModelInfo {
        id: "kokoro-82m-v1.0".into(),
        family: "kokoro".into(),
        capabilities: vec![Capability::Tts],
        parameters_m: 82,
        languages: vec!["en".into(), "es".into()],
        license: "Apache-2.0".into(),
        voices: vec![Voice {
            id: "af_bella".into(),
            name: None,
            languages: vec!["en".into()],
            gender: Some(Gender::Female),
        }],
        speed: Some(SpeedRange { min: 0.5, max: 2.0 }),
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
            "speed": { "min": 0.5, "max": 2.0 },
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
fn audio_crosses_as_base64_of_little_endian_f32() {
    let text = encode_samples(&[0.5, -1.0]);
    assert_eq!(text, "AAAAPwAAgL8=");
    assert_eq!(decode_samples(&text), Some(vec![0.5, -1.0]));
    assert_eq!(decode_samples("AAAA"), Some(Vec::new()));
    assert_eq!(decode_samples("not base64!"), None);
}
