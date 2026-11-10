# wage-proof：工資證據「確認或異議」存證

> **2026-11-10 起為 MetaEarth Hackathon 2026: BEACON 台灣站新寫。** 本倉庫所有程式碼都是比賽期間新增，沒有從舊專案複製程式碼。

賽道：AI 與信任基礎設施。

勞工把「薪資單與出勤比對報告」的指紋（SHA-256）登記到 ME Network 上，指定的雇主要在期限內「確認」或「異議」，逾期沒回應時任何人都能把它記成「逾期未回應」。另外用 ME ID 的只讀查詢顯示某個地址有沒有通過驗證的 ME ID。

**鏈上只有：報告指紋、地址、時間、狀態。** 報告本身（可能有個資）永遠不上鏈。倉庫裡的示範報告 `demo/synthetic-report.json` 是手寫的合成資料，人名、公司、金額全部虛構。

## 測試網錢包（重要）

`npm run wallet` 會在本機產生一個**只給 ME Network 測試網用**的錢包，助記詞寫在 `.env`（已被 `.gitignore` 擋掉，不會進 git）。**不得存入任何真實資產。** 公開地址記在 `config/wallet.public.json`。

## 狀態（第一天，2026-11-10）

| 項目 | 狀態 |
|---|---|
| 測試網只讀連線（Hub REST／RPC、EVM JSON-RPC chainId 400） | 通 |
| ME ID 只讀查詢（有／沒有兩種情況） | 通 |
| 合約 `WageProof.sol` 本機測試 | 10 項全過 |
| 部署到測試網、memo 交易 | 腳本已寫，**尚未執行**：測試錢包餘額 0，等水龍頭領幣 |
| 網頁 | 只連本機模擬鏈 |

細節與證據：`docs/day1.md`。

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
npm run web                           # 終端機 2：http://127.0.0.1:5173/
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
- `web/`：極簡示範頁

## 授權

MIT。本作品不構成法律意見；鏈上紀錄在勞資調解中的法律效力未經查證。
