# 第五天：CosmWasm 正式合約，合約自己查雇主 ME ID（2026-11-16）

## 結論

**合約自己擋下沒有 ME ID 的雇主，這件事已經在測試網上跑出來了。**

- 單元測試 22 項全過（新合約 18 項＋沿用的查身分 4 項）：`docs/evidence/cw-c-unit-test.txt`
- 合約已上傳並建立：code id **21**，地址 `me1kwhfggqzzjy3vnyvldymrrrmjcvxe8ajzlerhx3putherrht2xqsgfpjqc`
- 測試網 e2e：11 項檢查全照預期（`docs/evidence/cw-c-e2e.txt`）
  - (1) 雇主沒有 ME ID → 合約拒絕，鏈上留下失敗交易
  - (2) 雇主是等級 two → 登記成功，紀錄裡存了雇主 two、勞工 none
  - (3) 30 秒期限：時間到之前不能標記逾期；時間到了，任何人都能標記
  - (4) 新的示範雇主目前還沒有 ME ID，指定它也被拒絕；完整流程等它有身分再跑 `--full`

測試網節點在 11-16 已升級到 `v2.0.18`，第四天卡住的「合約查不到身分」已經解了。

## 每一關結果

| 關 | 結果 | 證據 |
|---|---|---|
| 單元測試 | 22 passed, 0 failed | `docs/evidence/cw-c-unit-test.txt:30` |
| 編譯 | 192,970 bytes；匯出 `execute`、`requires_stargate`；沒有浮點數指令 | `cw/artifacts/checksums.txt` |
| 上傳＋建立 | code id 21；上傳費 219,524 umec，建立費 10,000 umec | `docs/evidence/cw-c-deploy.txt`、`deployments/cw-testnet.json` |
| (1) 雇主 `me1mhyn…0e7g`（沒有 ME ID） | 被拒：`EmployerNotVerified: … ME ID level none is below required one (source not_found)`；交易 `95F15D92…9939E` code 5；筆數 0 → 0 | `cw-c-e2e.txt:13-21` |
| (2) 雇主 `me1hhqv…gwyf`（等級 two） | 成功 #1；紀錄 `employer_level=two`、`worker_level=none` | `cw-c-e2e.txt:26-31` |
| (3a) 期限前標記逾期 | 被拒 `DeadlineNotPassed` | `cw-c-e2e.txt:38-43` |
| (3b) 勞工想代雇主確認 | 被拒 `NotEmployer` | `cw-c-e2e.txt:44-49` |
| (3) 逾期但還沒人標記 | `effective_status` 回 expired，紀錄本身仍是 pending | `cw-c-e2e.txt:52-55` |
| (3c) 第三方（主錢包）標記逾期 | 成功，事件 `caller=` 主錢包 | `cw-c-e2e.txt:56-59` |
| (3d) 再標記一次 | 被拒 `NotPending` | `cw-c-e2e.txt:60-65` |
| (3e)(3f) 逾期後勞工想異議、不存在的編號 | 被拒 `NotEmployer`、`NoSuchRecord` | `cw-c-e2e.txt:66-77` |
| (4) 新示範雇主 `me1lds7…rd5` | 目前 `level none`、`not_found`；指定它當雇主被拒 `EmployerNotVerified` | `cw-c-e2e.txt:82-89` |
| `--full` | 先查等級，還是 none 就停下、不送任何交易 | `docs/evidence/cw-c-e2e-full.txt` |

每筆交易的雜湊和 REST 網址（`https://beta-hub-1317.explorer-testnet.me/cosmos/tx/v1beta1/txs/<雜湊>`）都在 `cw-c-e2e.txt` 裡。被拒的交易是故意不經過模擬、直接送上鏈，所以鏈上查得到失敗原因；同一筆在模擬時的錯誤也一起存了。

**(3) 有一件事鏈上證明不了**：舊示範雇主 `me1hhqv…` 是以太坊格式的鑰匙，不能用來簽 Cosmos 交易，所以「雇主逾期後再回應被拒」只能由單元測試 `s07` 證明。(3b)(3e) 被拒的原因是「不是雇主」，不是逾期。這一條會在 `--full` 的 (F5) 由新示範雇主實跑。

## 規則對照（Solidity 版 → CosmWasm 版）

| 規則 | Solidity（`contracts/WageProof.sol`） | CosmWasm（`cw/wage-proof-cw/src/lib.rs`） | 單元測試 |
|---|---|---|---|
| 只存指紋、地址、時間、狀態 | `bytes32` | 64 位十六進位字串（驗格式、轉小寫、全零拒絕）；另存雙方等級 | s01、s02、m08 |
| 雇主不能是零地址或自己 | `BadEmployer` | `BadEmployer`（地址格式也驗） | s02 |
| 期限 30 秒到 90 天 | `BadWindow` | `BadWindow` | s02 |
| 雇主期限內確認 | `confirm` | `confirm` | s03 |
| 雇主異議，附理由指紋 | `dispute` | `dispute`（理由也驗格式） | s04 |
| 只有指定雇主能回應 | `NotEmployer` | `NotEmployer` | s05 |
| 同一筆不能處理兩次 | `NotPending` | `NotPending` | s06 |
| 逾期後不能回應；任何人可標記逾期 | `DeadlinePassed`、`markExpired` | 同名 | s07 |
| 期限當秒仍可回應 | `now > deadline` 才算逾期 | 同 | s08 |
| 未知編號被拒 | `NoSuchRecord` | `NoSuchRecord` | s09 |
| 同一份報告可重複登記並列出 | `idsForReport` | `records_for_report`（大小寫視為同一份） | s10 |
| 逾期未標記時的讀法 | `effectiveStatus` | `effective_status` | s07 |
| **雇主要有 ME ID** | 不在合約裡，由伺服器先查 | **合約登記時自己查**，不到最低等級就拒絕，錯誤帶查到的等級 | m01、m05 |
| **查詢上游失敗** | — | 拒絕，回 `MeIdLookupFailed`，絕不當成已驗證 | m02、m03 |
| **登記當下雙方等級** | — | 存進紀錄與事件（勞工沒有 ME ID 記 none） | m04 |
| 列最新幾筆 | — | `list`：新到舊，`start_after` 表示「編號比它小的」，預設 10 筆、上限 30 | m07 |
| 查身分 | — | `me_id`：two／one／none／上游失敗四種 | m06 |

