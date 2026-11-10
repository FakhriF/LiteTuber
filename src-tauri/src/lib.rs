mod pose;
mod server;
mod vrm;

use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            // Runtime data belongs next to the installed app's data, not in the
            // repository's data/ folder.
            let data_dir = app
                .path()
                .app_data_dir()
                .unwrap_or_else(|_| std::env::temp_dir().join("litetuber"));
            if let Err(err) = std::fs::create_dir_all(&data_dir) {
                eprintln!("litetuber: gagal membuat folder data: {err}");
            }

            // Bind before the window is created so the first load never races
            // the server. If the port is already used, assume another instance
            // (or the Node dev server) serves the same URL and keep going.
            match server::bind() {
                Ok(listener) => server::spawn(listener, data_dir),
                Err(err) if err.kind() == std::io::ErrorKind::AddrInUse => {
                    println!(
                        "litetuber: port {} sudah dipakai, memakai server yang ada",
                        server::PORT
                    );
                }
                Err(err) => {
                    eprintln!("litetuber: gagal bind port {}: {err}", server::PORT);
                }
            }

            // Deliberately an external URL, not tauri://localhost: the app, the
            // browser panel, and the OBS Browser Source all share one origin.
            let url: url::Url = format!("http://127.0.0.1:{}/", server::PORT)
                .parse()
                .expect("local URL is valid");

            let window = WebviewWindowBuilder::new(app, "main", WebviewUrl::External(url))
                .title("LiteTuber")
                .inner_size(1100.0, 780.0)
                .min_inner_size(760.0, 560.0)
                .build();

            if let Err(err) = window {
                eprintln!("litetuber: gagal membuka jendela: {err}");
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running LiteTuber");
}
