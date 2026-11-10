# 第三天：把 ME ID 接進登記流程（2026-11-11）

線上網址：**https://wage-proof.vercel.app/**（合約沒改、沒重新部署，仍是 `0x07C06de8D0D593E45Fa4f16bF4B7D82d96D723E0`）

## 做了什麼

1. **登記前查雇主是不是真人**：`POST /api/demo` 的 `submit` 多一個參數 `employer`，只能是 `verified` 或 `unverified`（不給就當 `verified`；給別的值、或直接給地址，一律 HTTP 400）。伺服器送交易前，先到 ME 測試網 Hub 查雇主的 ME ID 等級：
   - 等級低於 `minEmployerLevel`（設定在 `api/_lib.mjs`，預設 `one`）→ HTTP 403 `employer_not_verified`，**不送交易**，回應附上當下查到的原始等級（例如 `DID not found`）與查詢網址。
   - 查詢失敗（Hub 連不上、回非預期內容）→ HTTP 503 `meid_lookup_failed`，**也不送交易**。查不到不等於「沒有」，也不等於「有」。
   - 達到等級 → 照原流程模擬、送出，回應裡的 `meId` 帶雙方（雇主、勞工）當下的等級。
2. **查等級的函式** `meIdLevel()`（`api/_lib.mjs`）：輸入 0x 或 me1 地址，輸出 `none／one／two`、DID、狀態、查詢網址；成功結果快取 30 秒，失敗不快取。
3. **兩個可選的雇主**（寫死在伺服器）：
   - `verified`：現在的示範雇主 `0xBdC0C26d93153628c9340A2Bd1D586b90D020C03`（地址由伺服器的簽名金鑰算出）。
   - `unverified`：`0xDdC934222D73b4Fdc1dA6e655dd857Ce5d2C58fa`（`me1mhyngg3dww60msw6dej4mkzheewjck86450e7g`）。用程式隨機產生後只留地址，**私鑰沒有存在任何地方**；11-11 查過 Hub 回 `DID not found`。
4. **網頁**：
   - 每筆鏈上紀錄的勞工、雇主旁邊顯示等級字樣（進階驗證 Advanced／真人驗證 Real-person／未驗證 None／查詢失敗），瀏覽器直接查 Hub REST，旁邊附「在鏈上查證」。
   - 勞工登記區多了「3 指定雇主」：示範雇主（已進階驗證）／未驗證的地址（示範被擋下）。被擋時登記按鈕下方出現紅框，寫明規則、查到的等級、節點原始回應、查詢網址，以及「沒有產生任何交易」。
   - 頁首加一段白話說明為什麼要查真人，頂端黑條註明測試網 ME ID 是模擬身分。
   - 「真人驗證查詢」框保留，改用同一套字樣，也接受 0x 地址。

## 規則放在哪一層，為什麼

| 規則 | 放在哪 | 原因 |
|---|---|---|
| 誰能確認／異議、期限、逾期、狀態只能前進 | **合約**（`contracts/WageProof.sol`，沒改） | 鏈上可強制，伺服器只先模擬，合約拒絕就不送 |
| 雇主必須有 ME ID 且等級夠 | **伺服器**（`api/demo.mjs`，讀鏈上 Hub 資料） | 這條鏈的 EVM 合約讀不到身分模組，見下 |

**這條鏈的 EVM 合約讀不到身分模組，所以真人檢查放在伺服器端讀鏈上資料；確認／異議／逾期的規則仍由合約把關。**

查證（`docs/evidence/online-meid-evm-precompile.txt`）：
- ME Hub（`openmetaearth/me-hub`，11-10 最新提交）建立 EVM 時，自訂預編譯合約的參數傳 `nil`，用預設的 `geth.NewEVM`。
- 它用的 ethermint 分支裡 `GetPrecompiles` 只回以太坊標準預編譯（Berlin／Istanbul 等那一組）。
- DID 查詢有開放給 **CosmWasm** 合約（`wasm_me_query.go` 白名單裡有 `/metaearth.did.Query/Did`），但不是給 EVM。docs.mec.me 也沒有寫 EVM 讀身分的接口。
- 所以若以後要「合約本身擋」，路線是改寫成 CosmWasm 合約，不在這次範圍。

## 等級對應的依據

