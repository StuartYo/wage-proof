# wage-proof：工資證據「確認或異議」存證

> **2026-11-10 起為 MetaEarth Hackathon 2026: BEACON 台灣站新寫。** 本倉庫所有程式碼都是比賽期間新增，沒有從舊專案複製程式碼。

賽道：AI 與信任基礎設施。

勞工把「薪資單與出勤比對報告」的指紋（SHA-256）登記到 ME Network 上，指定的雇主要在期限內「確認」或「異議」，逾期沒回應時任何人都能把它記成「逾期未回應」。登記前，伺服器會到 ME 測試網查指定雇主的 ME ID（真人驗證），等級不夠就不送交易，避免有人開一堆假帳號冒充雇主、灌假的確認紀錄；每筆紀錄旁邊也顯示雙方目前的等級。測試網的 ME ID 是官方提供的模擬身分，不代表真實法律身分驗證。

**鏈上只有：報告指紋、地址、時間、狀態。** 報告本身（可能有個資）永遠不上鏈。倉庫裡的示範報告 `demo/synthetic-report.json` 是手寫的合成資料，人名、公司、金額全部虛構。

## 線上示範（評審 3 分鐘跑完）

**https://wage-proof.vercel.app/** ——不用裝錢包、不用領幣。頁面上的報告與理由都是示範用合成資料，寫入的是 ME 測試網（鏈 ID 400）。

1. 「勞工 Worker」：選一份比對報告（指紋由瀏覽器自己算），期限選 **30 秒**，「指定雇主」選**示範雇主（已進階驗證）**，按「登記上鏈」。約 5～10 秒後「操作紀錄」出現交易雜湊與「在鏈上查證」連結，下方「鏈上紀錄」多一筆「等待雇主回應」，開始倒數。
2. 再登記一筆，期限選 **1 小時**。
3. 「指定雇主」改選**未驗證的地址（示範被擋下）**，按「登記上鏈」：按鈕下方出現紅框，寫明這個地址在 ME 測試網查到「未驗證 None」（節點回 `DID not found`）、規則要求至少「真人驗證」，所以沒有送出交易，鏈上紀錄不會多一筆。
4. 切到「雇主 Employer」：「待我回應」列出兩筆。對 1 小時那筆按「確認」，或寫一句理由按「異議」（鏈上只放理由的指紋）。
5. 等 30 秒那筆倒數歸零（狀態變「逾期未回應（尚未寫入鏈上）」），任何角色按「記為逾期未回應」。這時雇主再想回應會被合約拒絕。
6. 點任一筆的「在鏈上查證」，看 ME 測試網 Hub 回傳的原始交易紀錄。
7. 每筆紀錄的勞工、雇主旁邊有等級字樣（進階驗證／真人驗證／未驗證），旁邊的「在鏈上查證」是 Hub 原始回應。最下方「真人驗證查詢」可以貼任何 me1 或 0x 地址查。

伺服器用兩個**只有測試幣、隨時可以作廢重產**的示範帳號代簽；誰能做什麼一律由合約判斷。頻率限制：同一來源每分鐘 6 次寫入、全站每天 300 次（記憶體計數，冷啟動歸零）。架構、規則、風險：`docs/day2-online-demo.md`；ME ID 檢查：`docs/day3-meid.md`。

## 測試網錢包（重要）

`npm run wallet` 會在本機產生一個**只給 ME Network 測試網用**的錢包，助記詞寫在 `.env`（已被 `.gitignore` 擋掉，不會進 git）。**不得存入任何真實資產。** 公開地址記在 `config/wallet.public.json`。

## 狀態（2026-11-16）

