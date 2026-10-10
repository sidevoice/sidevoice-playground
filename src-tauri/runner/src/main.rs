//! sidevoice-engine's native build as a process of its own: the engine on its built-in `NativeHost` and bundled
//! catalogue, driven by one JSON object per line on stdin and answering one per line on stdout. Its operations mirror
//! what a web build's `WebEngine` offers, and its values are the shapes a web build gives JavaScript (`values`).
//!
//! ```text
//! → { "id": 1, "op": "hello" }        ← { "id": 1, "ok": { "protocol": 1, "engine": "0.1.0", "rev": "<sha>", "dataDir" } }
//! → { "id": 2, "op": "models" }       ← { "id": 2, "ok": [<model>, ...] }
//! → { "id": 3, "op": "install", "model", "build"?, "job" }
//!                                     ← { "event": "progress", "job", "files", "done", "received", "size" } ...
//!                                     ← { "id": 3, "ok": null }
//! → { "id": 4, "op": "load", "model", "build"?, "job" }   ← { "id": 4, "ok": { "handle", "model", "build", "capabilities" } }
//! → { "id": 5, "op": "uninstall", "model", "build"? }     → { "id": 6, "op": "cancel", "job" }
//! → { "id": 7, "op": "voices", "handle" }                 → { "id": 8, "op": "free", "handle" }
//! → { "id": 9, "op": "speak", "handle", "text", "voice", "language"?, "speed"? }
//!                                     ← { "id": 9, "ok": { "sampleRate", "samples": "<base64 f32 LE>" } }
//! → { "id": 10, "op": "transcribe", "handle", "samples": "<base64 f32 LE>", "sampleRate", "language"? }
//!                                     ← { "id": 10, "ok": "the text" }
//! ```
//!
//! A failure answers `{ id, error: { code, params, message? } }`, the engine's stable code as a web build's errors
//! carry it. Requests run concurrently; an install or a load is a job its caller names, which `cancel` stops. When
//! stdin closes, the runner answers what it was asked and ends. Nothing but replies is written to stdout.
//!
//!     sidevoice-engine-runner --data-dir <directory for the engine's files>

mod values;

use std::collections::HashMap;
use std::io::{BufRead, Write};
use std::path::PathBuf;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::time::{Duration, Instant};

use serde_json::{json, Map, Value};
use sidevoice_engine::{BundledCatalog, Cancel, Engine, LocalModel, NativeHost, Progress};
use tokio::runtime::Handle;

/// The version of this protocol: what `hello` says.
const PROTOCOL: u32 = 1;
/// The engine this runner was built with, read from Cargo.lock by build.rs.
const VERSION: &str = env!("SIDEVOICE_ENGINE_VERSION");
const REV: &str = env!("SIDEVOICE_ENGINE_REV");

/// How often an install's progress is told at most, besides each file done.
const PROGRESS_EVERY: Duration = Duration::from_millis(100);

/// A failure as the caller sees it: a web build's `Error` carries the same `code` and `params`.
struct Coded {
    code: String,
    message: Option<String>,
}

impl Coded {
    fn new(code: &str) -> Self {
        Self {
            code: code.to_owned(),
            message: None,
        }
    }

    fn with(code: &str, message: impl ToString) -> Self {
        Self {
            code: code.to_owned(),
            message: Some(message.to_string()),
        }
    }

    fn value(&self) -> Value {
        let mut value = json!({ "code": self.code, "params": {} });
        if let Some(message) = &self.message {
            value["message"] = message.clone().into();
        }
        value
    }
}

impl From<sidevoice_engine::Error> for Coded {
    fn from(error: sidevoice_engine::Error) -> Self {
        Self::new(error.code)
    }
}

/// The engine, the models loaded through it by handle, and the jobs under way by their caller's name.
struct Runner {
    engine: Engine,
    data_dir: PathBuf,
    loaded: Mutex<HashMap<u32, LocalModel>>,
    jobs: Mutex<HashMap<String, Cancel>>,
    next: AtomicU32,
    out: Mutex<std::io::Stdout>,
    runtime: Handle,
}

impl Runner {
    /// One line on stdout, whole.
    fn send(&self, value: &Value) {
        let mut out = lock(&self.out);
        let written = writeln!(out, "{value}").and_then(|()| out.flush());
        if written.is_err() {
            // Whoever started the runner is gone.
            std::process::exit(0);
        }
    }

