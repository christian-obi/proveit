//! Prove-It enclave core.
//!
//! Everything here is deterministic and runs on the host, so `cargo test` covers it.
//! Network access lives behind the [`hl::Transport`] trait; the wasm binary
//! (`src/main.rs`) supplies the WASI HTTP implementation.

pub mod card;
pub mod error;
pub mod hl;
pub mod ownership;
pub mod pipeline;
pub mod rules;
pub mod stats;

pub use error::{Code, Error};