| 項目 | 狀態 |
|---|---|
| 測試網只讀連線（Hub REST／RPC、EVM JSON-RPC chainId 400） | 通 |
| ME ID 只讀查詢（有／沒有兩種情況） | 通 |
| ME ID 接進登記流程（雇主沒有真人驗證就不送交易） | 線上實測通過（`docs/day3-meid.md`） |
| 合約 `WageProof.sol` 本機測試 | 10 項全過 |
| 部署到測試網、memo 交易 | 完成：合約 `0x07C06de8D0D593E45Fa4f16bF4B7D82d96D723E0`，確認／異議／逾期三條路徑已在測試網跑通 |
| 線上示範 https://wage-proof.vercel.app/ | 上線；讀鏈走唯讀中繼、寫鏈由伺服器用示範帳號代簽 |
| 本機示範頁（`web/local.html`） | 只連本機模擬鏈 |
| CosmWasm 正式合約（合約自己查雇主 ME ID） | 單元測試 22 項全過；測試網 code id 21 實跑 11 項照預期（2026-11-16） |

### 兩個合約，各自的角色

- **Solidity 版**（`contracts/WageProof.sol`，ME 測試網 EVM）：線上示範用的就是它。確認／異議／逾期由合約把關；「雇主要有 ME ID」由伺服器先查，查過才送交易。
- **CosmWasm 正式合約**（`cw/wage-proof-cw/`，ME 測試網 code id 21，`me1kwhfggqzzjy3vnyvldymrrrmjcvxe8ajzlerhx3putherrht2xqsgfpjqc`）：規則和 Solidity 版一樣，另外**合約登記時自己查雇主的 ME ID**，等級不到 one 就拒絕，並把雙方當下的等級存進紀錄。測試網已實跑：沒有 ME ID 的雇主被合約擋下、等級 two 的雇主登記成功、30 秒逾期後第三方標記成功。admin 留空，沒有人能改這份合約。線上示範還沒接過來。詳見 `docs/day5-cosmwasm-contract.md`。
- **CosmWasm 探路合約**（code id 13）：第四天用來確認合約能不能查 ME ID，現在只留作紀錄。

細節與證據：`docs/day1.md`、`docs/day2-online-demo.md`、`docs/day3-meid.md`、`docs/day4-cosmwasm.md`、`docs/day5-cosmwasm-contract.md`。

## 啟動步驟

需要 Node.js 20 以上。

```bash
npm install
npm run wallet            # 產生測試網錢包（只印地址）
npm run check             # 測試網端點只讀檢查
npm run meid -- me1...    # 查某地址有沒有 ME ID
npm test                  # 合約測試（本機模擬鏈）
```

本機示範頁：

```bash
npx hardhat node                      # 終端機 1：本機模擬鏈
npm run deploy:local                  # 終端機 2：部署合約
npm run web                           # 終端機 2：http://127.0.0.1:5173/（本機版 local.html）
```

頁面上可一鍵切換「勞工／雇主」，期限可調到 30 秒，並有「快轉 60 秒」按鈕（只在本機鏈有效）。

測試網（領到測試幣後）：

```bash
npm run deploy:testnet                # 部署合約到 ME 測試網 EVM（chain id 400）
npm run memo -- demo/synthetic-report.json --yes   # 保底：指紋寫進交易備註
```

## 檔案

- `contracts/WageProof.sol`：`submit`、`confirm`、`dispute`、`markExpired` 與查詢
- `test/WageProof.test.cjs`：合約測試（含期限快轉、越權呼叫被拒）
- `config/network.json`：所有端點集中在這一份
- `scripts/`：錢包、端點檢查、ME ID 查詢、雜湊、部署、memo 交易、本機端到端
- `web/index.html`、`web/app.js`：線上示範頁（測試網）；`web/local.html`、`web/local.js`：本機模擬鏈版
- `api/rpc.mjs`、`api/demo.mjs`：Vercel 函式（唯讀中繼、代簽示範動作），設定在 `api/_lib.mjs`
- `scripts/demo-accounts.mjs`：產生／作廢重產／注資線上示範帳號（私鑰只寫 `.env.demo`）
- `demo/synthetic-report-2.json`：第二份合成報告

## 授權

MIT。本作品不構成法律意見；鏈上紀錄在勞資調解中的法律效力未經查證。
