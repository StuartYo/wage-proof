# 第二天：線上示範（2026-11-10 深夜～11-11）

線上網址：**https://wage-proof.vercel.app/**

評審一個人、不用裝錢包、不用領幣，就能在這個網址跑完「登記 → 雇主確認／異議 → 逾期記錄」。所有寫入都真的上 ME 測試網 EVM（鏈 ID 400）的同一個合約 `0x07C06de8D0D593E45Fa4f16bF4B7D82d96D723E0`，合約沒改、沒重新部署。

## 架構

```
瀏覽器（https://wage-proof.vercel.app，靜態頁 web/index.html + web/app.js）
  ├─ 讀鏈：POST /api/rpc   → Vercel 函式 → http://118.175.0.249:8545（ME 測試網 EVM RPC）
  ├─ 寫鏈：POST /api/demo  → Vercel 函式，用兩個示範帳號簽名 → 同上 RPC
  └─ ME ID 查詢：瀏覽器直接打 https://beta-hub-1317.explorer-testnet.me（Hub REST，開放跨站）
```

為什麼要中繼：EVM RPC 只有純 http＋裸 IP，https 網頁直接連會被瀏覽器擋（混合內容）。

- 靜態檔由 `scripts/build-public.mjs` 產生到 `public/`（只複製 5 個檔：首頁、app.js、兩份合成報告、ethers 瀏覽器版），並在複製後擋掉任何像私鑰的字串。
- `.vercelignore` 採白名單：只上傳 `api/ web/ demo/ scripts/ package*.json vercel.json`，`.env`、`.env.*` 另外再排除一次。
- 伺服器設定集中在 `api/_lib.mjs`（上游 RPC、鏈 ID、合約地址、gas 上限、頻率限制），呼叫端不能指定。

## `/api/rpc`：唯讀中繼

| 規則 | 值 |
|---|---|
| 放行方法 | `eth_chainId` `eth_blockNumber` `eth_call` `eth_getTransactionReceipt` `eth_getTransactionByHash` `eth_getLogs` `eth_getBlockByNumber` `eth_getCode` `eth_getBalance` |
| 其他方法（含 `eth_sendRawTransaction`、`eth_accounts`） | HTTP 403，整個請求拒絕 |
| `eth_getLogs` | 只准查本合約地址 |
| 請求大小 | 8 KB，超過 HTTP 413 |
| 批次 | 最多 10 筆，超過 HTTP 400 |

## `/api/demo`：伺服器代簽的示範動作

`GET` 回公開資訊（鏈 ID、合約、兩個示範地址、ABI、限制），不含任何金鑰。`POST` 只有四種：

| action | 參數 | 誰簽 |
|---|---|---|
| `submit` | `reportHash`（0x＋64 位十六進位）、`deadlineSeconds` 只能 30／60／3600 | 示範勞工 |
| `confirm` | `id` | 示範雇主 |
| `dispute` | `id`、`reasonHash`（理由在瀏覽器算成 SHA-256，鏈上只放指紋） | 示範雇主 |
| `markExpired` | `id` | 示範勞工（合約允許任何人） |

處理順序：檢查格式 → 頻率與每日上限 → 示範帳號餘額 → **先模擬呼叫合約**，合約拒絕就回 HTTP 409＋合約錯誤名（例如 `NotPending`、`DeadlinePassed`），不送交易 → 用寫死的 gas 上限送出 → 等出塊（最多 40 秒）→ 回交易雜湊、區塊、鏈上狀態、查證網址。

誰能確認或異議、期限、狀態轉換，全由合約判斷；伺服器不自己判斷對錯。查證網址是 Hub REST 用以太坊交易雜湊反查：
`https://beta-hub-1317.explorer-testnet.me/cosmos/tx/v1beta1/txs?events=ethereum_tx.ethereumTxHash='0x…'`

### 費用與濫用保護

| 項目 | 設定 |
|---|---|
| 每個來源 IP | 每分鐘最多 6 次寫入（第 7 次起 HTTP 429） |
| 全站每天 | 300 次寫入（UTC 日） |
| 餘額門檻 | 示範帳號低於 0.01 MEC 就回「示範額度用完」，不送出 |
| gas 上限（寫死） | submit 260000、confirm 90000、dispute 110000、markExpired 90000；maxFeePerGas 上限 1 gwei（測試網實際約 7 wei） |
| 請求大小 | 1 KB |

**限制照實說**：計數放在函式的記憶體裡，沒有持久化儲存。冷啟動會歸零；Vercel 同時開多個執行個體時，每個個體各算各的，所以實際上限可能是設定值的數倍。被拒的模擬呼叫也算一次寫入嘗試。

## 示範帳號

