//! Embedded local server. This is a Rust port of `serve.mjs` so the installed
//! desktop app does not need Node. It serves the built frontend, the state API,
//! avatar/background storage, and the live pose relay for OBS.

use std::{
    collections::HashMap,
    net::TcpListener as StdTcpListener,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU64, AtomicUsize, Ordering},
        Arc,
    },
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use axum::{
    body::{Body, Bytes},
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        DefaultBodyLimit, Path as AxumPath, Query, State,
    },
    http::{header, HeaderMap, HeaderName, HeaderValue, Method, Request, StatusCode, Uri},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::get,
    Router,
};
use futures_util::{SinkExt, StreamExt};
use rust_embed::RustEmbed;
use serde_json::{json, Value};
use tokio::{
    io::AsyncWriteExt,
    sync::{broadcast, Mutex},
};
use tokio_util::io::ReaderStream;

use crate::{pose, vrm};

pub const PORT: u16 = 8770;
const MAX_AVATAR_BYTES: u64 = 300 * 1024 * 1024;
const MAX_BACKGROUND_BYTES: usize = 25 * 1024 * 1024;
const MAX_STATE_BYTES: usize = 1024 * 1024;
const MAX_PROFILE_BODY_BYTES: usize = 4 * 1024;
const MAX_PROFILES: usize = 12;
const MAX_PROFILE_NAME: usize = 32;
const MAX_WS_BYTES: usize = 16 * 1024;

#[derive(RustEmbed)]
#[folder = "../dist"]
struct Assets;

pub struct AppState {
    data_dir: PathBuf,
    write_lock: Mutex<()>,
    revision: AtomicU64,
    pose_tx: broadcast::Sender<String>,
    status_tx: broadcast::Sender<String>,
    panels: AtomicUsize,
    viewers: AtomicUsize,
}

impl AppState {
    fn new(data_dir: PathBuf) -> Self {
        let (pose_tx, _) = broadcast::channel(64);
        let (status_tx, _) = broadcast::channel(16);
        Self {
            data_dir,
            write_lock: Mutex::new(()),
            revision: AtomicU64::new(0),
            pose_tx,
            status_tx,
            panels: AtomicUsize::new(0),
            viewers: AtomicUsize::new(0),
        }
    }
}

/// Binds synchronously so the caller knows the port is ready before the webview
/// opens. Returns `AddrInUse` when another LiteTuber instance (or the Node dev
/// server) is already listening; that is not fatal.
pub fn bind() -> std::io::Result<StdTcpListener> {
    StdTcpListener::bind(("127.0.0.1", PORT))
}

/// Runs the server on its own thread and Tokio runtime.
pub fn spawn(listener: StdTcpListener, data_dir: PathBuf) {
    std::thread::Builder::new()
        .name("litetuber-server".into())
        .spawn(move || {
            let runtime = match tokio::runtime::Builder::new_multi_thread()
                .enable_all()
                .build()
            {
                Ok(runtime) => runtime,
                Err(err) => {
                    eprintln!("litetuber: gagal membuat runtime: {err}");
                    return;
                }
            };

            runtime.block_on(async move {
                if let Err(err) = listener.set_nonblocking(true) {
                    eprintln!("litetuber: set_nonblocking gagal: {err}");
                }
                let listener = match tokio::net::TcpListener::from_std(listener) {
                    Ok(listener) => listener,
                    Err(err) => {
                        eprintln!("litetuber: listener tidak valid: {err}");
                        return;
                    }
                };
                let state = Arc::new(AppState::new(data_dir));
                let app = router(state);
                println!("litetuber: server http://127.0.0.1:{PORT}/");
                if let Err(err) = axum::serve(listener, app).await {
                    eprintln!("litetuber: server berhenti: {err}");
                }
            });
        })
        .ok();
}

fn router(state: Arc<AppState>) -> Router {
    Router::new()
        .route("/api/state", get(get_state).put(put_state))
        .route(
            "/api/avatar",
            get(get_avatar).put(put_avatar).delete(delete_avatar),
        )
        .route(
            "/api/background",
            get(get_background)
                .put(put_background)
                .delete(delete_background),
        )
        .route("/api/profiles", get(list_profiles).post(create_profile))
        .route("/api/profiles/{id}", axum::routing::delete(delete_profile))
        .route(
            "/api/profiles/{id}/apply",
            axum::routing::post(apply_profile),
        )
        .route("/ws/pose", get(ws_pose))
        .fallback(static_handler)
        .layer(DefaultBodyLimit::max(MAX_BACKGROUND_BYTES))
        .with_state(state)
        .layer(middleware::from_fn(guard))
}

/* ---------- host/origin guard ---------- */

fn host_allowed(headers: &HeaderMap) -> bool {
    let Some(host) = headers.get(header::HOST).and_then(|v| v.to_str().ok()) else {
        return false;
    };
    let hostname = if let Some(rest) = host.strip_prefix('[') {
        rest.split(']').next().unwrap_or("")
    } else {
        host.split(':').next().unwrap_or("")
    };
    matches!(hostname, "127.0.0.1" | "localhost" | "::1")
}

fn origin_allowed(origin: &str) -> bool {
    let Ok(url) = url::Url::parse(origin) else {
        return false;
    };
    let local = match url.host() {
        Some(url::Host::Ipv4(ip)) => ip.is_loopback(),
        Some(url::Host::Ipv6(ip)) => ip.is_loopback(),
        Some(url::Host::Domain(name)) => name.eq_ignore_ascii_case("localhost"),
        None => false,
    };
    local && url.port_or_known_default() == Some(PORT)
}

