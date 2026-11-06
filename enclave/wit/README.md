# OutLayer host interfaces

Copies of the worker's `worker/wit/deps/*.wit` from [out-layer/outlayer](https://github.com/out-layer/outlayer) at commit `aaf60a2` (21 Oct 2026). The enclave binary imports them through `wit-bindgen`; they exist only inside an OutLayer worker, which is why the live binary can't run under plain `wasmtime`.

| File | Used for |
|---|---|
| `signing-keys/signing-keys.wit` | the `cards` ed25519 key that signs every card |
| `encryption-keys/encryption-keys.wit` | the `commit` key whose MAC makes the account commitment |
| `storage/storage.wit` | encrypted worker storage holding each card's account, for reveals (P7) |

If OutLayer changes these interfaces, copy the new files and rebuild; the build hash changes with them.
