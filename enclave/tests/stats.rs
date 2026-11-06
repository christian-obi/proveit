//! T1.3–T1.6 and T1.8: statistics and rules.

use proptest::prelude::*;
use proveit_enclave::hl::{Fill, FixtureSource, Point, Series};
use proveit_enclave::stats::{self, MS_PER_DAY};
use proveit_enclave::{pipeline, rules, Code};
use rust_decimal::Decimal;
use serde_json::Value;
use std::path::PathBuf;
use std::str::FromStr;

fn fixture(name: &str) -> FixtureSource {
    FixtureSource { dir: PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("fixtures").join(name) }
}

fn expected(name: &str) -> Value {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("fixtures").join(name).join("expected_stats.json");
    serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap()
}

/// T1.3: every fixture matches the independent reference (scripts/reference-stats.ts).
fn golden(name: &str) {
    let exp = expected(name);
    let got = pipeline::measure(&fixture(name), "fixture", 30);
    match exp["status"].as_str().unwrap() {
        "ok" => {
            let m = got.unwrap_or_else(|e| panic!("{name}: expected a card, got {e}"));
            assert_eq!(serde_json::to_value(&m.stats).unwrap(), exp["stats"], "{name}: stats");
            assert_eq!(serde_json::to_value(&m.window).unwrap(), exp["window"], "{name}: window");
        }
        _ => {
            let err = got.err().unwrap_or_else(|| panic!("{name}: expected a refusal"));
            assert_eq!(serde_json::to_value(err.code).unwrap(), exp["code"], "{name}: code");
        }
    }
}

#[test]
fn golden_winner() {
    golden("winner");
}
#[test]
fn golden_loser() {
    golden("loser");
}
#[test]
fn golden_few_orders() {
    golden("few_orders");
}
#[test]
fn golden_late_funded() {
    golden("late_funded");
}
#[test]
fn golden_hlp_vault() {
    golden("hlp_vault");
}

// ---- synthetic series ------------------------------------------------------------

fn d(x: f64) -> Decimal {
    Decimal::from_str(&format!("{x:.6}")).unwrap()
}

/// Build a series the way Hyperliquid reports it: account value includes flows,
/// cumulative pnl does not. `periods[i] = (return, flow)`: the flow lands at the start
/// of the period, then the return is earned on the new capital.
fn synth(start_av: f64, periods: &[(f64, f64)]) -> Series {
    let mut av = start_av;
    let mut pnl = 0.0;
    let mut t = 0u64;
    let mut account_value = vec![Point { t, v: d(av) }];
    let mut pnl_hist = vec![Point { t, v: d(pnl) }];
    for &(r, flow) in periods {
        // A flow is its own sampling period with zero pnl, as when a deposit lands
        // between samples. Then the return is earned on the new capital. Like the real
        // exchange, a withdrawal can't take more than the account holds; this one also
        // keeps $1,000 so the account stays above MIN_CAPITAL.
        let flow = if av + flow < 1_000.0 { 0.0 } else { flow };
        if flow != 0.0 {
            av += flow;
            t += MS_PER_DAY;
            account_value.push(Point { t, v: d(av) });
            pnl_hist.push(Point { t, v: d(pnl) });
        }
        let earned = av * r;
        av += earned;
        pnl += earned;
        t += MS_PER_DAY;
        account_value.push(Point { t, v: d(av) });
        pnl_hist.push(Point { t, v: d(pnl) });
    }
    Series { account_value, pnl: pnl_hist }
}

fn as_f64(x: Decimal) -> f64 {
    x.to_string().parse().unwrap()
}