async fn guard(req: Request<Body>, next: Next) -> Response {
    if !host_allowed(req.headers()) {
        return (StatusCode::FORBIDDEN, "forbidden host").into_response();
    }

    let origin = req
        .headers()
        .get(header::ORIGIN)
        .and_then(|v| v.to_str().ok())
        .map(str::to_owned);

    if let Some(origin) = origin.as_deref() {
        if !origin_allowed(origin) {
            return (StatusCode::FORBIDDEN, "forbidden origin").into_response();
        }
    }

    if req.method() == Method::OPTIONS {
        let mut res = StatusCode::NO_CONTENT.into_response();
        let headers = res.headers_mut();
        if let Some(origin) = &origin {
            if let Ok(value) = HeaderValue::from_str(origin) {
                headers.insert(header::ACCESS_CONTROL_ALLOW_ORIGIN, value);
                headers.insert(header::VARY, HeaderValue::from_static("Origin"));
            }
        }
        headers.insert(
            header::ACCESS_CONTROL_ALLOW_METHODS,
            HeaderValue::from_static("GET,PUT,DELETE,OPTIONS"),
        );
        headers.insert(
            header::ACCESS_CONTROL_ALLOW_HEADERS,
            HeaderValue::from_static("content-type"),
        );
        headers.insert(
            header::ACCESS_CONTROL_MAX_AGE,
            HeaderValue::from_static("600"),
        );
        return res;
    }

    let mut res = next.run(req).await;
    if let Some(origin) = &origin {
        if let Ok(value) = HeaderValue::from_str(origin) {
            res.headers_mut()
                .insert(header::ACCESS_CONTROL_ALLOW_ORIGIN, value);
            res.headers_mut()
                .insert(header::VARY, HeaderValue::from_static("Origin"));
        }
    }
    res
}

/* ---------- static files ---------- */

async fn static_handler(uri: Uri) -> Response {
    let requested = uri.path().trim_start_matches('/');
    let requested = if requested.is_empty() {
        "index.html"
    } else {
        requested
    };

    if requested.split('/').any(|part| part == "..") {
        return (StatusCode::FORBIDDEN, "forbidden").into_response();
    }

    let Some(file) = Assets::get(requested) else {
        return (StatusCode::NOT_FOUND, "not found").into_response();
    };

    let mime = mime_guess::from_path(requested).first_or_octet_stream();
    let content_type = if matches!(mime.type_().as_str(), "text" | "application")
        && matches!(
            mime.subtype().as_str(),
            "html" | "javascript" | "json" | "css" | "xml"
        ) {
        format!("{mime}; charset=utf-8")
    } else {
        mime.to_string()
    };
    let cache = if requested.ends_with(".html") {
        "no-store"
    } else {
        "public, max-age=3600"
    };

    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, content_type)
        .header(header::CACHE_CONTROL, cache)
        .body(Body::from(file.data.into_owned()))
        .unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response())
}

/* ---------- state API ---------- */

#[derive(Default, serde::Serialize, serde::Deserialize)]
struct DiskState {
    #[serde(default)]
    settings: Option<Value>,
    #[serde(default, rename = "avatarName")]
    avatar_name: String,
}

#[derive(Clone, Copy)]
struct StatInfo {
    exists: bool,
    mtime: i64,
    size: u64,
}

impl StatInfo {
    fn signature(&self) -> String {
        if !self.exists {
            return "0".into();
        }
        format!("{}-{}", self.mtime, self.size)
    }
}

async fn stat_info(path: &Path) -> StatInfo {
    match tokio::fs::metadata(path).await {
        Ok(meta) => {
            let mtime = meta
                .modified()
                .ok()
                .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as i64)
                .unwrap_or(0);
            StatInfo {
                exists: true,
                mtime,
                size: meta.len(),
            }
        }
        Err(_) => StatInfo {
            exists: false,
            mtime: 0,
            size: 0,
        },
    }
}

fn make_etag(parts: &[String]) -> String {
    format!("\"{}\"", parts.join("."))
}

fn if_none_match(headers: &HeaderMap, etag: &str) -> bool {
    let Some(header) = headers
        .get(header::IF_NONE_MATCH)
        .and_then(|v| v.to_str().ok())
    else {
        return false;
    };
    header
        .split(',')
        .map(str::trim)
        .map(|part| part.strip_prefix("W/").unwrap_or(part))
        .any(|part| part == etag)
}

fn json_response(status: StatusCode, payload: Value, extra: &[(&str, String)]) -> Response {
    let mut builder = Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, "application/json; charset=utf-8")
        .header(header::CACHE_CONTROL, "no-store");
    for (name, value) in extra {
        if let (Ok(name), Ok(value)) = (
            HeaderName::from_bytes(name.as_bytes()),
            HeaderValue::from_str(value),
        ) {
            builder = builder.header(name, value);
        }
    }
    builder
        .body(Body::from(payload.to_string()))
        .unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response())
}

async fn get_state(State(state): State<Arc<AppState>>, headers: HeaderMap) -> Response {
    let avatar = stat_info(&state.data_dir.join("avatar.vrm")).await;
    let bg = stat_info(&state.data_dir.join("background.json")).await;
    let state_info = stat_info(&state.data_dir.join("state.json")).await;
    let etag = make_etag(&[
        state.revision.load(Ordering::SeqCst).to_string(),
        state_info.signature(),
        avatar.signature(),
        bg.signature(),
    ]);

    if if_none_match(&headers, &etag) {
        return Response::builder()
            .status(StatusCode::NOT_MODIFIED)
            .header(header::ETAG, etag)
            .header(header::CACHE_CONTROL, "no-store")
            .body(Body::empty())
            .unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response());
    }

    let disk = read_state(&state.data_dir).await;
    json_response(
        StatusCode::OK,
        json!({
            "settings": disk.settings,
            "avatarName": disk.avatar_name,
            "avatarExists": avatar.exists,
            "avatarMtime": avatar.mtime,
            "bgExists": bg.exists,
            "bgMtime": bg.mtime,
        }),
        &[("etag", etag)],
    )
}

