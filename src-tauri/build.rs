fn main() {
    // `rust-embed` needs the folder to exist at compile time. CI builds the
    // frontend first, but a fresh clone may run `cargo check` before `npm run
    // build`; keep a tiny placeholder so the crate still compiles.
    let dist = std::path::Path::new("../dist");
    if !dist.join("index.html").exists() {
        let _ = std::fs::create_dir_all(dist);
        let _ = std::fs::write(
            dist.join("index.html"),
            "<!doctype html><meta charset=\"utf-8\"><title>LiteTuber</title><p>Build the frontend with <code>npm run build</code>.</p>",
        );
    }

    tauri_build::build()
}