proptest! {
    /// T1.4: deposits and withdrawals never change the time-weighted return.
    #[test]
    fn twr_ignores_deposits(
        rets in prop::collection::vec(-0.2f64..0.3, 5..40),
        flows in prop::collection::vec(prop_oneof![Just(0.0), 1_000.0f64..50_000.0, -2_000.0f64..-500.0], 5..40),
    ) {
        let periods_no_flow: Vec<(f64, f64)> = rets.iter().map(|&r| (r, 0.0)).collect();
        let periods_flow: Vec<(f64, f64)> = rets.iter().zip(flows.iter().cycle()).map(|(&r, &f)| (r, f)).collect();
        let a = stats::returns(&synth(20_000.0, &periods_no_flow)).unwrap();
        let b = stats::returns(&synth(20_000.0, &periods_flow)).unwrap();
        let truth: f64 = rets.iter().map(|r| 1.0 + r).product::<f64>() - 1.0;
        // Series values are rounded to 6 decimals, like the API's strings.
        prop_assert!((as_f64(a.twr) - truth).abs() < 1e-6, "no flows: {} vs {truth}", a.twr);
        prop_assert!((as_f64(b.twr) - truth).abs() < 1e-6, "with flows: {} vs {truth}", b.twr);
    }

    /// T1.5: drawdown is a fraction between 0 and 1.
    #[test]
    fn mdd_bounds(rets in prop::collection::vec(-0.9f64..2.0, 2..60)) {
        let periods: Vec<(f64, f64)> = rets.iter().map(|&r| (r, 0.0)).collect();
        let r = stats::returns(&synth(10_000.0, &periods)).unwrap();
        prop_assert!(r.max_drawdown >= Decimal::ZERO && r.max_drawdown <= Decimal::ONE);
        let bps = stats::to_bps(r.max_drawdown);
        prop_assert!((0..=10_000).contains(&bps));
    }
}

#[test]
fn mdd_is_zero_for_rising_equity() {
    let r = stats::returns(&synth(10_000.0, &[(0.01, 0.0); 20])).unwrap();
    assert_eq!(r.max_drawdown, Decimal::ZERO);
}

#[test]
fn mdd_of_a_known_path() {
    // +100% then -50% then +25%: peak 2.0, trough 1.0, so 50% drawdown.
    let r = stats::returns(&synth(10_000.0, &[(1.0, 0.0), (-0.5, 0.0), (0.25, 0.0)])).unwrap();
    assert_eq!(stats::to_bps(r.max_drawdown), 5_000);
    assert_eq!(stats::to_bps(r.twr), 2_500);
}

#[test]
fn measurement_starts_at_first_funded_sample() {
    let mut s = synth(10_000.0, &[(0.1, 0.0); 3]);
    s.account_value[0].v = Decimal::ZERO;
    s.account_value[1].v = d(50.0);
    let r = stats::returns(&s).unwrap();
    assert_eq!(r.start_ms, s.account_value[2].t);
}

#[test]
fn periods_below_min_capital_are_skipped() {
    // $10,000 → withdraw down to $50 → +100% on $50 → deposit back. The +100% on dust
    // must not count: TWR stays at the 0% earned on real capital.
    let s = synth(10_000.0, &[(0.0, -9_950.0)]);
    let mut av: Vec<Point> = s.account_value.clone();
    let mut pnl: Vec<Point> = s.pnl.clone();
    let t = av.last().unwrap().t;
    av.push(Point { t: t + MS_PER_DAY, v: d(50.0) });
    pnl.push(Point { t: t + MS_PER_DAY, v: d(0.0) });
    av.push(Point { t: t + 2 * MS_PER_DAY, v: d(100.0) });
    pnl.push(Point { t: t + 2 * MS_PER_DAY, v: d(50.0) });
    let r = stats::returns(&Series { account_value: av, pnl }).unwrap();
    assert_eq!(stats::to_bps(r.twr), 0);
    assert!(r.skipped_periods >= 1);
}

#[test]
fn never_funded_is_window_too_short() {
    let s = Series { account_value: vec![Point { t: 0, v: Decimal::ZERO }; 3], pnl: vec![Point { t: 0, v: Decimal::ZERO }; 3] };
    assert_eq!(stats::returns(&s).unwrap_err().code, Code::WindowTooShort);
}

