//! Validation for the local pose relay, ported from `src/pose-protocol.js`.
//! Every message is checked before it is broadcast to OBS viewers.

use serde_json::{json, Map, Value};

pub const POSE_KEYS: [&str; 17] = [
    "blink",
    "blinkLeft",
    "blinkRight",
    "aa",
    "ih",
    "ou",
    "ee",
    "oh",
    "happy",
    "angry",
    "sad",
    "surprised",
    "relaxed",
    "lookUp",
    "lookDown",
    "lookLeft",
    "lookRight",
];

/// Returns a compact, rounded message, or `None` when the input is malformed.
pub fn normalize(raw: &Value) -> Option<Value> {
    if raw.get("t").and_then(Value::as_str) != Some("pose") {
        return None;
    }

    let weights = raw.get("w")?.as_object()?;
    let mut out = Map::new();

    for key in POSE_KEYS {
        let Some(value) = weights.get(key) else {
            continue;
        };
        let number = value.as_f64()?;
        if !(0.0..=1.0).contains(&number) {
            return None;
        }
        out.insert(key.to_string(), json!((number * 1000.0).round() / 1000.0));
    }

    let head = match raw.get("head") {
        None => Value::Null,
        Some(value) => {
            let items = value.as_array()?;
            if items.len() != 4 {
                return None;
            }
            let mut rounded = Vec::with_capacity(4);
            for item in items {
                let number = item.as_f64()?;
                if !number.is_finite() {
                    return None;
                }
                rounded.push(json!((number * 10_000.0).round() / 10_000.0));
            }
            Value::Array(rounded)
        }
    };

    if out.is_empty() && head.is_null() {
        return None;
    }

    Some(json!({ "t": "pose", "w": out, "head": head }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_and_rounds_pose() {
        let raw = json!({"t":"pose","w":{"aa":0.123456,"blink":1},"head":[0.1234567,0,0,1]});
        let pose = normalize(&raw).expect("valid pose");
        assert_eq!(pose["w"]["aa"], json!(0.123));
        assert_eq!(pose["head"][0], json!(0.1235));
    }

    #[test]
    fn rejects_out_of_range() {
        assert!(normalize(&json!({"t":"pose","w":{"aa":1.2}})).is_none());
    }

    #[test]
    fn rejects_bad_head_length() {
        assert!(normalize(&json!({"t":"pose","w":{"aa":0.5},"head":[0,0,1]})).is_none());
    }

    #[test]
    fn rejects_empty() {
        assert!(normalize(&json!({"t":"pose","w":{},"head":null})).is_none());
    }

    #[test]
    fn drops_unknown_keys() {
        let pose = normalize(&json!({"t":"pose","w":{"aa":0.5,"evil":9}})).unwrap();
        assert!(pose["w"].get("evil").is_none());
    }
}