錯誤代碼都放在訊息開頭（例如 `EmployerNotVerified:`、`MeIdLookupFailed:`），網頁和腳本用它分辨是哪一種拒絕。

## 誰能升級合約

**沒有人。** 建立時 admin 留空（`deployments/cw-testnet.json` 的 `"admin": ""`，`cw-c-deploy.txt` 的 contract info 也沒有 admin），合約也沒寫 migrate 入口。存證合約不能被改，別人才比較敢相信裡面的紀錄。要改規則就重新上傳、建立新地址，舊紀錄留在舊地址。最低等級 one 是建立時寫死的，同樣不能改。

## 已知限制

1. 新示範雇主 `me1lds7…rd5`、勞工 `me1waez…gwnl` 目前都沒有 ME ID。完整的「登記→確認、登記→異議、勞工代按被拒、重複處理被拒、逾期後雇主回應被拒」要等雇主那個帳號申請到身分後，跑：
   ```
   node scripts/cw-e2e.mjs --full
   ```
   結果寫到 `docs/evidence/cw-c-e2e-full.txt`。
2. 測試網的 ME ID 是官方的模擬身分，不是真人。
3. 合約只認 `DID_STATUS_ACTIVE` 的身分；停用的身分算 none。
4. `records_for_report` 不分頁，同一份報告登記非常多次時回傳會變長。
5. 合約只存指紋，報告本身在鏈外，比對要靠同一份檔案重算雜湊。

## 還沒做的事

1. **把線上示範接到新合約**：https://wage-proof.vercel.app/ 目前還是 Solidity 版（EVM `0x07C06de8…D723E0`）。這次沒動 `api/`、`web/`，也沒部署 Vercel。
2. 新示範雇主有 ME ID 之後跑 `--full`。

## 檔案

- `cw/wage-proof-cw/src/lib.rs`：動作、查詢、規則
- `cw/wage-proof-cw/src/state.rs`：存法（不多裝套件，直接用合約內建的鍵值存取）
- `cw/wage-proof-cw/src/meid.rs`：查 ME ID（第四天的探路程式，沒改）
- `cw/wage-proof-cw/src/tests.rs`：單元測試，用假的查詢器模擬 two／one／none／上游失敗
- `scripts/cw-deploy.mjs`：上傳＋建立（已部署就不會再傳）
- `scripts/cw-e2e.mjs`：測試網實跑（預設跑 (1)～(4)；`--full` 跑新示範雇主完整流程）

上鏈花費：主錢包 79,790,032 → 79,560,508 umec（部署）；勞工示範帳號 10,000,000 → 9,940,000 umec（6 筆交易）。

## 2026-11-16 晚：線上示範改接 CosmWasm 合約

- 水龍頭的 Testnet ME ID 服務從 2026-11-13 02:21 UTC（高度 5291381，最後一筆 `/metaearth.kyc.MsgApprove`）之後沒有再上鏈；`/faucet/kyc/auth` 收件回 200，但 `/faucet/kyc/info` 一直是 `UNVERIFIED_AUTH`。新產生的 Cosmos 金鑰雇主因此拿不到模擬身分。
- 繞法：`api/_cw.mjs` 的 `connectEthKey` 讓舊示範雇主（EVM 金鑰、KYC_LEVEL_TWO）用 ethsecp256k1 簽 Cosmos 交易（簽 keccak256(signBytes)，pubkey 型別 `/ethermint.crypto.v1.ethsecp256k1.PubKey`）。`cw-e2e --full` 4 PASS 0 UNEXPECTED（`docs/evidence/cw-c-e2e-full.txt`）。
- 線上示範 `https://wage-proof.vercel.app/` 改接 CosmWasm 合約：雇主 ME ID 規則由合約自己查、自己拒絕（`EmployerNotVerified`），伺服器只在節點上模擬，合約拒絕就不送。網頁直接從 Hub REST 讀合約（list／effective_status／me_id）與交易（依 `wasm.id` 事件查）。
- Vercel 的函式載入器不能 `require()` CosmJS 依賴的純 ESM `@noble/hashes`（ERR_REQUIRE_ESM），所以 `scripts/bundle-api.mjs` 用 esbuild 把 `api/_cw.mjs` 打包成 `api/_cwbundle.mjs`（已提交；改 `_cw.mjs` 後要重跑）。
- Vercel 新增環境變數 `DEMO_CW_WORKER_MNEMONIC`（敏感，從 `.env.demo` 以管線餵入）。示範勞工由部署帳號補 0.5 測試 MEC（tx 74A140E8…6D4D）。
- 線上實測（他的 Chrome，2026-11-16 18:46～18:49）：選未驗證雇主→合約拒絕、不產生紀錄；已驗證雇主登記 #13（30 秒）→逾期→記為逾期成功；登記 #14（1 小時）→切雇主→確認成功。
- EVM 版合約 `0x07C0…23E0` 仍在鏈上；退回 EVM 版示範＝重新部署 commit 7b7ccd6 的版本（`api/demo.mjs`、`web/app.js`）。
