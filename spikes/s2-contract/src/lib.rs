//! P0 spike contract: starts OutLayer runs of the S2 spike project and records what
//! comes back, so we can see (S2) which key a contract-started run gets, (S3) whether
//! the signer's encrypted secret reaches the enclave, and (S5) output size, latency
//! and gas through the callback.

use near_sdk::serde_json::{self, json};
use near_sdk::{env, near, require, AccountId, Gas, GasWeight, NearToken, PanicOnDefault, Promise};

const CALLBACK_GAS: Gas = Gas::from_tgas(15);
/// A floor for OutLayer; with GasWeight(1) it also receives all gas left unreserved.
const OUTLAYER_MIN_GAS: Gas = Gas::from_tgas(50);
const MIN_DEPOSIT: NearToken = NearToken::from_millinear(10);
const OUTPUT_HEAD_CHARS: usize = 400;
/// S5 asks for at most 16 KB; anything larger is recorded as a failure, not read.
const MAX_RESULT_BYTES: usize = 64 * 1024;

#[near(serializers = [json, borsh])]
#[derive(Clone)]
pub struct Run {
    pub id: u64,
    pub input: String,
    pub signer: AccountId,
    pub started_block: u64,
    pub finished_block: Option<u64>,
    pub ok: Option<bool>,
    pub output_len: Option<u32>,
    pub output_head: Option<String>,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    outlayer: AccountId,
    project_id: String,
    runs: Vec<Run>,
}

#[near]
impl Contract {
    #[init]
    pub fn new(outlayer: AccountId, project_id: String) -> Self {
        Self { outlayer, project_id, runs: Vec::new() }
    }

    /// Start one OutLayer run with `input` as stdin. `secrets_profile` references the
    /// signer's own stored secrets; `version_key` pins a project version.
    #[payable]
    pub fn run(
        &mut self,
        input: String,
        version_key: Option<String>,
        secrets_profile: Option<String>,
        max_memory_mb: Option<u32>,
    ) -> Promise {
        require!(env::attached_deposit() >= MIN_DEPOSIT, "attach at least 0.01 NEAR");
        let signer = env::signer_account_id();
        let id = self.runs.len() as u64;
        self.runs.push(Run {
            id,
            input: input.clone(),
            signer: signer.clone(),
            started_block: env::block_height(),
            finished_block: None,
            ok: None,
            output_len: None,
            output_head: None,
        });

        // resource_limits must be present: without it OutLayer treats the request as compile-only.
        let args = json!({
            "source": { "Project": { "project_id": self.project_id, "version_key": version_key } },
            "resource_limits": {
                "max_instructions": 10_000_000_000u64,
                "max_memory_mb": max_memory_mb.unwrap_or(256),
                "max_execution_seconds": 60
            },
            "input_data": input,
            "secrets_ref": secrets_profile.map(|profile| json!({ "profile": profile, "account_id": signer })),
            "response_format": "Json",
            "payer_account_id": signer,
            "params": null
        });

        Promise::new(self.outlayer.clone())
            .function_call_weight(
                "request_execution".to_string(),
                serde_json::to_vec(&args).unwrap(),
                env::attached_deposit(),
                OUTLAYER_MIN_GAS,
                GasWeight(1),
            )
            .then(Self::ext(env::current_account_id()).with_static_gas(CALLBACK_GAS).on_result(id))
    }

    #[private]
    pub fn on_result(&mut self, id: u64) {
        let run = self.runs.get_mut(id as usize).expect("unknown run");
        run.finished_block = Some(env::block_height());
        match env::promise_result_checked(0, MAX_RESULT_BYTES) {
            Ok(bytes) => {
                let text = String::from_utf8_lossy(&bytes).to_string();
                run.ok = Some(text != "null");
                run.output_len = Some(bytes.len() as u32);
                run.output_head = Some(text.chars().take(OUTPUT_HEAD_CHARS).collect());
                env::log_str(&format!("run {id}: {} bytes", bytes.len()));
            }
            Err(e) => {
                run.ok = Some(false);
                env::log_str(&format!("run {id}: OutLayer call failed: {e:?}"));
            }
        }
    }

    pub fn get_run(&self, id: u64) -> Option<Run> {
        self.runs.get(id as usize).cloned()
    }

    pub fn get_runs(&self, from: Option<u64>, limit: Option<u64>) -> Vec<Run> {
        let from = from.unwrap_or(0) as usize;
        let limit = limit.unwrap_or(20) as usize;
        self.runs.iter().skip(from).take(limit).cloned().collect()
    }

    pub fn get_config(&self) -> (AccountId, String, u64) {
        (self.outlayer.clone(), self.project_id.clone(), self.runs.len() as u64)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::{accounts, VMContextBuilder};
    use near_sdk::testing_env;

    fn context(deposit: NearToken) -> VMContextBuilder {
        let mut b = VMContextBuilder::new();
        b.signer_account_id(accounts(1))
            .predecessor_account_id(accounts(1))
            .attached_deposit(deposit)
            .prepaid_gas(Gas::from_tgas(300));
        b
    }

    #[test]
    fn run_records_a_pending_entry() {
        testing_env!(context(MIN_DEPOSIT).build());
        let mut c = Contract::new("outlayer.testnet".parse().unwrap(), "me.testnet/spike".into());
        let _ = c.run(r#"{"op":"pubkey"}"#.into(), None, None, None);
        let run = c.get_run(0).unwrap();
        assert_eq!(run.signer, accounts(1));
        assert!(run.ok.is_none());
    }

    #[test]
    #[should_panic(expected = "attach at least 0.01 NEAR")]
    fn run_refuses_a_small_deposit() {
        testing_env!(context(NearToken::from_millinear(1)).build());
        let mut c = Contract::new("outlayer.testnet".parse().unwrap(), "me.testnet/spike".into());
        let _ = c.run("{}".into(), None, None, None);
    }
}
