//! The playground as a macOS app: the page in `web/` in a webview, with two things a browser tab does not have. The
//! native engine, sidevoice-engine compiled into the app (`native`), offered by the page beside the web builds; and
//! the relay for engine release assets the page loads web builds through (`release`), as server.mjs's `/fetch`.
//! There is no access gate: nothing listens on the network, and only the app's own page calls these commands.

mod native;
mod release;
mod values;

use tauri::Manager;

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let dir = app.path().app_data_dir()?.join("sidevoice-engine");
            app.manage(native::Native::new(dir));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            release::fetch_release_asset,
            native::native_info,
            native::native_models,
            native::native_install,
            native::native_uninstall,
            native::native_load,
            native::native_cancel,
            native::native_free,
            native::native_voices,
            native::native_speak,
            native::native_transcribe,
        ])
        .run(tauri::generate_context!())
        .expect("the playground app failed to start");
}
