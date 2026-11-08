//! T9.1: the k-anonymity guard (src/kanon.rs).

use proptest::prelude::*;
use proveit_enclave::hl::{FixtureSource, Source};
use proveit_enclave::kanon::{self, Board, K_MIN, PRECISIONS_BPS};
use proveit_enclave::pipeline::{self, IssueParams};
use proveit_enclave::platform::test::TestPlatform;
use proveit_enclave::Code;
use std::path::PathBuf;

fn fixtures() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("fixtures")
}

fn recorded() -> Board {
    FixtureSource { dir: fixtures().join("winner") }.leaderboard().unwrap()
}

/// A crowd around 0% and one outlier: the outlier's bucket must widen until it is hidden.
#[test]
fn coarsens_until_k() {
    let mut crowd: Vec<i64> = (0..2_000).map(|i| (i % 400) - 200).collect(); // −2% … +2%, 5 per bp
    crowd.extend([1_234, 1_250, 1_299]); // three accounts near +12.3%
    crowd.extend((0..30).map(|i| 1_000 + i * 50)); // 30 spread over +10% … +24.5%
    crowd.sort();

    // Near 0% the narrowest bucket already holds 50 accounts.
    assert_eq!(kanon::coarsen(37, &crowd, K_MIN).unwrap(), kanon::Anon { return_bps: 30, precision_bps: 10, k: 50 });
    // +12.34%: 0.1% → 1 account, 1% → 5, 5% → 13 (10–14.99%: 10 spread + 3), 25% → 33.
    let a = kanon::coarsen(1_234, &crowd, K_MIN).unwrap();
    assert_eq!((a.return_bps, a.precision_bps), (0, 2_500));
    assert!(a.k >= K_MIN);
    // An extreme return nobody else is near is refused rather than published.
    assert_eq!(kanon::coarsen(90_000, &crowd, K_MIN).unwrap_err().code, Code::PrivacyRisk);
    // Negative returns round down too: −1.55% with 1% precision is the −2%…−1% bucket.
    assert_eq!(kanon::coarsen(-155, &crowd, 10).unwrap().return_bps, -160);
}

proptest! {
    /// Whatever the return, the published bucket contains it and at least K_MIN accounts.
    #[test]
    fn never_below_k_min(ret in -10_000i64..100_000) {
        let board = recorded();
        match kanon::coarsen(ret, &board.month, K_MIN) {
            Ok(a) => {
                prop_assert!(a.k >= K_MIN);
                prop_assert!(PRECISIONS_BPS.contains(&a.precision_bps));
                prop_assert!(a.return_bps <= ret && ret < a.return_bps + a.precision_bps);
                prop_assert_eq!(a.k, kanon::count(&board.month, a.return_bps, a.precision_bps));
            }
            Err(e) => prop_assert_eq!(e.code, Code::PrivacyRisk),
        }
    }
}

#[test]
fn the_recorded_leaderboard_has_every_window_and_no_addresses() {
    let b = recorded();
    for w in [&b.day, &b.week, &b.month, &b.all_time] {
        assert!(w.len() > 40_000 && w.windows(2).all(|p| p[0] <= p[1]));
    }
    let raw = std::fs::read_to_string(fixtures().join("leaderboard.json")).unwrap();
    assert!(!raw.contains("0x"), "only numbers");
}

#[test]
fn the_live_format_parses_and_drops_everything_but_roi() {
    let row = |addr: &str, roi: &str| format!(r#"{{"ethAddress":"{addr}","accountValue":"1","windowPerformances":[["day",{{"pnl":"1","roi":"{roi}","vlm":"1"}}],["week",{{"pnl":"1","roi":"{roi}","vlm":"1"}}],["month",{{"pnl":"1","roi":"{roi}","vlm":"1"}}],["allTime",{{"pnl":"1","roi":"{roi}","vlm":"1"}}]]}}"#);
    let rows: Vec<String> = (0..1_200).map(|i| row(&format!("0x{i:040x}"), &format!("{}", i as f64 / 10_000.0))).collect();
    let json = format!(r#"{{"leaderboardRows":[{}]}}"#, rows.join(","));
    let b = Board::parse_live(json.as_bytes()).unwrap();
    assert_eq!(b.month.len(), 1_200);
    assert_eq!(b.month[5], 5);
    // A suspiciously small leaderboard is not trusted to judge privacy.
    let small = format!(r#"{{"leaderboardRows":[{}]}}"#, rows[..10].join(","));
    assert_eq!(Board::parse_live(small.as_bytes()).unwrap_err().code, Code::Upstream);
}

/// Issued cards carry the guard's result; the exact return stays inside the enclave.
#[test]
fn issued_cards_publish_the_bucket_and_k() {
    let src = FixtureSource { dir: fixtures().join("winner") };
    let exact = pipeline::measure(&src, "x", 30).unwrap().stats.return_bps;
    let card = pipeline::issue(
        &src,
        &TestPlatform::default(),
        &IssueParams { address: "0x0", window_days: 30, issuer: "t.testnet", nonce: 1, issued_at: 1_793_980_000, outlayer_request_id: None, mode: "fixture" },
    )
    .unwrap()
    .card;
    let s = &card.stats;
    let (p, k) = (s.return_precision_bps.unwrap(), s.k_anon.unwrap());
    assert!(k >= K_MIN && s.k_min == Some(K_MIN));
    assert!(s.return_bps <= exact && exact < s.return_bps + p);
    assert_eq!(k, kanon::count(&recorded().month, s.return_bps, p));
    println!("winner: exact {exact} bps → published {}..{} bps, 1 of ≥ {k}", s.return_bps, s.return_bps + p);
}

/// Agent cards: the issuer's label is signed into the card; anything else is refused.
#[test]
fn agent_kind_is_signed_in() {
    let src = FixtureSource { dir: fixtures().join("winner") };
    let p = IssueParams { address: "0x0", window_days: 30, issuer: "bot.testnet", nonce: 1, issued_at: 1_793_980_000, outlayer_request_id: None, mode: "fixture" };
    let card = pipeline::issue_as(&src, &TestPlatform::default(), &p, "agent").unwrap().card;
    assert_eq!(card.kind, "agent");
    assert_eq!(pipeline::issue_as(&src, &TestPlatform::default(), &p, "whale").unwrap_err().code, Code::BadInput);
}
