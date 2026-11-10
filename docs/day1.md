# 第一天紀錄（2026-11-10）

## 結論

第 0～4 關過了，第 6 關（本機網頁殼）做了；第 5 關的部署與 memo 腳本已寫好，實際執行到「查餘額＝0」就停下，**沒有送出任何交易**，等他本人去水龍頭領幣。

| 關 | 結果 | 證據 |
|---|---|---|
| 0 開專案 | 過 | git init、`LICENSE`（MIT）、`README.md` 開頭註明 11-10 起新寫、`.gitignore` 擋 `.env`／`node_modules`；gitleaks 掃描見下 |
| 1 測試錢包 | 過 | `scripts/wallet.mjs`；助記詞只在 `.env`；公開地址在 `config/wallet.public.json` |
| 2 連線檢查 | 過（9 項中 8 項通，失敗那項是我猜的 https EVM 網址，不存在） | `docs/evidence/endpoints-check.json`；端點集中在 `config/network.json` |
| 3 ME ID 只讀 | 過（查得到、查不到各一份原始回應） | `docs/evidence/meid-found.json`、`meid-not-found.json`、`meid-not-found-evm.json` |
| 4 合約＋本機測試 | 過，10 passing／0 failing | `docs/evidence/hardhat-test.txt`；本機端到端 `docs/evidence/e2e-local.txt` |
| 5 部署／memo 腳本 | 腳本寫好；**停在等領幣** | `docs/evidence/deploy-testnet-zero-balance.txt`、`memo-tx-zero-balance.txt`（兩者都 exit code 3、Nothing sent） |
| 6 網頁殼 | 做了，只連本機鏈 | `web/index.html`、`web/app.js`；頁首、資料卡、頁尾三處「示範用合成資料 Synthetic demo data」 |

## 1. 測試錢包：為什麼有三個字串

同一組助記詞推出兩個帳號，這跟官方 JS SDK 的設計一致（主帳號＋綁定的 ETH 子帳號，見 SDK `src/api/identity.ts` 的 `bindSubAccount`／`getMeIdBySubAccount`）：

| 用途 | 地址 | 推導路徑 |
|---|---|---|
| 主帳號（Cosmos，送 memo 交易；**水龍頭填這個**） | `me1lpvn9zxaepduse7txy8fnek5tvmuyqzqz2t9rc` | m/44'/118'/0'/0/0，secp256k1 |
| EVM 帳號（部署合約） | `0x2B3f3d7e30D0CD237d78a3A8a8d6fDD3D3a6d3f2` | m/44'/60'/0'/0/0 |
| 上面 EVM 帳號的 me1 寫法（同 20 bytes） | `me19vln6l3s6rxjxltc5w5234ha60f6d5ljvj9ufm` | — |

領幣後的順序：水龍頭給主帳號 → `npm run memo -- --yes` 送 1 umec 給 EVM 帳號的 me1 寫法，備註帶報告指紋（同時完成「保底上鏈」與「EVM 帳號拿到手續費」）→ `npm run deploy:testnet`。注意 1 umec 不夠部署，實際要用 `--amount` 多轉一些（部署估計用 gas 約 73.5 萬，以本機數字估）。

依據：測試網帳號是 `/cosmos.auth.v1beta1.BaseAccount`，交易簽章用 `/cosmos.crypto.secp256k1.PubKey`（11-10 讀一筆 bank 交易確認），所以 CosmJS 標準簽法可用。

## 2. 連線檢查（只讀，11-10 23:26 台灣時間）

`node scripts/check-endpoints.mjs` 輸出最後幾行：
```
OK   EVM eth_chainId (479ms) {"url":"http://118.175.0.249:8545","chainIdHex":"0x190","chainId":400}
OK   EVM CORS header (simulated Origin) (237ms) {"accessControlAllowOrigin":"*"}
FAIL EVM https candidate https://beta-hub-8545.explorer-testnet.me (617ms) {"error":"ENOTFOUND"}
OK   hub REST CORS header (171ms) {"accessControlAllowOrigin":"*"}
8/9 checks ok
```
另查到：EVM `eth_getBalance` 顯示的數字＝鏈上 umec × 10^10（EVM 用 18 位小數，umec 是 10^8），`evm_denom` 是 `umec`、`enable_create: true`，原始參數存在 `docs/evidence/evm-params.json`。

## 3. ME ID 查詢：跟文件不一樣的地方

- 查不到時節點回 **HTTP 500**（不是 404），內容 `{"code":2,"message":"codespace did code 111: DID not found"}`。官方 SDK 也是靠比對這段文字判斷「沒有」。腳本照這個邏輯，其他錯誤一律拋出，不當成「沒有」。
- 查得到時回 `info.status: DID_STATUS_ACTIVE`、`info.kycLevel: KYC_LEVEL_ONE`。**`KYC_LEVEL_ONE` 是不是活動頁說的「高級認證」，查不到官方說明**，所以畫面只照實顯示等級，不寫成「已通過高級認證」。
- 用 0x 地址查時，腳本先轉成 me1 寫法查主帳號，再查 `QuerySubAccountDidResponse` 子帳號綁定；沒綁定時回 HTTP 500 `failed to get DID by sub-account`。
- 用來測「查得到」的地址 `me1ru7x…2f4dk` 是從測試網最新 bank 交易隨手撿的收款方，**是不認識的第三方**。公開倉庫前要決定是否把 `meid-found.json` 裡的 DID 編號遮掉。
- 列表類路徑（`/metaearth/did/dids` 等）都回 501 Not Implemented，沒辦法列出全部 ME ID。

## 4. 合約規則（全部由合約判斷）

