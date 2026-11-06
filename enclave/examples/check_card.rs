//! T1.10 helper: reads the enclave's stdout and checks it parses into the strict Card type.
//!
//!   wasmtime run ... proveit-enclave.wasm | cargo run -q --example check_card

use proveit_enclave::card::Card;
use std::io::Read;

fn main() {
    let mut raw = String::new();
    std::io::stdin().read_to_string(&mut raw).expect("read stdin");
    let answer: serde_json::Value = serde_json::from_str(&raw).expect("stdout is not JSON");
    if answer["status"] != "ok" {
        eprintln!("enclave refused: {answer}");
        std::process::exit(1);
    }
    match serde_json::from_value::<Card>(answer["card"].clone()) {
        Ok(card) => println!(
            "card ok: {} {}d return {} bps, max drawdown {} bps, {} trades, mode {}",
            card.venue, card.window.days, card.stats.return_bps, card.stats.max_dd_bps, card.stats.trades, card.mode
        ),
        Err(e) => {
            eprintln!("not a valid Card: {e}");
            std::process::exit(1);
        }
    }
}
