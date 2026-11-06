//! Canonical JSON: the exact bytes that get hashed and signed.
//!
//! Rules (the TypeScript verifier implements the same ones):
//! - object keys sorted by byte order, no whitespace;
//! - numbers are integers only, no floats, no exponents;
//! - strings are ASCII only, so no two encoders can disagree about escaping.
//!
//! serde_json's default map is a BTreeMap, so `to_string` already sorts keys and writes
//! compact output; this module checks the other two rules.

use crate::error::{Code, Error, Result};
use serde::Serialize;
use serde_json::Value;

pub fn to_canonical<T: Serialize>(value: &T) -> Result<String> {
    let v = serde_json::to_value(value).map_err(|e| Error::new(Code::BadInput, e.to_string()))?;
    check(&v)?;
    serde_json::to_string(&v).map_err(|e| Error::new(Code::BadInput, e.to_string()))
}

fn check(v: &Value) -> Result<()> {
    match v {
        Value::Number(n) if !(n.is_i64() || n.is_u64()) => {
            Err(Error::new(Code::BadInput, format!("canonical JSON allows integers only, got {n}")))
        }
        Value::String(s) if !s.is_ascii() => Err(Error::new(Code::BadInput, "canonical JSON allows ASCII strings only")),
        Value::Array(items) => items.iter().try_for_each(check),
        Value::Object(map) => map.iter().try_for_each(|(k, v)| {
            if !k.is_ascii() {
                return Err(Error::new(Code::BadInput, "canonical JSON allows ASCII keys only"));
            }
            check(v)
        }),
        _ => Ok(()),
    }
}
