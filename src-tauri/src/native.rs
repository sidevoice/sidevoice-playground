//! The native engine: sidevoice-engine compiled into the app, on its built-in `NativeHost` and the bundled catalogue,
//! as Tauri commands that mirror what the page uses of a web build's `WebEngine` (web/engine/native.mjs wraps them
//! back into that shape). Its version is the one the app was built with: build.rs reads it from Cargo.lock.
//!
//! - `native_models`, `native_install`, `native_uninstall`, `native_load`: as `Engine`'s. An install or a load is a
//!   job the page names: its progress comes as `native-progress` events (`{ job, files, done, received, size }`), and
//!   `native_cancel` cancels it.
//! - A loaded model is a handle (a number) the page holds until `native_free`; `native_voices`, `native_speak` and
//!   `native_transcribe` take it. Audio crosses as raw bytes: little-endian f32 samples (transcribe's body; speak's
//!   answer, after a 4-byte little-endian sample rate).
//! - A failure rejects with `{ code, params, message? }`: the engine's stable code, as a web build's errors carry it.
//!
//! The engine's futures run on the app's Tokio runtime, each on a blocking thread, so inference never holds up the
//! runtime's workers.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::time::{Duration, Instant};

use serde::Serialize;
use serde_json::Value;
use sidevoice_engine::{BundledCatalog, Cancel, Engine, LoadedModel, NativeHost, Progress};
use tauri::ipc::{InvokeBody, Request, Response};
use tauri::{AppHandle, Emitter, State};

use crate::values;

/// The engine this app was built with.
const VERSION: &str = env!("SIDEVOICE_ENGINE_VERSION");
const REV: &str = env!("SIDEVOICE_ENGINE_REV");

/// How often an install's progress reaches the page at most, besides each file done.
const PROGRESS_EVERY: Duration = Duration::from_millis(100);

/// The engine, the models loaded through it by handle, and the jobs under way by the page's name for them.
pub struct Native {
    engine: Result<Arc<Engine>, String>,
    data_dir: PathBuf,
    loaded: Mutex<HashMap<u32, LoadedModel>>,
    jobs: Mutex<HashMap<String, Cancel>>,
    next: AtomicU32,
}

impl Native {
    /// The engine on a `NativeHost` keeping its files in `data_dir`. If it cannot be built, every command says why.
    pub fn new(data_dir: PathBuf) -> Self {
        let engine = NativeHost::new(&data_dir)
            .map_err(|error| format!("NativeHost: {error}"))
            .and_then(|host| {
                Engine::new(Box::new(host), vec![Box::new(BundledCatalog)])
                    .map_err(|error| format!("Engine::new: {error}"))
            })
            .map(Arc::new);
        Self {
            engine,
            data_dir,
            loaded: Mutex::default(),
            jobs: Mutex::default(),
            next: AtomicU32::new(1),
        }
    }

    fn engine(&self) -> Result<Arc<Engine>, Coded> {
        self.engine.clone().map_err(|message| Coded {
            message: Some(message),
            ..Coded::new("engine-unavailable")
        })
    }

    fn model(&self, handle: u32) -> Result<LoadedModel, Coded> {
        lock(&self.loaded)
            .get(&handle)
            .cloned()
            .ok_or_else(|| Coded::new("model-not-loaded"))
    }

    /// A new job named `job`, cancellable with `native_cancel` until it ends.
    fn start(&self, job: &str) -> Cancel {
        let cancel = Cancel::new();
        lock(&self.jobs).insert(job.to_owned(), cancel.clone());
        cancel
    }

    fn end(&self, job: &str) {
        lock(&self.jobs).remove(job);
    }
}

/// An engine failure as the page sees it: a web build's `Error` carries the same `code` and `params`.
#[derive(Debug, Serialize)]
pub struct Coded {
    code: String,
    params: serde_json::Map<String, Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    message: Option<String>,
}

impl Coded {
    fn new(code: &str) -> Self {
        Self {
            code: code.to_owned(),
            params: serde_json::Map::new(),
            message: None,
        }
    }

    fn internal(message: impl ToString) -> Self {
        Self {
            message: Some(message.to_string()),
            ..Self::new("internal")
        }
    }
}

impl From<sidevoice_engine::Error> for Coded {
    fn from(error: sidevoice_engine::Error) -> Self {
        Self::new(error.code)
    }
}

/// `work` on a blocking thread, its engine future driven there by the app's runtime.
async fn run<T: Send + 'static>(
    work: impl FnOnce() -> Result<T, Coded> + Send + 'static,
) -> Result<T, Coded> {
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(Coded::internal)?
}

fn block_on<F: std::future::Future>(future: F) -> F::Output {
    tauri::async_runtime::block_on(future)
}

/// What tells the page how far job `job` has got: each file done, and the bytes at most every `PROGRESS_EVERY`.
fn reporter(app: AppHandle, job: String) -> impl Fn(Progress) + Send + Sync {
    let last = Mutex::new((usize::MAX, Instant::now()));
    move |progress: Progress| {
        let mut last = lock(&last);
        if progress.done == last.0 && last.1.elapsed() < PROGRESS_EVERY {
            return;
        }
        *last = (progress.done, Instant::now());
        if let Err(error) = app.emit("native-progress", values::progress(&job, &progress)) {
            eprintln!("native-progress: {error}");
        }
    }
}

/// `{ version, rev, dataDir, error? }`: the engine compiled into this app, where it keeps its models, and why it
/// could not be built, if it could not.
#[tauri::command]
pub fn native_info(state: State<'_, Native>) -> Value {
    serde_json::json!({
        "version": VERSION,
        "rev": REV,
        "dataDir": state.data_dir,
        "error": state.engine.as_ref().err(),
    })
}

