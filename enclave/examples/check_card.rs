//! Reads the enclave's stdout and checks it parses into the strict SignedCard type, and
//! that the signature verifies under the given public key (hex) when one is passed.
//!
//!   wasmtime run ... proveit-enclave.wasm | cargo run -q --example check_card [pubkey]

use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use proveit_enclave::card::{self, SignedCard};
use std::io::Read;

fn main() {
    let mut raw = String::new();
    std::io::stdin().read_to_string(&mut raw).expect("read stdin");
    let mut answer: serde_json::Value = serde_json::from_str(&raw).expect("stdout is not JSON");
    if answer["status"] != "ok" {
        eprintln!("enclave refused: {answer}");
        std::process::exit(1);
    }
    answer.as_object_mut().unwrap().remove("status");
    let signed: SignedCard = match serde_json::from_value(answer) {
        Ok(s) => s,
        Err(e) => {
            eprintln!("not a valid SignedCard: {e}");
            std::process::exit(1);
        }
    };
    let c = &signed.card;
    let mut line = format!(
        "card ok: {} {}d return {} bps, max drawdown {} bps, {} trades, {} orders, mode {}",
        c.venue, c.window.days, c.stats.return_bps, c.stats.max_dd_bps, c.stats.trades, c.orders.count, c.mode
    );
    if let Some(pk) = std::env::args().nth(1) {
        let key = VerifyingKey::from_bytes(&hex::decode(&pk).unwrap().try_into().unwrap()).unwrap();
        let sig = Signature::from_bytes(&signed.signature().unwrap());
        match key.verify(&card::signing_message(c).unwrap(), &sig) {
            Ok(()) => line.push_str(", signature ✔"),
            Err(_) => {
                eprintln!("{line}, signature ✘");
                std::process::exit(1);
            }
        }
    }
    println!("{line}");
}
