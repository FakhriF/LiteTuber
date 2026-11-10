//! GLB/VRM header inspection, ported from `src/vrm.js`.
//!
//! A `.vrm` file is a GLB container: a 12-byte header (`glTF`, version 2,
//! length) followed by a JSON chunk. VRM data lives in that JSON under the
//! `VRM` (VRM 0.x) or `VRMC_vrm` (VRM 1.0) extension. The browser checks the
//! file before loading it; the server re-checks the stream so a renamed file
//! can never be stored as an avatar.

const GLB_MAGIC: u32 = 0x4654_6c67; // "glTF" little-endian
const CHUNK_JSON: u32 = 0x4e4f_534a; // "JSON"
const MAX_JSON_CHUNK: usize = 16 * 1024 * 1024;

#[derive(Debug, PartialEq, Eq)]
pub enum VrmCheck {
    Valid,
    NeedMore,
    Invalid(&'static str),
}

pub fn inspect(bytes: &[u8]) -> VrmCheck {
    if bytes.len() < 12 {
        return VrmCheck::NeedMore;
    }
    if read_u32(bytes, 0) != GLB_MAGIC {
        return VrmCheck::Invalid("bukan file GLB");
    }
    if read_u32(bytes, 4) != 2 {
        return VrmCheck::Invalid("versi glTF bukan 2");
    }
    if bytes.len() < 20 {
        return VrmCheck::NeedMore;
    }

    let json_len = read_u32(bytes, 12) as usize;
    if read_u32(bytes, 16) != CHUNK_JSON {
        return VrmCheck::Invalid("chunk pertama bukan JSON");
    }
    if json_len == 0 {
        return VrmCheck::Invalid("chunk JSON kosong");
    }
    if json_len > MAX_JSON_CHUNK {
        return VrmCheck::Invalid("chunk JSON terlalu besar");
    }
    if bytes.len() < 20 + json_len {
        return VrmCheck::NeedMore;
    }

    let raw = &bytes[20..20 + json_len];
    let trimmed = raw
        .iter()
        .rposition(|b| *b != 0)
        .map(|end| &raw[..=end])
        .unwrap_or(&[]);
    let text = match std::str::from_utf8(trimmed) {
        Ok(text) => text.trim(),
        Err(_) => return VrmCheck::Invalid("JSON avatar rusak"),
    };
    let json: serde_json::Value = match serde_json::from_str(text) {
        Ok(json) => json,
        Err(_) => return VrmCheck::Invalid("JSON avatar rusak"),
    };

    let extensions = json.get("extensions");
    let used: Vec<&str> = json
        .get("extensionsUsed")
        .and_then(|v| v.as_array())
        .map(|items| items.iter().filter_map(|v| v.as_str()).collect())
        .unwrap_or_default();

    let has_vrm = extensions
        .and_then(|e| e.get("VRM").or_else(|| e.get("VRMC_vrm")))
        .is_some()
        || used.contains(&"VRM")
        || used.contains(&"VRMC_vrm");

    if has_vrm {
        VrmCheck::Valid
    } else {
        VrmCheck::Invalid("tidak ada data VRM")
    }
}

fn read_u32(bytes: &[u8], offset: usize) -> u32 {
    u32::from_le_bytes([
        bytes[offset],
        bytes[offset + 1],
        bytes[offset + 2],
        bytes[offset + 3],
    ])
}

#[cfg(test)]
mod tests {
    use super::*;

    fn glb(version: u32, chunk_type: u32, json: &[u8]) -> Vec<u8> {
        let mut out = Vec::new();
        out.extend_from_slice(&GLB_MAGIC.to_le_bytes());
        out.extend_from_slice(&version.to_le_bytes());
        out.extend_from_slice(&(12 + 8 + json.len() as u32).to_le_bytes());
        out.extend_from_slice(&(json.len() as u32).to_le_bytes());
        out.extend_from_slice(&chunk_type.to_le_bytes());
        out.extend_from_slice(json);
        out
    }

    #[test]
    fn accepts_vrmc_vrm() {
        let file = glb(2, CHUNK_JSON, br#"{"extensions":{"VRMC_vrm":{"meta":{}}}}"#);
        assert_eq!(inspect(&file), VrmCheck::Valid);
    }

    #[test]
    fn accepts_extensions_used() {
        let file = glb(2, CHUNK_JSON, br#"{"extensionsUsed":["VRM"]}"#);
        assert_eq!(inspect(&file), VrmCheck::Valid);
    }

    #[test]
    fn rejects_non_glb() {
        assert_eq!(
            inspect(b"not a glb file at all"),
            VrmCheck::Invalid("bukan file GLB")
        );
    }

    #[test]
    fn rejects_plain_gltf_without_vrm() {
        let file = glb(2, CHUNK_JSON, br#"{"asset":{"version":"2.0"}}"#);
        assert_eq!(inspect(&file), VrmCheck::Invalid("tidak ada data VRM"));
    }

    #[test]
    fn asks_for_more_on_short_prefix() {
        let file = glb(2, CHUNK_JSON, br#"{"extensions":{"VRM":{}}}"#);
        assert_eq!(inspect(&file[..18]), VrmCheck::NeedMore);
    }
}