| Hub 回的 `kycLevel` | 網頁字樣 | 依據 |
|---|---|---|
| `KYC_LEVEL_TWO` | 進階驗證 Advanced | 官方水龍頭頁申請「Testnet ME ID」的 Advanced Verification，結果是這個值（示範雇主） |
| `KYC_LEVEL_ONE` | 真人驗證 Real-person | 同頁申請 Real-Person Verification 的結果（示範勞工，11-11 00:20 還查不到，同日稍後實作時已查到 `KYC_LEVEL_ONE`） |
| 查不到（HTTP 500＋`DID not found`） | 未驗證 None | 節點原文 |
| 其他值，或 DID 狀態不是 `DID_STATUS_ACTIVE` | 未驗證 None（保守處理） | 沒有文件可依，不往高處猜 |
| 連不上、HTTP 其他錯誤、內容看不懂 | 查詢失敗 | 不當成有或沒有 |

查詢網址：`https://beta-hub-1317.explorer-testnet.me/metaearth/did/did?address=<me1 地址>`。0x 地址轉 me1 用同樣 20 位元組做 bech32（前綴 `me`），已和 Hub 上兩個示範帳號的 me1 地址比對一致（`docs/evidence/online-meid-local-levels.txt`）。

**測試網的 ME ID 是官方提供的模擬身分**（官方頁註明只用於模擬業務邏輯，不涉及真實法律身分驗證）。這個示範證明的是「流程接得上」，不是「雇主的法律身分已確認」。

## 實測（證據）

| 檢查 | 結果 | 檔案 |
|---|---|---|
| 本機：有 ME ID（雇主 two、勞工 one）、沒有（none）、30 秒內第二次走快取 | 通過 | `docs/evidence/online-meid-local-levels.txt` |
| 本機：上游失敗三種（連不上、502 HTML、500 但不是 DID not found） | 都回 `meid_lookup_failed`，沒有當成有或沒有 | 同上 |
| 本機：雇主參數亂填、直接給地址 → 400；選 unverified → 403 不送 | 通過 | `docs/evidence/online-meid-local-gate.txt` |
| 線上：選 unverified | HTTP 403 `employer_not_verified`，`recordCount` 8 → 8 | `docs/evidence/online-meid-online.txt` |
| 線上：雇主參數 `boss`、地址、數字 1 | 三個都 HTTP 400，`recordCount` 仍 8 | 同上 |
| 線上：選 verified | HTTP 200，紀錄 #9 Pending，回應帶雇主 `KYC_LEVEL_TWO`、勞工 `KYC_LEVEL_ONE`，`recordCount` 8 → 9 | 同上 |
| 線上網頁：等級字樣、指定雇主選項、說明文字、查詢框、390 寬不破版 | 通過（只讀頁面文字） | `docs/evidence/online-meid-ui.txt` |

重跑：`bash scripts/check-online-meid.sh`（會真的登記一筆 1 小時期限的紀錄）。

## 已知限制

1. **檢查在伺服器，不在合約**：有人自己拿錢包直接呼叫合約 `submit`，可以指定任何雇主地址，不經過這道檢查。線上示範的寫入全部走伺服器，所以示範裡擋得住；真實上線要嘛改用 CosmWasm 讓合約自己查，要嘛把「沒有 ME ID 的雇主」在讀取端標示出來（網頁已經在每筆紀錄旁邊標）。
2. **只在登記那一刻查**：雇主之後的 ME ID 狀態改變，不會回頭改舊紀錄；網頁上的字樣是「現在」查到的，不是登記當下的。登記當下的等級在 API 回應裡，沒有寫上鏈。
3. **測試網身分是模擬的**，兩個示範帳號的 ME ID 都是從官方水龍頭頁申請的測試身分。另外：Hub 回的兩筆 DID 資料 `pubkey` 欄位相同，表示兩個身分是同一把公鑰申請的；這是示範帳號的情況，不影響規則判斷，但不能拿來說「兩個不同的真人」。
4. **快取 30 秒、在記憶體**：同一個執行個體內 30 秒內重複查同一地址不打 Hub；冷啟動就清空。
5. 勞工的等級只顯示、不擋（題目要求只擋雇主）。
6. 網頁上「選未驗證地址按登記」的紅框，助手沒有在瀏覽器實際按（工作區的送出保護會擋寫入按鈕）；同一個 API 回應已用 curl 驗證。請人工點一次。
