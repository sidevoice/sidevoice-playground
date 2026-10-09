//! The engine the runner is built with, read from Cargo.lock: its version and commit become
//! `SIDEVOICE_ENGINE_VERSION` and `SIDEVOICE_ENGINE_REV`, what `hello` answers.

use std::fs;

fn main() {
    println!("cargo:rerun-if-changed=Cargo.lock");
    let lock = fs::read_to_string("Cargo.lock").expect("the runner's Cargo.lock");
    let (version, rev) = engine_pin(&lock).expect("sidevoice-engine from git in Cargo.lock");
    println!("cargo:rustc-env=SIDEVOICE_ENGINE_VERSION={version}");
    println!("cargo:rustc-env=SIDEVOICE_ENGINE_REV={rev}");
}

/// `(version, commit)` of the `sidevoice-engine` package, whose source is `git+<url>?rev=<rev>#<commit>`.
fn engine_pin(lock: &str) -> Option<(String, String)> {
    let package = lock.split("[[package]]").find(|package| {
        package
            .lines()
            .any(|line| line.trim() == r#"name = "sidevoice-engine""#)
    })?;
    let field = |key: &str| {
        package
            .lines()
            .find_map(|line| {
                line.trim()
                    .strip_prefix(key)?
                    .strip_prefix(" = \"")?
                    .strip_suffix('"')
            })
            .map(str::to_owned)
    };
    let source = field("source")?;
    let (_, commit) = source.rsplit_once('#')?;
    Some((field("version")?, commit.to_owned()))
}