- 兩個全新的隨機帳號（勞工 `0xde555310fc573E5E9C5b8928a1E13913d28BaCe4`、雇主 `0xBdC0C26d93153628c9340A2Bd1D586b90D020C03`），只給線上示範用，各由部署帳號轉入 0.2 測試 MEC（`docs/evidence/online-demo-accounts-fund.txt`）。
- 私鑰只存在兩個地方：本機 `.env.demo`（被 `.gitignore` 擋掉）與 Vercel 的加密環境變數 `DEMO_WORKER_KEY`、`DEMO_EMPLOYER_KEY`（以管線從檔案餵給 `vercel env add --sensitive`，沒有經過螢幕）。原本的部署助記詞沒有放上 Vercel。
- 公開地址記在 `config/demo-accounts.public.json`。

**作廢重產**（任何時候都可以，只有測試幣）：

```bash
node scripts/demo-accounts.mjs --rotate          # 產生新的一對，覆蓋 .env.demo
node scripts/demo-accounts.mjs --fund 0.2        # 從部署帳號各轉 0.2 測試 MEC
vercel env rm DEMO_WORKER_KEY production -y
vercel env rm DEMO_EMPLOYER_KEY production -y
# 再用管線重新加入（不要把值印出來），例如：
node -e "process.stdout.write(require('fs').readFileSync('.env.demo','utf8').match(/^DEMO_WORKER_KEY=(\S+)/m)[1])" | vercel env add DEMO_WORKER_KEY production --sensitive
node -e "process.stdout.write(require('fs').readFileSync('.env.demo','utf8').match(/^DEMO_EMPLOYER_KEY=(\S+)/m)[1])" | vercel env add DEMO_EMPLOYER_KEY production --sensitive
vercel deploy --prod --yes
```

舊帳號剩下的測試幣不必收回。

## 線上實測（證據）

| 檢查 | 結果 | 檔案 |
|---|---|---|
| `eth_chainId` | `0x190` | `docs/evidence/online-rpc.txt` |
| `eth_sendRawTransaction`、`eth_accounts` | HTTP 403 | 同上 |
| 11 筆批次／9000 位元組請求／查別的地址 logs | 400／413／403 | 同上 |
| 期限 45 秒、未知動作 | HTTP 400 | 同上 |
| submit（1 小時）→ confirm | #4 Pending → Confirmed；再按一次被合約拒（NotPending） | `docs/evidence/online-demo-flows.txt` |
| submit（30 秒）→ 立刻記逾期被拒（DeadlineNotPassed）→ 等 70 秒 → 雇主補確認被拒（DeadlinePassed）→ markExpired | #5 Expired | 同上 |
| 查證網址 | 三筆交易都在 Hub REST 反查得到（code 0） | `docs/evidence/online-verify-links.txt` |
| 頻率限制 | 同一 IP 連發 8 次：前 6 次正常處理、第 7、8 次 HTTP 429 | `docs/evidence/online-ratelimit.txt` |
| 網頁 | 載入、報告指紋、鏈上紀錄、角色切換、ME ID 查詢（有／沒有／格式錯）；390 寬沒有元素超出畫面 | `docs/evidence/online-ui-checks.txt` |

## 已知風險

1. **上游 RPC 是裸 IP 加純 http**（`118.175.0.249:8545`）：官方換 IP 就斷；伺服器到上游這一段沒有加密，中間人可以改回應。官方若給 https 網域，改 `api/_lib.mjs` 一行即可。
2. **記憶體計數**：冷啟動歸零、多個執行個體不共享（見上）。最壞情況是測試幣被刷完，餘額門檻會讓服務停在「示範額度用完」，不會影響其他東西。
3. **大家共用同一對示範帳號**：任何訪客都能替示範雇主按確認或異議；這是示範設計，不代表真實使用時的權限。真實使用每個人用自己的錢包。
4. **nonce 競爭**：同一個執行個體內已排隊；不同執行個體同時用同一帳號送交易，可能有一筆失敗，重按即可。
5. **鏈上紀錄查詢範圍**：網頁的交易雜湊列表只往回查最近 40000 個區塊（約 2 天），更早的紀錄只顯示狀態不顯示交易雜湊。
6. Vercel 的 `*.vercel.app` 網址屬於 Vercel 帳號；換帳號或刪專案網址就失效。

## 還沒做的事

- 在瀏覽器裡實際點「登記上鏈／確認／異議／記為逾期」：工作區的送出關卡會擋助手點這類按鈕，同一支 `/api/demo` 已用 curl 跑過全部路徑。請主對話或本人在網頁上點一輪。
- 區塊瀏覽器網頁（explorer-testnet.me）上看不看得到這些 EVM 交易，沒驗證；目前查證連結用 Hub REST JSON。
- 示範影片、專案說明、遠端倉庫：不在這一段。