    fn model(&self, handle: u32) -> Result<LocalModel, Coded> {
        lock(&self.loaded)
            .get(&handle)
            .cloned()
            .ok_or_else(|| Coded::new("model-not-loaded"))
    }

    /// What tells the caller how far job `job` has got: each file done, and the bytes at most every PROGRESS_EVERY.
    fn reporter<'a>(&'a self, job: &'a str) -> impl Fn(Progress) + Send + Sync + 'a {
        let last = Mutex::new((usize::MAX, Instant::now()));
        move |progress: Progress| {
            let mut last = lock(&last);
            if progress.done == last.0 && last.1.elapsed() < PROGRESS_EVERY {
                return;
            }
            *last = (progress.done, Instant::now());
            self.send(&values::progress(job, &progress));
        }
    }

    /// Runs `work` as job `job`, cancellable with `cancel` until it ends.
    fn job<T>(
        &self,
        job: &str,
        work: impl FnOnce(&Cancel) -> Result<T, Coded>,
    ) -> Result<T, Coded> {
        let cancel = Cancel::new();
        lock(&self.jobs).insert(job.to_owned(), cancel.clone());
        let result = work(&cancel);
        lock(&self.jobs).remove(job);
        result
    }

    /// The answer to `op` with its arguments `args`.
    fn handle(&self, op: &str, args: &Map<String, Value>) -> Result<Value, Coded> {
        let text = |name: &str| {
            args.get(name).and_then(Value::as_str).ok_or_else(|| {
                Coded::with("bad-request", format!("{op}: `{name}` must be a string"))
            })
        };
        let optional = |name: &str| args.get(name).and_then(Value::as_str).map(str::to_owned);
        let handle = || {
            args.get("handle")
                .and_then(Value::as_u64)
                .and_then(|handle| u32::try_from(handle).ok())
                .ok_or_else(|| {
                    Coded::with("bad-request", format!("{op}: `handle` must be a number"))
                })
        };
        match op {
            "hello" => Ok(
                json!({ "protocol": PROTOCOL, "engine": VERSION, "rev": REV, "dataDir": self.data_dir }),
            ),
            "models" => {
                let models = self
                    .runtime
                    .block_on(self.engine.local_catalog().models(None))?;
                Ok(models.iter().map(values::model).collect())
            }
            "install" => {
                let (model, build, job) = (text("model")?, optional("build"), text("job")?);
                let progress = self.reporter(job);
                self.job(job, |cancel| {
                    Ok(self.runtime.block_on(self.engine.install(
                        model,
                        build.as_deref(),
                        &progress,
                        cancel,
                    ))?)
                })?;
                Ok(Value::Null)
            }
            "uninstall" => {
                let (model, build) = (text("model")?, optional("build"));
                self.runtime
                    .block_on(self.engine.uninstall(model, build.as_deref()))?;
                Ok(Value::Null)
            }
            "load" => {
                let (model, build, job) = (text("model")?, optional("build"), text("job")?);
                let progress = self.reporter(job);
                let loaded = self.job(job, |cancel| {
                    Ok(self.runtime.block_on(self.engine.load(
                        model,
                        build.as_deref(),
                        &progress,
                        cancel,
                    ))?)
                })?;
                let handle = self.next.fetch_add(1, Ordering::Relaxed);
                let described = values::loaded(handle, &loaded);
                lock(&self.loaded).insert(handle, loaded);
                Ok(described)
            }
            "cancel" => {
                let job = text("job")?;
                let jobs = lock(&self.jobs);
                if let Some(cancel) = jobs.get(job) {
                    cancel.cancel();
                }
                Ok(jobs.contains_key(job).into())
            }
            "free" => {
                let freed = lock(&self.loaded).remove(&handle()?);
                Ok(freed.is_some().into())
            }
            "voices" => {
                let loaded = self.model(handle()?)?;
                let tts = loaded
                    .as_tts()
                    .ok_or_else(|| Coded::new("model-cannot-speak"))?;
                Ok(self
                    .runtime
                    .block_on(tts.voices())
                    .iter()
                    .map(values::voice)
                    .collect())
            }
            "speak" => {
                let loaded = self.model(handle()?)?;
                let tts = loaded
                    .as_tts()
                    .ok_or_else(|| Coded::new("model-cannot-speak"))?;
                let speed = args
                    .get("speed")
                    .and_then(Value::as_f64)
                    .map(|speed| speed as f32);
                let (text, voice, language) = (text("text")?, text("voice")?, optional("language"));
                let audio =
                    self.runtime
                        .block_on(tts.speak(text, voice, language.as_deref(), speed))?;
                Ok(
                    json!({ "sampleRate": audio.sample_rate, "samples": values::encode_samples(&audio.samples) }),
                )
            }
            "transcribe" => {
                let loaded = self.model(handle()?)?;
                let stt = loaded
                    .as_stt()
                    .ok_or_else(|| Coded::new("model-cannot-transcribe"))?;
                let samples = values::decode_samples(text("samples")?).ok_or_else(|| {
                    Coded::with("bad-request", "transcribe: `samples` must be base64")
                })?;
                let rate = args
                    .get("sampleRate")
                    .and_then(Value::as_u64)
                    .and_then(|rate| u32::try_from(rate).ok())
                    .ok_or_else(|| {
                        Coded::with("bad-request", "transcribe: `sampleRate` must be a number")
                    })?;
                let language = optional("language").filter(|language| !language.is_empty());
                Ok(self
                    .runtime
                    .block_on(stt.transcribe(&samples, rate, language.as_deref()))?
                    .into())
            }
            _ => Err(Coded::with(
                "bad-request",
                format!("no such operation: {op}"),
            )),
        }
    }
}

