//! The native engine, built on this Mac per engine commit and run as a child process: the runner template shipped
//! with the app (`runner/`, a resource) is built by its own `build.sh` with the engine at that commit, once per
//! commit, its binary kept under the app's data directory; then it is started and spoken to one JSON line at a time
//! (the protocol is the runner's: runner/src/main.rs). The page reaches it through these commands:
//!
//! - `native_prepare(sha, job)`: builds the runner for `sha` unless it is built, starts it unless it is running, and
//!   answers its `hello`. The build's output comes line by line as `native-build` events (`{ job, line }`);
//!   `native_cancel(job)` kills the build.
//! - `native_call(sha, op, args)`: one request to that runner, answered with its `ok` or rejected with its `error`
//!   (`{ code, params, message? }`). Its `progress` events come as `native-progress` (`{ sha, job, ... }`).
//!
//! A runner that exits — a crash in the engine's native libraries, say — takes nothing else with it: its pending
//! requests reject with `runner-exited` and what it last wrote to stderr, and a `native-exited` event (`{ sha,
//! message }`) says so. Preparing it again starts it again.

use std::collections::{HashMap, VecDeque};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};

use serde::Serialize;
use serde_json::{json, Map, Value};
use tauri::{AppHandle, Emitter, State};
use tokio::io::{AsyncBufReadExt, AsyncRead, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, Command};
use tokio::sync::oneshot;

/// How many of a runner's last stderr lines a crash report carries.
const STDERR_TAIL: usize = 20;

/// The runners built and running, and the builds under way.
pub struct Runners {
    /// Where runners are built and kept: `<sha>/` each, `target/` shared by their builds.
    root: PathBuf,
    /// The engine's files (models), shared by every runner.
    engine_dir: PathBuf,
    /// The runner template (a resource of the app).
    template: PathBuf,
    running: Mutex<HashMap<String, Arc<Runner>>>,
    /// Build job → the build's process group, to kill it.
    builds: Mutex<HashMap<String, u32>>,
    /// One build at a time: two builds share the target directory, and cargo would only make one wait.
    building: tokio::sync::Mutex<()>,
}

impl Runners {
    pub fn new(data_dir: &Path, template: PathBuf) -> Self {
        Self {
            root: data_dir.join("runners"),
            engine_dir: data_dir.join("sidevoice-engine"),
            template,
            running: Mutex::default(),
            builds: Mutex::default(),
            building: tokio::sync::Mutex::new(()),
        }
    }

    fn binary(&self, sha: &str) -> PathBuf {
        self.root.join(sha).join("bin/sidevoice-engine-runner")
    }

    fn live(&self, sha: &str) -> Option<Arc<Runner>> {
        lock(&self.running)
            .get(sha)
            .filter(|runner| lock(&runner.exited).is_none())
            .cloned()
    }
}

/// A running runner: its stdin, the requests waiting for an answer, and why it exited once it has.
struct Runner {
    stdin: tokio::sync::Mutex<ChildStdin>,
    pending: Mutex<HashMap<u64, oneshot::Sender<Result<Value, Value>>>>,
    next: AtomicU64,
    exited: Mutex<Option<String>>,
    hello: Mutex<Value>,
}

impl Runner {
    async fn call(&self, op: &str, args: Map<String, Value>) -> Result<Value, Coded> {
        if let Some(message) = lock(&self.exited).clone() {
            return Err(Coded::exited(message));
        }
        let id = self.next.fetch_add(1, Ordering::Relaxed);
        let (answer, answered) = oneshot::channel();
        lock(&self.pending).insert(id, answer);
        // It may have exited, and its pending requests been failed, since it was looked at: then nobody answers.
        if let Some(message) = lock(&self.exited).clone() {
            lock(&self.pending).remove(&id);
            return Err(Coded::exited(message));
        }
        let mut request = args;
        request.insert("id".into(), id.into());
        request.insert("op".into(), op.into());
        let line = format!("{}\n", Value::Object(request));
        let written = self.stdin.lock().await.write_all(line.as_bytes()).await;
        if let Err(error) = written {
            lock(&self.pending).remove(&id);
            return Err(Coded::exited(
                lock(&self.exited)
                    .clone()
                    .unwrap_or_else(|| error.to_string()),
            ));
        }
        match answered.await {
            Ok(Ok(value)) => Ok(value),
            Ok(Err(error)) => Err(Coded::from_value(error)),
            Err(_) => Err(Coded::exited(
                lock(&self.exited).clone().unwrap_or_default(),
            )),
        }
    }
}

/// A failure as the page sees it: a web build's `Error` carries the same `code` and `params`.
#[derive(Debug, Serialize)]
pub struct Coded {
    code: String,
    params: Map<String, Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    message: Option<String>,
}