async fn put_state(State(state): State<Arc<AppState>>, body: Bytes) -> Response {
    if body.len() > MAX_STATE_BYTES {
        return json_response(
            StatusCode::PAYLOAD_TOO_LARGE,
            json!({ "error": "state terlalu besar" }),
            &[],
        );
    }
    let parsed: Value = match serde_json::from_slice(&body) {
        Ok(value) => value,
        Err(err) => {
            return json_response(
                StatusCode::BAD_REQUEST,
                json!({ "error": err.to_string() }),
                &[],
            )
        }
    };

    if let Err(err) = update_state(&state, |disk| {
        if let Some(settings) = parsed.get("settings") {
            if settings.is_object() {
                disk.settings = Some(settings.clone());
            }
        }
        if let Some(name) = parsed.get("avatarName").and_then(Value::as_str) {
            disk.avatar_name = name.to_string();
        }
    })
    .await
    {
        return json_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            json!({ "error": err }),
            &[],
        );
    }

    json_response(StatusCode::OK, json!({ "ok": true }), &[])
}

async fn read_state(data_dir: &Path) -> DiskState {
    let path = data_dir.join("state.json");
    match tokio::fs::read_to_string(path).await {
        Ok(raw) => serde_json::from_str(&raw).unwrap_or_default(),
        Err(_) => DiskState::default(),
    }
}

/// Serializes read-modify-write and commits through a temp file + rename, so a
/// reader never sees a half-written state file.
async fn update_state<F>(state: &AppState, mutate: F) -> Result<(), String>
where
    F: FnOnce(&mut DiskState),
{
    let _guard = state.write_lock.lock().await;
    let mut disk = read_state(&state.data_dir).await;
    mutate(&mut disk);

    let path = state.data_dir.join("state.json");
    let tmp = tmp_path(&path);
    let body = serde_json::to_vec_pretty(&disk).map_err(|err| err.to_string())?;
    if let Err(err) = tokio::fs::write(&tmp, body).await {
        return Err(err.to_string());
    }
    if let Err(err) = tokio::fs::rename(&tmp, &path).await {
        let _ = tokio::fs::remove_file(&tmp).await;
        return Err(err.to_string());
    }
    state.revision.fetch_add(1, Ordering::SeqCst);
    Ok(())
}

async fn write_data_file(path: &Path, data: Vec<u8>) -> Result<(), String> {
    let tmp = tmp_path(path);
    if let Err(err) = tokio::fs::write(&tmp, data).await {
        return Err(err.to_string());
    }
    if let Err(err) = tokio::fs::rename(&tmp, path).await {
        let _ = tokio::fs::remove_file(&tmp).await;
        return Err(err.to_string());
    }
    Ok(())
}

fn tmp_path(path: &Path) -> PathBuf {
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let n = COUNTER.fetch_add(1, Ordering::Relaxed);
    let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("data");
    path.with_file_name(format!("{name}.{}.{n}.tmp", std::process::id()))
}

/* ---------- avatar ---------- */

async fn get_avatar(State(state): State<Arc<AppState>>) -> Response {
    let path = state.data_dir.join("avatar.vrm");
    let info = stat_info(&path).await;
    if !info.exists {
        return json_response(StatusCode::NOT_FOUND, json!({ "error": "no avatar" }), &[]);
    }
    let file = match tokio::fs::File::open(&path).await {
        Ok(file) => file,
        Err(err) => {
            return json_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                json!({ "error": err.to_string() }),
                &[],
            )
        }
    };
    let stream = ReaderStream::new(file);
    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, "application/octet-stream")
        .header(header::CONTENT_LENGTH, info.size.to_string())
        .header(header::CACHE_CONTROL, "no-store")
        .body(Body::from_stream(stream))
        .unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response())
}