/// Every model of the catalogue, as `WebEngine.models()` lists it.
#[tauri::command]
pub async fn native_models(state: State<'_, Native>) -> Result<Vec<Value>, Coded> {
    let engine = state.engine()?;
    run(move || {
        let models = block_on(engine.models())?;
        Ok(models.iter().map(values::model).collect())
    })
    .await
}

/// Installs `build` of `model` (the engine's choice with none) as job `job`.
#[tauri::command]
pub async fn native_install(
    app: AppHandle,
    state: State<'_, Native>,
    model: String,
    build: Option<String>,
    job: String,
) -> Result<(), Coded> {
    let engine = state.engine()?;
    let cancel = state.start(&job);
    let progress = reporter(app, job.clone());
    let result = run(move || {
        block_on(engine.install(&model, build.as_deref(), &progress, &cancel))?;
        Ok(())
    })
    .await;
    state.end(&job);
    result
}

/// Removes `model`'s files, except those another model uses; `model-in-use` while a handle of it is held.
#[tauri::command]
pub async fn native_uninstall(state: State<'_, Native>, model: String) -> Result<(), Coded> {
    let engine = state.engine()?;
    run(move || Ok(block_on(engine.uninstall(&model))?)).await
}

/// Loads `build` of `model` (installing it first if need be) as job `job`: `{ handle, model, build, capabilities }`.
#[tauri::command]
pub async fn native_load(
    app: AppHandle,
    state: State<'_, Native>,
    model: String,
    build: Option<String>,
    job: String,
) -> Result<Value, Coded> {
    let engine = state.engine()?;
    let cancel = state.start(&job);
    let progress = reporter(app, job.clone());
    let result = run(move || {
        Ok(block_on(engine.load(
            &model,
            build.as_deref(),
            &progress,
            &cancel,
        ))?)
    })
    .await;
    state.end(&job);
    let loaded = result?;
    let handle = state.next.fetch_add(1, Ordering::Relaxed);
    let described = values::loaded(handle, &loaded);
    lock(&state.loaded).insert(handle, loaded);
    Ok(described)
}

/// Cancels job `job`: it rejects with `cancelled`, leaving nothing half downloaded. True if it was under way.
#[tauri::command]
pub fn native_cancel(state: State<'_, Native>, job: String) -> bool {
    let jobs = lock(&state.jobs);
    let Some(cancel) = jobs.get(&job) else {
        return false;
    };
    cancel.cancel();
    true
}

/// Lets go of `handle`: the model leaves memory once no handle of its build is held. True if it was held.
#[tauri::command]
pub async fn native_free(state: State<'_, Native>, handle: u32) -> Result<bool, Coded> {
    let Some(loaded) = lock(&state.loaded).remove(&handle) else {
        return Ok(false);
    };
    // Unloading frees the model's memory: off the runtime's workers too.
    run(move || {
        drop(loaded);
        Ok(true)
    })
    .await
}

/// The voices of the text-to-speech model `handle`, as `tts.voices()` gives them.
#[tauri::command]
pub async fn native_voices(state: State<'_, Native>, handle: u32) -> Result<Vec<Value>, Coded> {
    let loaded = state.model(handle)?;
    run(move || {
        let tts = loaded
            .as_tts()
            .ok_or_else(|| Coded::new("model-cannot-speak"))?;
        Ok(block_on(tts.voices()).iter().map(values::voice).collect())
    })
    .await
}

/// `text` spoken by the model `handle`: 4 bytes of sample rate (u32 LE), then the samples (f32 LE).
#[tauri::command]
pub async fn native_speak(
    state: State<'_, Native>,
    handle: u32,
    text: String,
    voice: String,
    language: Option<String>,
    speed: Option<f32>,
) -> Result<Response, Coded> {
    let loaded = state.model(handle)?;
    run(move || {
        let tts = loaded
            .as_tts()
            .ok_or_else(|| Coded::new("model-cannot-speak"))?;
        let audio = block_on(tts.speak(&text, &voice, language.as_deref(), speed))?;
        Ok(Response::new(values::audio_bytes(
            audio.sample_rate,
            &audio.samples,
        )))
    })
    .await
}

/// What the model in `x-handle` hears in the body (f32 LE samples at `x-sample-rate` Hz), in `x-language` (empty or
/// absent: the model detects it).
#[tauri::command]
pub async fn native_transcribe(
    state: State<'_, Native>,
    request: Request<'_>,
) -> Result<String, Coded> {
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err(Coded::internal("send the audio as raw bytes"));
    };
    let header = |name: &str| {
        request
            .headers()
            .get(name)
            .and_then(|value| value.to_str().ok())
    };
    let number = |name: &str| {
        header(name)
            .and_then(|value| value.parse().ok())
            .ok_or_else(|| Coded::internal(format!("missing or bad header {name}")))
    };
    let loaded = state.model(number("x-handle")?)?;
    let rate: u32 = number("x-sample-rate")?;
    let language = header("x-language")
        .filter(|l| !l.is_empty())
        .map(str::to_owned);
    let samples = values::samples(bytes);
    run(move || {
        let stt = loaded
            .as_stt()
            .ok_or_else(|| Coded::new("model-cannot-transcribe"))?;
        Ok(block_on(stt.transcribe(
            &samples,
            rate,
            language.as_deref(),
        ))?)
    })
    .await
}

/// A poisoned lock still holds whole values: nothing here is left half done by a panic.
fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}
