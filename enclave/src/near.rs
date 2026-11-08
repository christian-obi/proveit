//! Reads from NEAR over JSON-RPC, for checks the enclave makes itself over HTTPS: is this
//! public key a full-access key of that account, and does it hold a viewing key.

use crate::error::{Code, Error, Result};
use base64::Engine;
use serde_json::{json, Value};

pub trait Http {
    fn post(&self, url: &str, body: &Value) -> Result<Vec<u8>>;
}

pub trait Near {
    fn view(&self, contract: &str, method: &str, args: &Value) -> Result<Value>;
    /// `Some(true)` full access, `Some(false)` a function-call key, `None` no such key.
    fn access_key(&self, account: &str, public_key: &str) -> Result<Option<bool>>;
}

/// The public RPC for the network the registry lives on.
pub fn rpc_url(registry: &str) -> &'static str {
    if registry.ends_with(".testnet") {
        "https://rpc.testnet.fastnear.com"
    } else {
        "https://rpc.mainnet.fastnear.com"
    }
}

pub struct Rpc<H: Http> {
    pub url: String,
    pub http: H,
}

impl<H: Http> Rpc<H> {
    fn query(&self, params: Value) -> Result<Value> {
        let body = json!({ "jsonrpc": "2.0", "id": "proveit", "method": "query", "params": params });
        let v: Value = serde_json::from_slice(&self.http.post(&self.url, &body)?).map_err(|e| Error::new(Code::Upstream, format!("NEAR RPC: {e}")))?;
        if let Some(e) = v.get("error") {
            return Err(Error::new(Code::Upstream, format!("NEAR RPC: {e}")));
        }
        Ok(v["result"].clone())
    }
}

impl<H: Http> Near for Rpc<H> {
    fn view(&self, contract: &str, method: &str, args: &Value) -> Result<Value> {
        let r = self.query(json!({
            "request_type": "call_function", "finality": "final", "account_id": contract, "method_name": method,
            "args_base64": base64::engine::general_purpose::STANDARD.encode(args.to_string()),
        }))?;
        if let Some(e) = r.get("error") {
            return Err(Error::new(Code::Upstream, format!("{contract}.{method}: {e}")));
        }
        let bytes: Vec<u8> = serde_json::from_value(r["result"].clone()).map_err(|e| Error::new(Code::Upstream, e.to_string()))?;
        serde_json::from_slice(&bytes).map_err(|e| Error::new(Code::Upstream, format!("{contract}.{method}: {e}")))
    }

    fn access_key(&self, account: &str, public_key: &str) -> Result<Option<bool>> {
        let r = self.query(json!({ "request_type": "view_access_key", "finality": "final", "account_id": account, "public_key": public_key }));
        match r {
            // An unknown key (or account) comes back as a query error.
            Err(e) if e.message.contains("UNKNOWN_ACCESS_KEY") || e.message.contains("does not exist") || e.message.contains("UNKNOWN_ACCOUNT") => Ok(None),
            Err(e) => Err(e),
            Ok(v) if v.get("error").is_some() => Ok(None),
            Ok(v) => Ok(Some(v["permission"] == "FullAccess")),
        }
    }
}