async fn put_avatar(
    State(state): State<Arc<AppState>>,
    Query(query): Query<HashMap<String, String>>,
    body: Body,
) -> Response {
    let name = query
        .get("name")
        .map(String::as_str)
        .filter(|name| !name.is_empty())
        .unwrap_or("avatar")
        .to_string();

    let dest = state.data_dir.join("avatar.vrm");
    let tmp = tmp_path(&dest);
    let mut file = match tokio::fs::File::create(&tmp).await {
        Ok(file) => file,
        Err(err) => {
            return json_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                json!({ "error": err.to_string() }),
                &[],
            )
        }
    };

    let mut stream = body.into_data_stream();
    let mut prefix: Vec<u8> = Vec::new();
    let mut validated = false;
    let mut size: u64 = 0;
    let mut failure: Option<(StatusCode, String)> = None;

    while let Some(chunk) = stream.next().await {
        let chunk = match chunk {
            Ok(chunk) => chunk,
            Err(err) => {
                failure = Some((StatusCode::BAD_REQUEST, err.to_string()));
                break;
            }
        };

        size += chunk.len() as u64;
        if size > MAX_AVATAR_BYTES {
            failure = Some((StatusCode::PAYLOAD_TOO_LARGE, "avatar terlalu besar".into()));
            break;
        }

        if !validated {
            prefix.extend_from_slice(&chunk);
            match vrm::inspect(&prefix) {
                vrm::VrmCheck::Valid => {
                    validated = true;
                    prefix = Vec::new();
                }
                vrm::VrmCheck::Invalid(reason) => {
                    failure = Some((StatusCode::UNSUPPORTED_MEDIA_TYPE, reason.into()));
                    break;
                }
                vrm::VrmCheck::NeedMore => {
                    if prefix.len() > 20 * 1024 * 1024 {
                        failure = Some((
                            StatusCode::UNSUPPORTED_MEDIA_TYPE,
                            "header avatar terlalu besar".into(),
                        ));
                        break;
                    }
                }
            }
        }

        if let Err(err) = file.write_all(&chunk).await {
            failure = Some((StatusCode::INTERNAL_SERVER_ERROR, err.to_string()));
            break;
        }
    }

    if failure.is_none() && !validated {
        match vrm::inspect(&prefix) {
            vrm::VrmCheck::Valid => {}
            vrm::VrmCheck::Invalid(reason) => {
                failure = Some((StatusCode::UNSUPPORTED_MEDIA_TYPE, reason.into()));
            }
            vrm::VrmCheck::NeedMore => {
                failure = Some((
                    StatusCode::UNSUPPORTED_MEDIA_TYPE,
                    "avatar tidak lengkap".into(),
                ));
            }
        }
    }

    if let Err(err) = file.flush().await {
        failure = Some((StatusCode::INTERNAL_SERVER_ERROR, err.to_string()));
    }
    drop(file);

    if let Some((status, error)) = failure {
        let _ = tokio::fs::remove_file(&tmp).await;
        return json_response(status, json!({ "error": error }), &[]);
    }

    if let Err(err) = tokio::fs::rename(&tmp, &dest).await {
        let _ = tokio::fs::remove_file(&tmp).await;
        return json_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            json!({ "error": err.to_string() }),
            &[],
        );
    }

    let saved = name.clone();
    if let Err(err) = update_state(&state, |disk| {
        disk.avatar_name = saved.clone();
    })
    .await
    {
        return json_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            json!({ "error": err }),
            &[],
        );
    }

    json_response(StatusCode::OK, json!({ "ok": true, "name": name }), &[])
}

async fn delete_avatar(State(state): State<Arc<AppState>>) -> Response {
    let _ = tokio::fs::remove_file(state.data_dir.join("avatar.vrm")).await;
    if let Err(err) = update_state(&state, |disk| disk.avatar_name.clear()).await {
        return json_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            json!({ "error": err }),
            &[],
        );
    }
    json_response(StatusCode::OK, json!({ "ok": true }), &[])
}

/* ---------- background ---------- */

async fn get_background(State(state): State<Arc<AppState>>) -> Response {
    let path = state.data_dir.join("background.json");
    match tokio::fs::read_to_string(path).await {
        Ok(raw) => match serde_json::from_str::<Value>(&raw) {
            Ok(value) => json_response(StatusCode::OK, value, &[]),
            Err(_) => json_response(
                StatusCode::NOT_FOUND,
                json!({ "error": "no background" }),
                &[],
            ),
        },
        Err(_) => json_response(
            StatusCode::NOT_FOUND,
            json!({ "error": "no background" }),
            &[],
        ),
    }
}

async fn put_background(State(state): State<Arc<AppState>>, body: Bytes) -> Response {
    if body.len() > MAX_BACKGROUND_BYTES {
        return json_response(
            StatusCode::PAYLOAD_TOO_LARGE,
            json!({ "error": "background terlalu besar" }),
            &[],
        );
    }
    let parsed: Value = match serde_json::from_slice(&body) {
        Ok(value) => value,
        Err(err) => {
            return json_response(
                StatusCode::BAD_REQUEST,
                json!({ "error": err.to_string() }),
                &[],
            )
        }
    };
    let Some(data_url) = parsed.get("dataUrl").and_then(Value::as_str) else {
        return json_response(
            StatusCode::BAD_REQUEST,
            json!({ "error": "dataUrl required" }),
            &[],
        );
    };

    let payload = json!({ "dataUrl": data_url }).to_string();
    let path = state.data_dir.join("background.json");
    if let Err(err) = write_data_file(&path, payload.into_bytes()).await {
        return json_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            json!({ "error": err }),
            &[],
        );
    }
    state.revision.fetch_add(1, Ordering::SeqCst);
    json_response(StatusCode::OK, json!({ "ok": true }), &[])
}

async fn delete_background(State(state): State<Arc<AppState>>) -> Response {
    let _ = tokio::fs::remove_file(state.data_dir.join("background.json")).await;
    state.revision.fetch_add(1, Ordering::SeqCst);
    json_response(StatusCode::OK, json!({ "ok": true }), &[])
}

/* ---------- profiles ---------- */
// A profile is a directory with its own avatar/background copies plus a
// settings snapshot. The active files at the data root stay the ones the
// existing endpoints serve.

#[derive(Clone, Default, serde::Serialize, serde::Deserialize)]
struct ProfileMeta {
    #[serde(default)]
    id: String,
    #[serde(default)]
    name: String,
    #[serde(default)]
    settings: Option<Value>,
    #[serde(default, rename = "avatarName")]
    avatar_name: String,
    #[serde(default, rename = "createdAt")]
    created_at: u64,
    #[serde(default, rename = "updatedAt")]
    updated_at: u64,
}

fn profiles_dir(data_dir: &Path) -> PathBuf {
    data_dir.join("profiles")
}

fn normalize_profile_name(value: &str) -> String {
    let mut name = value.split_whitespace().collect::<Vec<_>>().join(" ");
    if name.chars().count() > MAX_PROFILE_NAME {
        name = name.chars().take(MAX_PROFILE_NAME).collect();
    }
    name
}