`contracts/WageProof.sol`：
- `submit(reportHash, employer, deadlineSeconds)`：指紋不能是 0、雇主不能是 0 或自己、期限 30 秒～90 天。
- `confirm(id)`／`dispute(id, reasonHash)`：只有指定的雇主、只能在 Pending、期限那一秒（含）之前。
- `markExpired(id)`：任何人，期限過了才行，只能 Pending。
- `effectiveStatus(id)`：期限已過但還沒人呼叫 `markExpired` 的，讀起來就是 Expired。
- 編譯用 `evmVersion: "paris"`（不產生 PUSH0），避開鏈的 EVM 版本不確定的問題。

`npx hardhat test` 最後幾行：
```
    ✔ after the deadline the employer can no longer respond; anyone can mark it expired
    ✔ response exactly at the deadline second is still accepted
    ✔ unknown ids are rejected
    ✔ same report can be submitted again and both ids are listed
  10 passing (375ms)
```
本機端到端（`node scripts/e2e-local.mjs`，對 `npx hardhat node`）：確認、異議、勞工越權被拒（NotEmployer）、逾期後確認被拒（DeadlinePassed）、任何人記錄逾期，全部照規則。

## 5. 網頁殼

`npm run web` 只綁 127.0.0.1。我在內建瀏覽器實際看過：頁面讀得到示範報告，瀏覽器算出的指紋與 Node 算的一致（`0x1752775e…f9db`）；切換到雇主後「登記上鏈」變灰；ME ID 查詢從瀏覽器直接打測試網 REST 成功（CORS 開放），顯示「有 ME ID（DID_STATUS_ACTIVE，KYC_LEVEL_ONE）」。
**沒驗到的**：在瀏覽器裡實際按「登記上鏈／確認／異議」（工作區的送出關卡擋住這類點擊）。同樣的合約呼叫已用 `scripts/e2e-local.mjs` 跑過。

## 踩到的雷

1. `@cosmjs/encoding` 0.39 的 `fromBech32(addr)` 不給長度上限會丟 `RangeError: limit ... Infinity`，要寫 `fromBech32(addr, 90)`。
2. ethers v6 回傳的陣列是 `Result`，`assert.deepEqual` 要先展開成一般陣列。
3. 文件與 SDK 的 `CHAIN_ID` 寫 `me-chain`，測試網實際是 `mechain_400-1`；設定檔以鏈上為準。
4. 我猜的 https EVM 網址（`beta-hub-8545.explorer-testnet.me`）不存在。

## EVM 這條路在測試網上還沒驗證的風險

1. **RPC 是純 http＋裸 IP**（`http://118.175.0.249:8545`）：官方沒給網域與憑證，IP 換了就斷；中間人可改回應。部署腳本有先檢查 chainId＝400 才動作。
2. **瀏覽器不能直接連**：雖然 CORS 回 `*`，但網頁若放在 https 網址，瀏覽器會擋 http 請求（混合內容）。MetaMask 新版也只收 https 自訂網路。解法是自己架一個 https 轉接（例如 Vercel 函式），這要部署到公開網址，第一天沒做，要他同意。
3. **區塊瀏覽器看不看得到 EVM 合約與交易**：沒驗證。若 explorer-testnet.me 只顯示 Cosmos 交易，評審要的「ME 使用證據」只剩合約地址與 EVM 交易雜湊，要另外用 `eth_getTransactionReceipt` 或 REST `/cosmos/tx/v1beta1/txs/{hash}`（Ethermint 會把 EVM 交易包成 `MsgEthereumTx`）證明。
4. **鏈參數寫 shanghai／cancun 都在第 0 塊啟用**，但沒實際部署過，不知道真的支不支援；先用 paris 編譯避險。
5. **gas 價與 MEC 換算**：`eth_gasPrice` 回 7 wei，最低 gas 價 0.02 umec＝2×10^8 wei，兩者對不上，實際部署可能要手動設 gasPrice。沒驗證。
6. 勞工與雇主在測試網要是兩個不同地址（合約拒絕自己當雇主）。hardhat 設定已預留同一組助記詞的第 2 個 EVM 帳號當示範雇主，那個帳號也需要手續費。

## 如果 EVM 走不通，改走 CosmWasm 要他同意安裝的東西

- **Rust 工具鏈**（rustup，文件建議 1.75～1.80）＋ `wasm32-unknown-unknown` 目標：系統層級安裝。
- **Docker Desktop**（跑 `cosmwasm/optimizer` 產出可上鏈的精簡 wasm）：系統層級安裝。替代方案是用雲端編譯（GitHub Actions），那要建遠端倉庫，也要他同意。
- 合約函式庫要用 `cosmwasm-std` 1.4.x（鏈上 wasmvm 1.4.1），不能用 2.x。
- 上傳與呼叫用 CosmJS 的 `@cosmjs/cosmwasm-stargate`（專案內 npm 套件，不算系統安裝）；不需要編譯官方 Go CLI `med`。

## 下一步

1. **他本人**：到水龍頭（https://www.mec.me/en-US/faucet）用主帳號 `me1lpvn9zxaepduse7txy8fnek5tvmuyqzqz2t9rc` 領 2 MEC。
2. 領到後：`npm run memo -- --amount <數量> --yes` → 到瀏覽器與 REST 看得到交易 → `npm run deploy:testnet` → 在測試網跑一次完整流程（要給第 2 個 EVM 帳號一點手續費當雇主）。
3. 驗證區塊瀏覽器能不能顯示 EVM 合約；決定 https 轉接要不要做。
4. 網頁改成可切換「本機鏈／測試網」。