impl Coded {
    fn new(code: &str, message: impl ToString) -> Self {
        Self {
            code: code.to_owned(),
            params: Map::new(),
            message: Some(message.to_string()),
        }
    }

    fn exited(message: String) -> Self {
        Self::new("runner-exited", message)
    }

    fn value(&self) -> Value {
        serde_json::to_value(self).unwrap_or(Value::Null)
    }

    /// The runner's `error`, as it is.
    fn from_value(value: Value) -> Self {
        let code = value
            .get("code")
            .and_then(Value::as_str)
            .unwrap_or("internal")
            .to_owned();
        let params = value
            .get("params")
            .and_then(Value::as_object)
            .cloned()
            .unwrap_or_default();
        let message = value
            .get("message")
            .and_then(Value::as_str)
            .map(str::to_owned);
        Self {
            code,
            params,
            message,
        }
    }
}

/// Whether `sha` is a full commit sha, the only thing a runner is built for.
fn valid_sha(sha: &str) -> bool {
    sha.len() == 40
        && sha
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

/// The runner for `sha`, built if it is not and started if it is not running: what its `hello` says.
#[tauri::command]
pub async fn native_prepare(
    app: AppHandle,
    state: State<'_, Runners>,
    sha: String,
    job: String,
) -> Result<Value, Coded> {
    if !valid_sha(&sha) {
        return Err(Coded::new(
            "bad-request",
            format!("not a full commit sha: {sha}"),
        ));
    }
    if let Some(runner) = state.live(&sha) {
        return Ok(lock(&runner.hello).clone());
    }
    let built = state.binary(&sha);
    if !built.exists() {
        let _one = state.building.lock().await;
        if !built.exists() {
            build(&app, &state, &sha, &job).await?;
        }
    }
    start(&app, &state, &sha, &built).await
}

/// One request to the runner for `sha`, which must be running (`native_prepare`).
#[tauri::command]
pub async fn native_call(
    state: State<'_, Runners>,
    sha: String,
    op: String,
    args: Option<Map<String, Value>>,
) -> Result<Value, Coded> {
    let Some(runner) = lock(&state.running).get(&sha).cloned() else {
        return Err(Coded::new(
            "runner-not-running",
            format!("no runner for {sha} is running: load it again"),
        ));
    };
    runner.call(&op, args.unwrap_or_default()).await
}

/// Kills build `job`: its `native_prepare` rejects with `cancelled`. True if it was under way.
#[tauri::command]
pub fn native_cancel(state: State<'_, Runners>, job: String) -> bool {
    let Some(group) = lock(&state.builds).remove(&job) else {
        return false;
    };
    kill_group(group);
    true
}

/// Runs the template's build.sh for `sha`, its output as `native-build` events, in a process group of its own so
/// cancelling kills cargo and everything it started.
async fn build(app: &AppHandle, state: &Runners, sha: &str, job: &str) -> Result<(), Coded> {
    let script = state.template.join("build.sh");
    let mut child = Command::new("/bin/sh")
        .arg(&script)
        .arg(sha)
        .arg(state.root.join(sha))
        .arg(state.root.join("target"))
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .process_group(0)
        .kill_on_drop(true)
        .spawn()
        .map_err(|error| {
            Coded::new(
                "runner-build-failed",
                format!("{}: {error}", script.display()),
            )
        })?;
    if let Some(pid) = child.id() {
        lock(&state.builds).insert(job.to_owned(), pid);
    }
    let last = Arc::new(Mutex::new(String::new()));
    let say = |stream| {
        let (app, job, last) = (app.clone(), job.to_owned(), Arc::clone(&last));
        tauri::async_runtime::spawn(lines(stream, move |line: String| {
            if !line.trim().is_empty() {
                *lock(&last) = line.clone();
            }
            let _ = app.emit("native-build", json!({ "job": job, "line": line }));
        }))
    };
    let out =
        say(Box::new(child.stdout.take().expect("piped")) as Box<dyn AsyncRead + Send + Unpin>);
    let err = say(Box::new(child.stderr.take().expect("piped")));
    let status = child.wait().await;
    let _ = (out.await, err.await);
    let cancelled = lock(&state.builds).remove(job).is_none();
    if cancelled {
        return Err(Coded::new("cancelled", "the build was cancelled"));
    }
    match status {
        Ok(status) if status.success() => Ok(()),
        Ok(status) => {
            let last = lock(&last).clone();
            let code = if status.code() == Some(3) {
                "runner-tool-missing"
            } else {
                "runner-build-failed"
            };
            Err(Coded::new(
                code,
                if last.is_empty() {
                    status.to_string()
                } else {
                    last
                },
            ))
        }
        Err(error) => Err(Coded::new("runner-build-failed", error)),
    }
}

/// Starts the runner at `binary` for `sha` and asks its `hello`.
async fn start(app: &AppHandle, state: &Runners, sha: &str, binary: &Path) -> Result<Value, Coded> {
    let mut child: Child = Command::new(binary)
        .arg("--data-dir")
        .arg(&state.engine_dir)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|error| Coded::new("runner-exited", format!("{}: {error}", binary.display())))?;
    let runner = Arc::new(Runner {
        stdin: tokio::sync::Mutex::new(child.stdin.take().expect("piped")),
        pending: Mutex::default(),
        next: AtomicU64::new(1),
        exited: Mutex::default(),
        hello: Mutex::new(Value::Null),
    });

    let tail = Arc::new(Mutex::new(VecDeque::new()));
    let stderr = {
        let tail = Arc::clone(&tail);
        tauri::async_runtime::spawn(lines(child.stderr.take().expect("piped"), move |line| {
            eprintln!("runner: {line}");
            let mut tail = lock(&tail);
            if tail.len() == STDERR_TAIL {
                tail.pop_front();
            }
            tail.push_back(line);
        }))
    };
    let stdout = {
        let (app, runner, sha) = (app.clone(), Arc::clone(&runner), sha.to_owned());
        lines(child.stdout.take().expect("piped"), move |line| {
            answer(&app, &runner, &sha, &line)
        })
    };
    {
        let (app, runner, sha) = (app.clone(), Arc::clone(&runner), sha.to_owned());
        tauri::async_runtime::spawn(async move {
            stdout.await;
            let status = child.wait().await;
            let _ = stderr.await;
            let how = match status {
                Ok(status) => status.to_string(),
                Err(error) => error.to_string(),
            };
            let tail: Vec<String> = lock(&tail).iter().cloned().collect();
            let message = if tail.is_empty() {
                format!("the native runner exited ({how})")
            } else {
                format!("the native runner exited ({how}): {}", tail.join("\n"))
            };
            *lock(&runner.exited) = Some(message.clone());
            for (_, waiting) in lock(&runner.pending).drain() {
                let _ = waiting.send(Err(Coded::exited(message.clone()).value()));
            }
            let _ = app.emit("native-exited", json!({ "sha": sha, "message": message }));
        });
    }

    lock(&state.running).insert(sha.to_owned(), Arc::clone(&runner));
    let hello = runner.call("hello", Map::new()).await?;
    *lock(&runner.hello) = hello.clone();
    Ok(hello)
}

