//! Engine release assets for the page, which loads web builds from GitHub Releases: github.com sends no CORS headers,
//! so the page cannot download them itself. sidevoice-engine's release assets only.

use tauri::ipc::Response;

const ALLOWED: &str = "https://github.com/sidevoice/sidevoice-engine/releases/download/";

/// Whether `url` is a sidevoice-engine release asset, the only thing this downloads.
fn allowed(url: &str) -> bool {
    url.strip_prefix(ALLOWED)
        .is_some_and(|rest| !rest.contains(".."))
}

/// The bytes at `url`, a sidevoice-engine release asset, as an `ArrayBuffer`.
#[tauri::command]
pub async fn fetch_release_asset(url: String) -> Result<Response, String> {
    if !allowed(&url) {
        return Err(format!("only {ALLOWED}*"));
    }
    let res = reqwest::get(&url)
        .await
        .map_err(|error| format!("{url}: {error}"))?;
    if !res.status().is_success() {
        return Err(format!("{url}: HTTP {}", res.status().as_u16()));
    }
    let bytes = res
        .bytes()
        .await
        .map_err(|error| format!("{url}: {error}"))?;
    Ok(Response::new(bytes.to_vec()))
}

#[cfg(test)]
mod tests {
    use super::allowed;

    #[test]
    fn only_engine_release_assets() {
        assert!(allowed(
            "https://github.com/sidevoice/sidevoice-engine/releases/download/nightly/SHA256SUMS"
        ));
        assert!(!allowed(
            "https://github.com/sidevoice/sidevoice-engine/releases/download/../../x"
        ));
        assert!(!allowed(
            "https://github.com/sidevoice/other/releases/download/v1/x"
        ));
        assert!(!allowed("https://example.com/"));
    }
}