fn profile_id_valid(id: &str) -> bool {
    (6..=40).contains(&id.len())
        && id
            .chars()
            .all(|ch| ch.is_ascii_lowercase() || ch.is_ascii_digit())
}

fn new_profile_id() -> String {
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    format!("p{:x}{:x}", ms, COUNTER.fetch_add(1, Ordering::Relaxed))
}

async fn read_profile_meta(data_dir: &Path, id: &str) -> Option<ProfileMeta> {
    if !profile_id_valid(id) {
        return None;
    }
    let path = profiles_dir(data_dir).join(id).join("profile.json");
    let raw = tokio::fs::read_to_string(path).await.ok()?;
    let mut meta: ProfileMeta = serde_json::from_str(&raw).ok()?;
    meta.id = id.to_string();
    meta.name = normalize_profile_name(&meta.name);
    if meta.name.is_empty() {
        return None;
    }
    Some(meta)
}

async fn profile_summary(data_dir: &Path, meta: &ProfileMeta) -> Value {
    let dir = profiles_dir(data_dir).join(&meta.id);
    let avatar = stat_info(&dir.join("avatar.vrm")).await;
    let bg = stat_info(&dir.join("background.json")).await;
    json!({
        "id": meta.id,
        "name": meta.name,
        "avatarName": meta.avatar_name,
        "hasAvatar": avatar.exists,
        "hasBackground": bg.exists,
        "createdAt": meta.created_at,
        "updatedAt": meta.updated_at,
    })
}

async fn all_profiles(data_dir: &Path) -> Vec<Value> {
    let mut out = Vec::new();
    let mut entries = match tokio::fs::read_dir(profiles_dir(data_dir)).await {
        Ok(entries) => entries,
        Err(_) => return out,
    };
    while let Ok(Some(entry)) = entries.next_entry().await {
        let Ok(file_type) = entry.file_type().await else {
            continue;
        };
        if !file_type.is_dir() {
            continue;
        }
        let Some(id) = entry.file_name().to_str().map(str::to_owned) else {
            continue;
        };
        if let Some(meta) = read_profile_meta(data_dir, &id).await {
            out.push(profile_summary(data_dir, &meta).await);
        }
    }
    out.sort_by(|a, b| {
        let left = a.get("name").and_then(Value::as_str).unwrap_or("");
        let right = b.get("name").and_then(Value::as_str).unwrap_or("");
        left.to_lowercase().cmp(&right.to_lowercase())
    });
    out
}

async fn copy_if_exists(src: &Path, dest: &Path) -> Result<(), String> {
    if tokio::fs::metadata(src).await.is_err() {
        let _ = tokio::fs::remove_file(dest).await;
        return Ok(());
    }
    let tmp = tmp_path(dest);
    if let Err(err) = tokio::fs::copy(src, &tmp).await {
        let _ = tokio::fs::remove_file(&tmp).await;
        return Err(err.to_string());
    }
    if let Err(err) = tokio::fs::rename(&tmp, dest).await {
        let _ = tokio::fs::remove_file(&tmp).await;
        return Err(err.to_string());
    }
    Ok(())
}

async fn snapshot_profile(
    state: &AppState,
    name: &str,
) -> Result<(Value, bool), (StatusCode, String)> {
    // Hold the write lock so the settings snapshot and asset copies match.
    let _guard = state.write_lock.lock().await;
    let existing = all_profiles(&state.data_dir)
        .await
        .into_iter()
        .find(|profile| {
            profile
                .get("name")
                .and_then(Value::as_str)
                .map(|value| value.eq_ignore_ascii_case(name))
                .unwrap_or(false)
        });

    if existing.is_none() && all_profiles(&state.data_dir).await.len() >= MAX_PROFILES {
        return Err((
            StatusCode::CONFLICT,
            format!("Profil penuh (maksimal {MAX_PROFILES})."),
        ));
    }

    let (id, created_at) = match &existing {
        Some(profile) => (
            profile
                .get("id")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string(),
            profile
                .get("createdAt")
                .and_then(Value::as_u64)
                .unwrap_or_default(),
        ),
        None => (new_profile_id(), 0),
    };

    let dir = profiles_dir(&state.data_dir).join(&id);
    tokio::fs::create_dir_all(&dir)
        .await
        .map_err(|err| (StatusCode::INTERNAL_SERVER_ERROR, err.to_string()))?;

    copy_if_exists(&state.data_dir.join("avatar.vrm"), &dir.join("avatar.vrm"))
        .await
        .map_err(|err| (StatusCode::INTERNAL_SERVER_ERROR, err))?;
    copy_if_exists(
        &state.data_dir.join("background.json"),
        &dir.join("background.json"),
    )
    .await
    .map_err(|err| (StatusCode::INTERNAL_SERVER_ERROR, err))?;

    let disk = read_state(&state.data_dir).await;
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    let meta = ProfileMeta {
        id: id.clone(),
        name: name.to_string(),
        settings: disk.settings,
        avatar_name: disk.avatar_name,
        created_at: if created_at == 0 { now } else { created_at },
        updated_at: now,
    };
    let body = serde_json::to_vec_pretty(&meta)
        .map_err(|err| (StatusCode::INTERNAL_SERVER_ERROR, err.to_string()))?;
    write_data_file(&dir.join("profile.json"), body)
        .await
        .map_err(|err| (StatusCode::INTERNAL_SERVER_ERROR, err))?;

    let summary = profile_summary(&state.data_dir, &meta).await;
    Ok((summary, existing.is_some()))
}

async fn list_profiles(State(state): State<Arc<AppState>>) -> Response {
    json_response(
        StatusCode::OK,
        json!({ "profiles": all_profiles(&state.data_dir).await }),
        &[],
    )
}

