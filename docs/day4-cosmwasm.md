# 第四天：CosmWasm 版，讓合約自己查 ME ID（2026-11-11）

## 結論

**A 過、B 卡在鏈這一端、C 沒做。**

合約上傳、建立都成功（code id 13）。但合約一查身分，測試網節點就回 `Stargate queries are disabled`。原因不在我們的程式：開放身分查詢的程式碼 11-06 才合進 me-hub，測試網節點跑的還是 9 月的版本。照規定，前一關沒過就不做下一關，所以 C 的正式合約、上鏈實跑、兩個新示範帳號都沒做。線上示範與 Solidity 版沒動。

| 關 | 結果 | 證據 |
|---|---|---|
| A 工具鏈 | 過：rustc／cargo 1.78.0，目標 `wasm32-unknown-unknown`、`x86_64-pc-windows-gnu` | `docs/evidence/cw-a-toolchain.txt` |
| B 探路合約：編譯 | 過：141,797 bytes，匯出 `requires_stargate`，沒有浮點數指令 | `cw/artifacts/checksums.txt`（wasm 檔本身不進版控） |
| B 探路合約：上傳＋建立 | 過：code id 13，合約 `me1l6z44fupg8l5mapmuxnrnmvxyclw5wnh5f5hfrtkaq5r0d9s24msh063dt` | `docs/evidence/cw-b-probe.txt` |
| B 探路合約：查三個地址 | **失敗**：三個都回 `Stargate queries are disabled` | 同上 |
| B 單元測試（查詢格式、只有「DID not found」才算沒有、其他錯誤不當成有或沒有） | 4 項全過 | `docs/evidence/cw-b-unit-test.txt` |
| C 正式合約 | 沒做（B 沒過） | — |

## B 為什麼不通（鏈回的原文）

```
Query failed with (6): Generic error: ME ID lookup failed: system error: Unsupported query type: Stargate queries are disabled: query wasm contract failed: unknown request
```

這句是 wasmd 預設的「拒絕所有 Stargate 查詢」回的話，表示節點**根本沒有掛上** me-hub 的白名單。

| 查了什麼 | 結果 |
|---|---|
| 測試網節點版本（`/cosmos/base/tendermint/v1beta1/node_info`） | `v2.0.16-7-g99b3e42d`，commit `99b3e42`（2026-09-02） |
| 白名單是哪一筆加的 | `6ef90e3`（2026-11-06）「feat: provide the wasm-vm with interface to access and query KYC and regions. (#1491)」 |
| GitHub 比對 `99b3e42...6ef90e3` | ahead 5、behind 0：白名單比節點新 5 筆，節點沒包含 |
| 修法 1：改走 REST 的 smart query | 同一句錯誤 |
| 修法 2：換另一台公開節點（118.175.0.249） | 同版本 `99b3e42`，同一句錯誤 |

**歸類：不是 wasm 能力不符，也不是權限不夠**（上傳、建立都成功，上傳權限是 Everybody），是「白名單查詢在目前的測試網還沒上線」。合約本身不用改。等官方把測試網升級到包含 `6ef90e3` 的版本，重跑 `node scripts/cw-probe.mjs --reuse` 就知道通不通。

上鏈花費：上傳 169,968 umec、建立 10,000 umec，餘額 99,990,000 → 99,810,032 umec。

## 踩到的雷與實際用的正確做法

1. **官方文件的 Rust 指令有被取代過字**（選題研究 §5-②）：我沒照文件，直接用真名套件 `cosmwasm-std`、`cosmwasm-schema`（1.5.11）。文件寫的 `wasm-std`、`wasm/optimizer` 都沒用到；瘦身改用 npm 的 `binaryen`（`wasm-opt`），不用 Docker。
2. **Rust 1.78 讀不了新版套件的設定檔**：`zeroize 1.9.1`、`base64ct 1.8.3` 要求 `edition2024`，編譯直接失敗。解法是降版鎖住：`cargo update -p zeroize --precise 1.8.1`、`cargo update -p base64ct --precise 1.6.0`，結果寫在 `cw/Cargo.lock`，之後一律 `--locked`。
3. **wasmvm 1.4.1 只吃舊指令**：`wasm-opt -Oz --signext-lowering`，把 sign-ext 指令換回舊寫法。`cosmwasm-std` 關掉預設功能，只開 `iterator`、`stargate`（不開 `abort`，產物沒有它的 import）。
4. **gnu 工具鏈本身就夠用**：minimal profile 已附 mingw 連結器，不用裝 Visual Studio。
5. **手續費下限**：建立合約模擬約 36 萬 gas，乘 0.02 只有約 7,200 umec，低於節點下限 10,000，所以程式取兩者大的那個（`scripts/cw-lib.mjs` 的 `feeFor`）。
6. **節點回「查不到」的寫法**：REST 是 `codespace did code 111: DID not found`；合約內查詢錯誤會被 wasmd 縮成 `codespace: did, code: 111`。合約兩種都認，只有這兩種算「沒有 ME ID」，其他錯誤一律回 `ME ID lookup failed: ...`，不當成有也不當成沒有。這一點在真鏈上還沒驗到，因為查詢根本沒送進身分模組。

## 檔案

- `scripts/rustenv.sh`、`scripts/rustenv.ps1`：設定 `RUSTUP_HOME`、`CARGO_HOME`、工具鏈版本，只影響當下的終端機。
- `scripts/cw-build.sh`：編譯、`wasm-opt` 瘦身、寫 `cw/artifacts/checksums.txt`。
- `scripts/cw-lib.mjs`：連線、算手續費、上傳＋建立（私鑰只從 `.env` 讀，不印）。
- `scripts/cw-probe.mjs`：B 關（加 `--reuse` 不重新上傳，只重查）。
- `cw/wage-proof-cw/src/meid.rs`：查詢 ME ID 的程式。請求自己編 protobuf（`QueryDid { string address = 1; }`）。回應兩種都讀：proto-JSON（wasmd 0.43 的格式），以及純 protobuf（以後換格式也能用）。欄位照 `me-hub/proto/metaearth/did/` 核對過（`docs/evidence/cw-b-proto.txt`）。
- `deployments/cw-testnet.json`：code id、合約地址、交易雜湊。

## 還沒做的事

1. **等測試網升級**：去官方開發者 Telegram 問測試網什麼時候升級到包含 `6ef90e3`（#1491）的版本。這要他本人決定要不要問，我沒聯絡任何人。升級後先重跑 B。
2. **C 正式合約**：B 通了才做。規則照 Solidity 版，另加「登記時合約自己查雇主等級，不到 one 就拒絕」，並把雙方當下的等級存進紀錄。`meid.rs` 可以直接沿用。
3. **兩個新的 Cosmos 示範帳號**（勞工、雇主）：C 上鏈時才建，所以還沒產生、沒轉帳。`.env.demo` 裡現有的 `DEMO_WORKER_KEY`、`DEMO_EMPLOYER_KEY` 是線上示範用的 EVM 金鑰，沒有動。
4. **接上線上示範**：要等 C 完成，這次沒碰 `api/`、`web/`，也沒部署 Vercel。

## 現在的分工

- **Solidity 版**（`contracts/WageProof.sol`，EVM `0x07C06de8…D723E0`）：線上示範用的就是它。「雇主要有 ME ID」這條規則跑在我們的伺服器上。
- **CosmWasm 探路合約**（code id 13）：只用來證明合約能不能自己查 ME ID。目前卡在測試網版本。
