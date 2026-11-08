//! Prove-It enclave core.
//!
//! Everything here is deterministic and runs on the host, so `cargo test` covers it.
//! Network access lives behind [`hl::Transport`] and keys and storage behind
//! [`platform::Platform`]; the wasm binary (`src/main.rs`) supplies the WASI HTTP
//! client and the OutLayer host functions.

pub mod auth;
pub mod canonical;
pub mod card;
pub mod commit;
pub mod door;
pub mod ecies;
pub mod error;
pub mod feed;
pub mod hl;
pub mod kanon;
pub mod merkle;
pub mod near;
pub mod nep413;
pub mod orders;
pub mod ownership;
pub mod pipeline;
pub mod platform;
pub mod reveal;
pub mod rules;
pub mod stats;

pub use error::{Code, Error};
