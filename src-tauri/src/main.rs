//! The playground as a macOS app: the page in `web/` in a webview, with two things a browser tab does not have. The
//! native engine, built on this Mac for the engine commit picked and run as a child process (`runner`); and the relay
//! for engine release assets the page loads web builds through (`release`), as server.mjs's `/fetch`. There is no
//! access gate: nothing listens on the network, and only the app's own page calls these commands.

mod release;
mod runner;

use tauri::path::BaseDirectory;
use tauri::Manager;

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            let template = app.path().resolve("runner", BaseDirectory::Resource)?;
            app.manage(runner::Runners::new(&data_dir, template));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            release::fetch_release_asset,
            runner::native_prepare,
            runner::native_call,
            runner::native_cancel,
        ])
        .run(tauri::generate_context!())
        .expect("the playground app failed to start");
}
