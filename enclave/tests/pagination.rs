//! T1.7: fill pagination against a mock that behaves like the real endpoint
//! (oldest first, at most 2,000 per page, startTime inclusive).

use proveit_enclave::hl::{Client, Source, Transport, FILL_CAP, PAGE_SIZE};
use proveit_enclave::{Code, Error};
use serde_json::{json, Value};
use std::cell::Cell;
use std::collections::HashSet;

struct MockApi {
    /// (time, tid), sorted by time.
    fills: Vec<(u64, u64)>,
    calls: Cell<u32>,
}

impl MockApi {
    fn new(fills: Vec<(u64, u64)>) -> Self {
        Self { fills, calls: Cell::new(0) }
    }
}

impl Transport for MockApi {
    fn post(&self, body: &Value) -> Result<Vec<u8>, Error> {
        self.calls.set(self.calls.get() + 1);
        assert_eq!(body["type"], "userFillsByTime");
        let start = body["startTime"].as_u64().unwrap();
        let end = body["endTime"].as_u64().unwrap();
        let page: Vec<Value> = self
            .fills
            .iter()
            .filter(|(t, _)| *t >= start && *t <= end)
            .take(PAGE_SIZE)
            .map(|(t, tid)| {
                json!({"coin":"ETH","px":"3000.0","sz":"0.1","side":"B","time":t,"dir":"Open Long",
                       "closedPnl":"0.0","fee":"0.01","feeToken":"USDC","oid":tid,"tid":tid})
            })
            .collect();
        Ok(serde_json::to_vec(&page).unwrap())
    }
}

/// 4,500 fills where five share each millisecond, so page boundaries cut through a
/// millisecond: restarting at `last + 1` would drop fills, restarting at `last` without
/// de-duplication would double-count them.
fn clustered(n: u64) -> Vec<(u64, u64)> {
    (0..n).map(|i| (1_000 + i / 5, i)).collect()
}

#[test]
fn pagination_no_duplicates() {
    let api = MockApi::new(clustered(4_500));
    let client = Client { transport: api };
    let fills = client.fills_between("0xabc", 0, u64::MAX).unwrap();
    assert_eq!(fills.len(), 4_500);
    let unique: HashSet<u64> = fills.iter().map(|f| f.tid).collect();
    assert_eq!(unique.len(), 4_500);
    assert!(fills.windows(2).all(|w| (w[0].time, w[0].tid) <= (w[1].time, w[1].tid)));
    assert!(client.transport.calls.get() >= 3);
}

#[test]
fn pagination_respects_the_window() {
    let client = Client { transport: MockApi::new(clustered(4_500)) };
    let fills = client.fills_between("0xabc", 1_100, 1_199).unwrap();
    assert_eq!(fills.len(), 500); // 100 milliseconds × 5 fills
    assert!(fills.iter().all(|f| (1_100..=1_199).contains(&f.time)));
}

#[test]
fn more_than_the_cap_is_refused() {
    let client = Client { transport: MockApi::new(clustered(FILL_CAP as u64 + 500)) };
    assert_eq!(client.fills_between("0xabc", 0, u64::MAX).unwrap_err().code, Code::FillCapExceeded);
}

#[test]
fn a_full_page_in_one_millisecond_is_an_error_not_a_loop() {
    let fills = (0..PAGE_SIZE as u64 + 10).map(|i| (5_000, i)).collect();
    let client = Client { transport: MockApi::new(fills) };
    assert_eq!(client.fills_between("0xabc", 0, u64::MAX).unwrap_err().code, Code::Upstream);
}
