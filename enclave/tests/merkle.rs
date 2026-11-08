//! T2.2: the Merkle tree matches the TypeScript implementation, and proofs hold.

use proveit_enclave::canonical::to_canonical;
use proveit_enclave::hl::FixtureSource;
use proveit_enclave::merkle::{self, Step};
use proveit_enclave::orders;
use proveit_enclave::pipeline;
use serde_json::Value;
use std::path::PathBuf;

fn vectors() -> Value {
    serde_json::from_str(include_str!("../../test-vectors/merkle.json")).unwrap()
}

#[test]
fn roots_and_proofs_match_typescript() {
    for tree in vectors()["trees"].as_array().unwrap() {
        let canon: Vec<String> = tree["records"].as_array().unwrap().iter().map(|r| to_canonical(r).unwrap()).collect();
        let expected_canon: Vec<&str> = tree["canonical"].as_array().unwrap().iter().map(|c| c.as_str().unwrap()).collect();
        assert_eq!(canon, expected_canon);

        let leaves: Vec<merkle::Hash> = canon.iter().map(|c| merkle::leaf_hash(c.as_bytes())).collect();
        let root = merkle::root(&leaves);
        assert_eq!(hex::encode(root), tree["root"].as_str().unwrap(), "{} leaves", leaves.len());

        for (i, leaf) in leaves.iter().enumerate() {
            let expected: Vec<Step> = serde_json::from_value(tree["proofs"][i].clone()).unwrap();
            assert_eq!(merkle::proof(&leaves, i), expected, "proof {i} of {}", leaves.len());
            assert!(merkle::verify(leaf, &expected, &root));
        }
    }
}

#[test]
fn a_modified_leaf_fails() {
    let tree = &vectors()["trees"][3];
    let leaves: Vec<merkle::Hash> =
        tree["canonical"].as_array().unwrap().iter().map(|c| merkle::leaf_hash(c.as_str().unwrap().as_bytes())).collect();
    let root = merkle::root(&leaves);
    let steps = merkle::proof(&leaves, 2);
    let forged = merkle::leaf_hash(br#"{"coin":"ETH","dir":"Open Short","fills":2,"hour":497650,"pnl_bps":0,"size_bps":80000}"#);
    assert!(!merkle::verify(&forged, &steps, &root));
    // A proof for one position can't be reused for another.
    assert!(!merkle::verify(&leaves[1], &steps, &root));
}

#[test]
fn every_real_order_proves_against_the_root() {
    let source = FixtureSource { dir: PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("fixtures").join("winner") };
    let m = pipeline::measure(&source, "x", 30).unwrap();
    let records = orders::records(&m.fills, &m.series.account_value);
    let leaves = orders::leaves(&records, &orders::salts([9u8; 32], records.len())).unwrap();
    let root = merkle::root(&leaves);
    for (i, leaf) in leaves.iter().enumerate() {
        assert!(merkle::verify(leaf, &merkle::proof(&leaves, i), &root));
    }
    // Records carry no identifiers, only coarsened facts.
    let sample = to_canonical(&records[0]).unwrap();
    for banned in ["oid", "tid", "hash", "px", "\"sz\""] {
        assert!(!sample.contains(banned), "record leaks {banned}: {sample}");
    }
}