async fn create_profile(State(state): State<Arc<AppState>>, body: Bytes) -> Response {
    if body.len() > MAX_PROFILE_BODY_BYTES {
        return json_response(
            StatusCode::PAYLOAD_TOO_LARGE,
            json!({ "error": "permintaan terlalu besar" }),
            &[],
        );
    }
    let parsed: Value = match serde_json::from_slice(&body) {
        Ok(value) => value,
        Err(err) => {
            return json_response(
                StatusCode::BAD_REQUEST,
                json!({ "error": err.to_string() }),
                &[],
            )
        }
    };
    let name = normalize_profile_name(parsed.get("name").and_then(Value::as_str).unwrap_or(""));
    if name.is_empty() {
        return json_response(
            StatusCode::BAD_REQUEST,
            json!({ "error": "Nama profil wajib diisi." }),
            &[],
        );
    }
    match snapshot_profile(&state, &name).await {
        Ok((profile, replaced)) => json_response(
            StatusCode::OK,
            json!({ "ok": true, "profile": profile, "replaced": replaced }),
            &[],
        ),
        Err((status, message)) => json_response(status, json!({ "error": message }), &[]),
    }
}

async fn delete_profile(
    State(state): State<Arc<AppState>>,
    AxumPath(id): AxumPath<String>,
) -> Response {
    if read_profile_meta(&state.data_dir, &id).await.is_none() {
        return json_response(
            StatusCode::NOT_FOUND,
            json!({ "error": "Profil tidak ditemukan." }),
            &[],
        );
    }
    if let Err(err) = tokio::fs::remove_dir_all(profiles_dir(&state.data_dir).join(&id)).await {
        return json_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            json!({ "error": err.to_string() }),
            &[],
        );
    }
    json_response(StatusCode::OK, json!({ "ok": true }), &[])
}

async fn apply_profile(
    State(state): State<Arc<AppState>>,
    AxumPath(id): AxumPath<String>,
) -> Response {
    let Some(meta) = read_profile_meta(&state.data_dir, &id).await else {
        return json_response(
            StatusCode::NOT_FOUND,
            json!({ "error": "Profil tidak ditemukan." }),
            &[],
        );
    };
    let dir = profiles_dir(&state.data_dir).join(&id);
    if let Err(err) =
        copy_if_exists(&dir.join("avatar.vrm"), &state.data_dir.join("avatar.vrm")).await
    {
        return json_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            json!({ "error": err }),
            &[],
        );
    }
    if let Err(err) = copy_if_exists(
        &dir.join("background.json"),
        &state.data_dir.join("background.json"),
    )
    .await
    {
        return json_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            json!({ "error": err }),
            &[],
        );
    }
    if let Err(err) = update_state(&state, |disk| {
        if let Some(settings) = &meta.settings {
            if settings.is_object() {
                disk.settings = Some(settings.clone());
            }
        }
        disk.avatar_name = meta.avatar_name.clone();
    })
    .await
    {
        return json_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            json!({ "error": err }),
            &[],
        );
    }
    state.revision.fetch_add(1, Ordering::SeqCst);
    json_response(
        StatusCode::OK,
        json!({ "ok": true, "id": meta.id, "name": meta.name }),
        &[],
    )
}

/* ---------- live pose relay ---------- */

async fn ws_pose(
    State(state): State<Arc<AppState>>,
    Query(query): Query<HashMap<String, String>>,
    ws: WebSocketUpgrade,
) -> Response {
    let viewer = query
        .get("role")
        .map(|role| role == "viewer")
        .unwrap_or(false);
    ws.on_upgrade(move |socket| handle_socket(socket, state, viewer))
}

fn status_message(state: &AppState) -> String {
    json!({
        "t": "status",
        "viewers": state.viewers.load(Ordering::SeqCst),
        "panels": state.panels.load(Ordering::SeqCst),
    })
    .to_string()
}

fn broadcast_status(state: &AppState) {
    let _ = state.status_tx.send(status_message(state));
}

async fn handle_socket(socket: WebSocket, state: Arc<AppState>, viewer: bool) {
    let (mut sender, mut receiver) = socket.split();
    let mut pose_rx = state.pose_tx.subscribe();
    let mut status_rx = state.status_tx.subscribe();

    if viewer {
        state.viewers.fetch_add(1, Ordering::SeqCst);
    } else {
        state.panels.fetch_add(1, Ordering::SeqCst);
    }
    broadcast_status(&state);

    let mut heartbeat = tokio::time::interval(Duration::from_secs(30));
    heartbeat.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    let mut rate_window = Instant::now();
    let mut rate_count = 0u32;

    loop {
        tokio::select! {
            _ = heartbeat.tick() => {
                if sender.send(Message::Ping(Vec::new().into())).await.is_err() {
                    break;
                }
            }
            incoming = receiver.next() => {
                match incoming {
                    None | Some(Err(_)) | Some(Ok(Message::Close(_))) => break,
                    Some(Ok(Message::Ping(payload))) => {
                        if sender.send(Message::Pong(payload)).await.is_err() {
                            break;
                        }
                    }
                    Some(Ok(Message::Text(text))) if !viewer => {
                        if text.len() > MAX_WS_BYTES {
                            continue;
                        }
                        if rate_window.elapsed() > Duration::from_secs(1) {
                            rate_window = Instant::now();
                            rate_count = 0;
                        }
                        rate_count += 1;
                        if rate_count > 120 {
                            continue;
                        }
                        let Ok(parsed) = serde_json::from_str::<Value>(text.as_str()) else {
                            continue;
                        };
                        let Some(pose) = pose::normalize(&parsed) else {
                            continue;
                        };
                        let _ = state.pose_tx.send(pose.to_string());
                    }
                    Some(Ok(_)) => {}
                }
            }
            frame = pose_rx.recv(), if viewer => {
                match frame {
                    Ok(frame) => {
                        if sender.send(Message::Text(frame.into())).await.is_err() {
                            break;
                        }
                    }
                    Err(broadcast::error::RecvError::Lagged(_)) => continue,
                    Err(_) => break,
                }
            }
            status = status_rx.recv(), if !viewer => {
                match status {
                    Ok(frame) => {
                        if sender.send(Message::Text(frame.into())).await.is_err() {
                            break;
                        }
                    }
                    Err(broadcast::error::RecvError::Lagged(_)) => continue,
                    Err(_) => break,
                }
            }
        }
    }

    if viewer {
        state.viewers.fetch_sub(1, Ordering::SeqCst);
    } else {
        state.panels.fetch_sub(1, Ordering::SeqCst);
    }
    broadcast_status(&state);
}