#[test]
fn rounding_is_half_away_from_zero() {
    assert_eq!(stats::to_bps(d(0.00005)), 1);
    assert_eq!(stats::to_bps(d(-0.00005)), -1);
    assert_eq!(stats::to_bps(d(0.000049)), 0);
    assert_eq!(stats::volume_band(d(999_999.0)), "1e5");
    assert_eq!(stats::volume_band(d(1_000_000.0)), "1e6");
}

// ---- trades ---------------------------------------------------------------------

fn fill(oid: u64, tid: u64, dir: &str, closed_pnl: f64, fee: f64) -> Fill {
    Fill {
        coin: "BTC".into(),
        px: d(100_000.0),
        sz: d(0.01),
        side: "A".into(),
        time: 1_000 + tid,
        dir: dir.into(),
        closed_pnl: d(closed_pnl),
        fee: d(fee),
        fee_token: "USDC".into(),
        oid,
        tid,
    }
}

/// T1.6: a trade is one order that realized PnL, net of its fees.
#[test]
fn trade_grouping() {
    let fills = [
        fill(1, 1, "Close Long", 10.0, 1.0),
        fill(1, 2, "Close Long", 5.0, 1.0), // same order as tid 1: one trade, net +13
        fill(2, 3, "Open Long", 0.0, 0.5),  // opening: not a trade
        fill(3, 4, "Close Short", -4.0, 0.5), // net -4.5
        fill(4, 5, "Close Long", 0.0, 0.2), // breakeven close: net -0.2, a loss
    ];
    let t = stats::trades(&fills);
    assert_eq!(t.trades, 3);
    assert_eq!(t.wins, 1);
    assert_eq!(stats::to_x100(t.profit_factor.unwrap()), stats::to_x100(d(13.0) / d(4.7)));
    assert_eq!(t.active_days, 1);
}

#[test]
fn profit_factor_is_none_without_losses() {
    let t = stats::trades(&[fill(1, 1, "Close Long", 10.0, 1.0)]);
    assert_eq!(t.profit_factor, None);
}

#[test]
fn non_usdc_fees_are_not_subtracted() {
    let mut f = fill(1, 1, "Close Long", 10.0, 3.0);
    f.fee_token = "HYPE".into();
    let t = stats::trades(&[f]);
    assert_eq!(t.wins, 1);
    assert_eq!(t.profit_factor, None);
}

// ---- rules (T1.8) -----------------------------------------------------------------

#[test]
fn rules_too_few_trades() {
    let fills: Vec<Fill> = (0..19).map(|i| fill(i, i, "Close Long", 1.0, 0.0)).collect();
    assert_eq!(rules::check_trades(&stats::trades(&fills)).unwrap_err().code, Code::TooFewTrades);
    let fills: Vec<Fill> = (0..20).map(|i| fill(i, i, "Close Long", 1.0, 0.0)).collect();
    rules::check_trades(&stats::trades(&fills)).unwrap();
}

#[test]
fn rules_account_too_new() {
    assert_eq!(rules::check_account_age(2_000, 1_000).unwrap_err().code, Code::AccountTooNew);
    rules::check_account_age(1_000, 1_000).unwrap();
}

#[test]
fn rules_window_too_short() {
    let s = synth(10_000.0, &[(0.0, 0.0); 27]); // 27 days measured
    let r = stats::returns(&s).unwrap();
    assert_eq!(rules::check_window(&r, 30).unwrap_err().code, Code::WindowTooShort);
    let s = synth(10_000.0, &[(0.0, 0.0); 29]);
    rules::check_window(&stats::returns(&s).unwrap(), 30).unwrap();
}

#[test]
fn bad_window_length_is_refused() {
    let e = pipeline::measure(&fixture("winner"), "fixture", 45).err().unwrap();
    assert_eq!(e.code, Code::BadInput);
}
