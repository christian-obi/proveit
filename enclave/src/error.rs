use serde::Serialize;
use std::fmt;

/// Stable error codes. The web app shows a message per code, so never rename one.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum Code {
    BadInput,
    SigInvalid,
    SigExpired,
    NearAccountMismatch,
    TooFewTrades,
    WindowTooShort,
    AccountTooNew,
    FillCapExceeded,
    NoData,
    Upstream,
    /// No reveal data for this card (unknown, or issued before reveals existed).
    CardNotFound,
    /// The follower holds no live viewing key for this card.
    NoGrant,
    /// Even the widest return bucket is shared by too few leaderboard accounts.
    PrivacyRisk,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Error {
    pub code: Code,
    pub message: String,
}

impl Error {
    pub fn new(code: Code, message: impl Into<String>) -> Self {
        Self { code, message: message.into() }
    }
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{:?}: {}", self.code, self.message)
    }
}

impl std::error::Error for Error {}

pub type Result<T> = std::result::Result<T, Error>;