#[cfg(test)]
mod tests {
    use super::*;
    use http_body_util::BodyExt;
    use tower::ServiceExt;

    fn app() -> (Router, tempfile::TempDir) {
        let dir = tempfile::tempdir().expect("temp dir");
        let state = Arc::new(AppState::new(dir.path().to_path_buf()));
        (router(state), dir)
    }

    fn request(method: Method, uri: &str, body: Body) -> Request<Body> {
        Request::builder()
            .method(method)
            .uri(uri)
            .header(header::HOST, "127.0.0.1:8770")
            .body(body)
            .expect("request")
    }

    async fn call(app: &Router, req: Request<Body>) -> (StatusCode, HeaderMap, Vec<u8>) {
        let res = app.clone().oneshot(req).await.expect("response");
        let status = res.status();
        let headers = res.headers().clone();
        let bytes = res
            .into_body()
            .collect()
            .await
            .expect("body")
            .to_bytes()
            .to_vec();
        (status, headers, bytes)
    }

    fn glb(json: &[u8]) -> Vec<u8> {
        let mut out = Vec::new();
        out.extend_from_slice(&0x4654_6c67u32.to_le_bytes());
        out.extend_from_slice(&2u32.to_le_bytes());
        out.extend_from_slice(&(12 + 8 + json.len() as u32).to_le_bytes());
        out.extend_from_slice(&(json.len() as u32).to_le_bytes());
        out.extend_from_slice(&0x4e4f_534au32.to_le_bytes());
        out.extend_from_slice(json);
        out
    }