fn main() {
    let mut args = std::env::args().skip(1);
    let data_dir = match (args.next().as_deref(), args.next()) {
        (Some("--data-dir"), Some(dir)) => PathBuf::from(dir),
        _ => {
            eprintln!("usage: sidevoice-engine-runner --data-dir <directory>");
            std::process::exit(2);
        }
    };
    // The engine's futures need a Tokio runtime (its downloads, archives on blocking threads); each request is
    // answered on a blocking thread of its own, so a long one never holds up the others.
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .expect("a Tokio runtime");
    let engine = NativeHost::new(&data_dir)
        .map_err(|error| format!("NativeHost: {error}"))
        .and_then(|host| {
            Engine::new(Box::new(host), vec![Box::new(BundledCatalog)])
                .map_err(|error| format!("Engine::new: {error}"))
        });
    let engine = match engine {
        Ok(engine) => engine,
        Err(error) => {
            eprintln!("the engine could not start: {error}");
            std::process::exit(1);
        }
    };
    let runner = Arc::new(Runner {
        engine,
        data_dir,
        loaded: Mutex::default(),
        jobs: Mutex::default(),
        next: AtomicU32::new(1),
        out: Mutex::new(std::io::stdout()),
        runtime: runtime.handle().clone(),
    });

    let mut answering = Vec::new();
    for line in std::io::stdin().lock().lines() {
        let Ok(line) = line else { break };
        if line.trim().is_empty() {
            continue;
        }
        let request: Map<String, Value> = match serde_json::from_str(&line) {
            Ok(request) => request,
            Err(error) => {
                eprintln!("not a request: {error}");
                continue;
            }
        };
        let runner = Arc::clone(&runner);
        answering.retain(|task: &tokio::task::JoinHandle<()>| !task.is_finished());
        answering.push(runtime.spawn_blocking(move || {
            let id = request.get("id").cloned().unwrap_or(Value::Null);
            let op = request
                .get("op")
                .and_then(Value::as_str)
                .unwrap_or_default();
            let answer = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                runner.handle(op, &request)
            }))
            .unwrap_or_else(|_| Err(Coded::with("internal", format!("{op} panicked"))));
            runner.send(&match answer {
                Ok(value) => json!({ "id": id, "ok": value }),
                Err(error) => json!({ "id": id, "error": error.value() }),
            });
        }));
    }
    // stdin closed: whoever started the runner is done with it, once it has its answers.
    runtime.block_on(async {
        for task in answering {
            let _ = task.await;
        }
    });
    runtime.shutdown_timeout(Duration::from_secs(1));
}

/// A poisoned lock still holds whole values: nothing here is left half done by a panic.
fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}