/// A line the runner wrote: an answer to a request, or a progress event for the page.
fn answer(app: &AppHandle, runner: &Runner, sha: &str, line: &str) {
    let Ok(Value::Object(mut message)) = serde_json::from_str::<Value>(line) else {
        eprintln!("runner: not a message: {line}");
        return;
    };
    if message.get("event").and_then(Value::as_str) == Some("progress") {
        message.insert("sha".into(), sha.into());
        let _ = app.emit("native-progress", Value::Object(message));
        return;
    }
    let Some(id) = message.get("id").and_then(Value::as_u64) else {
        return;
    };
    let Some(waiting) = lock(&runner.pending).remove(&id) else {
        return;
    };
    let _ = waiting.send(match message.remove("error") {
        Some(error) => Err(error),
        None => Ok(message.remove("ok").unwrap_or(Value::Null)),
    });
}

/// Each line of `stream` to `each`, until it ends.
async fn lines(stream: impl AsyncRead + Unpin, mut each: impl FnMut(String)) {
    let mut lines = BufReader::new(stream).lines();
    while let Ok(Some(line)) = lines.next_line().await {
        each(line);
    }
}

fn kill_group(group: u32) {
    // SAFETY: a plain signal to a process group this app started.
    unsafe { libc::killpg(group as libc::pid_t, libc::SIGKILL) };
}

/// A poisoned lock still holds whole values: nothing here is left half done by a panic.
fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

#[cfg(test)]
mod tests {
    use super::{valid_sha, Coded};
    use serde_json::json;

    #[test]
    fn runners_are_built_for_full_commit_shas_only() {
        assert!(valid_sha("de128c8f0e2b1a3c4d5e6f708192a3b4c5d6e7f8"));
        assert!(!valid_sha("de128c8"));
        assert!(!valid_sha("DE128C8F0E2B1A3C4D5E6F708192A3B4C5D6E7F8"));
        assert!(!valid_sha("../../../../../../../../../../../../etc/x"));
    }

    #[test]
    fn a_runner_error_reaches_the_page_as_it_is() {
        let coded = Coded::from_value(json!({ "code": "model-in-use", "params": { "n": 1 } }));
        assert_eq!(
            coded.value(),
            json!({ "code": "model-in-use", "params": { "n": 1 } })
        );
        let exited = Coded::exited("signal: 6 (SIGABRT)".into());
        assert_eq!(
            exited.value(),
            json!({ "code": "runner-exited", "params": {}, "message": "signal: 6 (SIGABRT)" })
        );
    }
}
