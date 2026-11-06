//! Merkle tree over a card's order records, so a follower can later check that revealed
//! trades are exactly the ones committed at issuance, with none hidden.
//!
//!   leaf = sha256(0x00 ‖ canonical_record)
//!   node = sha256(0x01 ‖ left ‖ right)
//!
//! The prefixes stop a leaf from passing as a node. An odd node at the end of a level is
//! carried up unchanged rather than paired with a copy of itself, which avoids the
//! duplicate-leaf ambiguity of Bitcoin-style trees. An empty tree's root is 32 zero bytes.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

pub type Hash = [u8; 32];

pub fn leaf_hash(canonical_record: &[u8]) -> Hash {
    let mut h = Sha256::new();
    h.update([0x00]);
    h.update(canonical_record);
    h.finalize().into()
}

fn node_hash(left: &Hash, right: &Hash) -> Hash {
    let mut h = Sha256::new();
    h.update([0x01]);
    h.update(left);
    h.update(right);
    h.finalize().into()
}

fn next_level(level: &[Hash]) -> Vec<Hash> {
    level
        .chunks(2)
        .map(|pair| if pair.len() == 2 { node_hash(&pair[0], &pair[1]) } else { pair[0] })
        .collect()
}

pub fn root(leaves: &[Hash]) -> Hash {
    if leaves.is_empty() {
        return [0u8; 32];
    }
    let mut level = leaves.to_vec();
    while level.len() > 1 {
        level = next_level(&level);
    }
    level[0]
}

/// One step of a proof: the sibling hash, and whether it sits on the left.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Step {
    #[serde(with = "hex_hash")]
    pub sibling: Hash,
    pub left: bool,
}

pub fn proof(leaves: &[Hash], index: usize) -> Vec<Step> {
    let mut steps = Vec::new();
    let mut level = leaves.to_vec();
    let mut i = index;
    while level.len() > 1 {
        let sibling = i ^ 1;
        if sibling < level.len() {
            steps.push(Step { sibling: level[sibling], left: sibling < i });
        }
        level = next_level(&level);
        i /= 2;
    }
    steps
}

pub fn verify(leaf: &Hash, steps: &[Step], expected_root: &Hash) -> bool {
    let mut acc = *leaf;
    for s in steps {
        acc = if s.left { node_hash(&s.sibling, &acc) } else { node_hash(&acc, &s.sibling) };
    }
    &acc == expected_root
}

mod hex_hash {
    use serde::{Deserialize, Deserializer, Serializer};

    pub fn serialize<S: Serializer>(h: &[u8; 32], s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&hex::encode(h))
    }

    pub fn deserialize<'de, D: Deserializer<'de>>(d: D) -> Result<[u8; 32], D::Error> {
        let s = String::deserialize(d)?;
        let mut out = [0u8; 32];
        hex::decode_to_slice(&s, &mut out).map_err(serde::de::Error::custom)?;
        Ok(out)
    }
}