    #[test]
    fn state_etag_round_trip() {
        let runtime = tokio::runtime::Runtime::new().expect("runtime");
        runtime.block_on(async {
            let (app, _dir) = app();

            let (status, headers, _) =
                call(&app, request(Method::GET, "/api/state", Body::empty())).await;
            assert_eq!(status, StatusCode::OK);
            let etag = headers
                .get(header::ETAG)
                .and_then(|v| v.to_str().ok())
                .expect("etag")
                .to_string();

            let mut req = request(Method::GET, "/api/state", Body::empty());
            req.headers_mut()
                .insert(header::IF_NONE_MATCH, etag.parse().unwrap());
            let (status, _, body) = call(&app, req).await;
            assert_eq!(status, StatusCode::NOT_MODIFIED);
            assert!(body.is_empty());

            let (status, _, _) = call(
                &app,
                request(
                    Method::PUT,
                    "/api/state",
                    Body::from(r#"{"settings":{"zoom":1.25}}"#),
                ),
            )
            .await;
            assert_eq!(status, StatusCode::OK);

            let mut req = request(Method::GET, "/api/state", Body::empty());
            req.headers_mut()
                .insert(header::IF_NONE_MATCH, etag.parse().unwrap());
            let (status, _, body) = call(&app, req).await;
            assert_eq!(status, StatusCode::OK);
            let text = String::from_utf8(body).unwrap();
            assert!(text.contains("1.25"));
        });
    }

    #[test]
    fn avatar_upload_rejects_non_vrm_and_accepts_valid_glb() {
        let runtime = tokio::runtime::Runtime::new().expect("runtime");
        runtime.block_on(async {
            let (app, dir) = app();
            let avatar_path = dir.path().join("avatar.vrm");

            let (status, _, _) = call(
                &app,
                request(
                    Method::PUT,
                    "/api/avatar?name=bad.vrm",
                    Body::from("definitely not a glb"),
                ),
            )
            .await;
            assert_eq!(status, StatusCode::UNSUPPORTED_MEDIA_TYPE);
            assert!(!avatar_path.exists());
            assert!(!dir.path().join("avatar.vrm.part").exists());

            let valid = glb(br#"{"extensions":{"VRMC_vrm":{"meta":{}}}}"#);
            let (status, _, _) = call(
                &app,
                request(Method::PUT, "/api/avatar?name=ok.vrm", Body::from(valid)),
            )
            .await;
            assert_eq!(status, StatusCode::OK);
            assert!(avatar_path.exists());

            let (status, _, body) =
                call(&app, request(Method::GET, "/api/state", Body::empty())).await;
            assert_eq!(status, StatusCode::OK);
            let text = String::from_utf8(body).unwrap();
            assert!(text.contains("\"avatarExists\":true"));
            assert!(text.contains("ok.vrm"));
        });
    }

    #[test]
    fn background_round_trip() {
        let runtime = tokio::runtime::Runtime::new().expect("runtime");
        runtime.block_on(async {
            let (app, _dir) = app();

            let (status, _, _) = call(
                &app,
                request(
                    Method::PUT,
                    "/api/background",
                    Body::from(r#"{"dataUrl":"data:image/png;base64,AAAA"}"#),
                ),
            )
            .await;
            assert_eq!(status, StatusCode::OK);

            let (status, _, body) =
                call(&app, request(Method::GET, "/api/background", Body::empty())).await;
            assert_eq!(status, StatusCode::OK);
            assert!(String::from_utf8(body).unwrap().contains("data:image/png"));

            let (status, _, _) = call(
                &app,
                request(Method::DELETE, "/api/background", Body::empty()),
            )
            .await;
            assert_eq!(status, StatusCode::OK);

            let (status, _, _) =
                call(&app, request(Method::GET, "/api/background", Body::empty())).await;
            assert_eq!(status, StatusCode::NOT_FOUND);
        });
    }

    #[test]
    fn profile_round_trip_copies_assets_and_settings() {
        let runtime = tokio::runtime::Runtime::new().expect("runtime");
        runtime.block_on(async {
            let (app, _dir) = app();

            let (status, _, _) = call(
                &app,
                request(
                    Method::PUT,
                    "/api/state",
                    Body::from(r#"{"settings":{"zoom":1.25}}"#),
                ),
            )
            .await;
            assert_eq!(status, StatusCode::OK);

            let valid = glb(br#"{"extensions":{"VRMC_vrm":{"meta":{}}}}"#);
            let (status, _, _) = call(
                &app,
                request(Method::PUT, "/api/avatar?name=ok.vrm", Body::from(valid)),
            )
            .await;
            assert_eq!(status, StatusCode::OK);
            let (status, _, _) = call(
                &app,
                request(
                    Method::PUT,
                    "/api/background",
                    Body::from(r#"{"dataUrl":"data:image/png;base64,AAAA"}"#),
                ),
            )
            .await;
            assert_eq!(status, StatusCode::OK);

            let (status, _, body) = call(
                &app,
                request(
                    Method::POST,
                    "/api/profiles",
                    Body::from(r#"{"name":"Siang"}"#),
                ),
            )
            .await;
            assert_eq!(status, StatusCode::OK);
            let created: Value = serde_json::from_slice(&body).expect("profile json");
            let id = created
                .pointer("/profile/id")
                .and_then(Value::as_str)
                .expect("profile id")
                .to_string();

            let (status, _, body) =
                call(&app, request(Method::GET, "/api/profiles", Body::empty())).await;
            assert_eq!(status, StatusCode::OK);
            let listed: Value = serde_json::from_slice(&body).expect("list json");
            assert_eq!(
                listed.pointer("/profiles/0/name").and_then(Value::as_str),
                Some("Siang")
            );
            assert_eq!(
                listed
                    .pointer("/profiles/0/hasAvatar")
                    .and_then(Value::as_bool),
                Some(true)
            );

            // Change the active state, then applying the profile must restore it.
            let (status, _, _) = call(
                &app,
                request(
                    Method::PUT,
                    "/api/state",
                    Body::from(r#"{"settings":{"zoom":2.0}}"#),
                ),
            )
            .await;
            assert_eq!(status, StatusCode::OK);
            let (status, _, _) =
                call(&app, request(Method::DELETE, "/api/avatar", Body::empty())).await;
            assert_eq!(status, StatusCode::OK);
            let (status, _, _) = call(
                &app,
                request(Method::DELETE, "/api/background", Body::empty()),
            )
            .await;
            assert_eq!(status, StatusCode::OK);

            let (status, _, _) = call(
                &app,
                request(
                    Method::POST,
                    &format!("/api/profiles/{id}/apply"),
                    Body::empty(),
                ),
            )
            .await;
            assert_eq!(status, StatusCode::OK);

            let (status, _, body) =
                call(&app, request(Method::GET, "/api/state", Body::empty())).await;
            assert_eq!(status, StatusCode::OK);
            let state: Value = serde_json::from_slice(&body).expect("state json");
            assert_eq!(
                state.pointer("/settings/zoom").and_then(Value::as_f64),
                Some(1.25)
            );
            assert_eq!(
                state.get("avatarExists").and_then(Value::as_bool),
                Some(true)
            );
            assert_eq!(state.get("bgExists").and_then(Value::as_bool), Some(true));

            let (status, _, _) = call(
                &app,
                request(
                    Method::DELETE,
                    &format!("/api/profiles/{id}"),
                    Body::empty(),
                ),
            )
            .await;
            assert_eq!(status, StatusCode::OK);
            let (status, _, body) =
                call(&app, request(Method::GET, "/api/profiles", Body::empty())).await;
            assert_eq!(status, StatusCode::OK);
            let listed: Value = serde_json::from_slice(&body).expect("empty list json");
            assert_eq!(
                listed
                    .get("profiles")
                    .and_then(Value::as_array)
                    .map(Vec::len),
                Some(0)
            );
        });
    }

    #[test]
    fn rejects_foreign_host_and_serves_frontend() {
        let runtime = tokio::runtime::Runtime::new().expect("runtime");
        runtime.block_on(async {
            let (app, _dir) = app();

            let mut req = request(Method::GET, "/", Body::empty());
            req.headers_mut()
                .insert(header::HOST, "evil.example".parse().unwrap());
            let (status, _, _) = call(&app, req).await;
            assert_eq!(status, StatusCode::FORBIDDEN);

            let (status, headers, body) =
                call(&app, request(Method::GET, "/", Body::empty())).await;
            assert_eq!(status, StatusCode::OK);
            assert_eq!(
                headers.get(header::CONTENT_TYPE).unwrap(),
                "text/html; charset=utf-8"
            );
            assert!(!body.is_empty());
        });
    }
}
