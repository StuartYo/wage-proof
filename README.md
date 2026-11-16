# wage-proof：工資對帳存證

> 2026-11-10 起為 MetaEarth Hackathon 2026: BEACON 台灣站新寫，第一筆 commit `4caf681`。賽道：AI 與信任基礎設施。

勞工發現薪資單少算時數，把比對報告的指紋（SHA-256）登記到 ME Network，指名雇主在期限內回應：

- **確認**：同一筆交易用 MEC 把差額補發給勞工，金額不對合約就拒絕。
- **異議**：留下一句理由的指紋，不付款。
- **不回應**：期限過後任何人都能記為逾期，雇主之後回應會被合約拒絕。

雇主的 ME ID 由合約自己查，沒有「真人驗證」以上就拒絕登記。鏈上只有指紋、地址、時間、等級、狀態和補發金額；薪資單與出勤紀錄不上鏈。

完整說明（問題、數據、ME 用在哪裡、證據）：[`docs/專案說明.md`](docs/專案說明.md)

## 線上試用（約 3 分鐘）

**https://wage-proof.vercel.app/**　不用錢包、不用領幣，寫入的是 ME 測試網。

1. 中間是鏈上的紀錄，點一筆看右邊：出勤對薪資單、倒數、每一步的交易（誰簽、區塊、手續費、連結）。
2. 右上角「登記報告」：選報告，期限選 60 秒，雇主選「示範雇主」，按「登記這份報告」。約 5～10 秒出塊。
3. 在右邊用示範雇主身分按「確認並補發 0.00523 MEC」，或寫理由按「提出異議」。
4. 再登記一筆，雇主改選「沒有 ME ID 的地址」，看合約拒絕的原文。
5. 想看逾期：登記 30 秒的不回應，到期後按「記為逾期」。

伺服器用兩個只有測試幣的示範帳號代簽，送出前先在節點上模擬，合約會拒絕就不送。誰能做什麼仍由合約決定。頻率限制：同一來源每分鐘 6 次寫入、全站每天 300 次。

## 合約

| 項目 | 值 |
|---|---|
| 鏈 | ME Network 測試網，chain-id `mechain_400-1` |
| 合約 | CosmWasm，code id **22**，`me1gsy3cm2n5mnmv9esz5ysm7np3xgxryktjmfgu22jldfwps2u3rks38x2yg` |
| admin | 空（沒有人能改規則或遷移） |
| 雇主最低 ME ID 等級 | one（真人驗證），建立時寫死 |
| 期限 | 30 秒～90 天 |
| 原始碼 | `cw/wage-proof-cw/src/`（`lib.rs` 規則、`meid.rs` 查身分、`state.rs` 紀錄、`tests.rs` 單元測試） |

四個動作：`submit`（勞工）、`confirm`（只有被指名的雇主，附剛好等於 `claim` 的 umec）、`dispute`（只有被指名的雇主）、`mark_expired`（任何人，期限過後）。錯誤都有名字，例如 `EmployerNotVerified`、`WrongSettlement`、`SettlementMissing`、`UnexpectedFunds`、`NotEmployer`、`DeadlinePassed`，網頁會翻成白話。

示範換算：NT$1＝0.00001 測試 MEC（不是真實匯率），報告少算的 NT$523 補發 0.00523 MEC。

## 證據

| 項目 | 結果 | 紀錄 |
|---|---|---|
| 合約單元測試 | 28 項全過 | `docs/evidence/cw-d-unit-test.txt` |
| 測試網實跑（補發、少付、多付、沒付、異議附錢、沒有 ME ID） | 18 項照預期 | `docs/evidence/cw-d-e2e.txt` |
| 線上示範實按 | 登記 6.0 秒、確認並補發 8.8 秒 | `docs/evidence/cw-d-online.txt` |

幾筆可以直接查的交易（`https://beta-hub-1317.explorer-testnet.me/cosmos/tx/v1beta1/txs/<雜湊>`）：

- 確認並補發，勞工餘額剛好 +523,000 umec：`D708AC6AFFF03E5B965181AF723B8732E0C7861AB49AAE1B6B4F4E300CCBA557`
- 少付 1 umec 被拒：`94C8585CE22D4AEF908337D786975416C771D6A4627B79E373E2A4C39D43096F`
- 雇主沒有 ME ID 被拒：`7209D85ABA15FAAA0F40962058BE045D9ECF6724748B023E8FA9CB78FDAD56FF`

開發紀錄：`docs/day1.md`～`docs/day6-mec-settlement.md`。

## 本機執行

需要 Node.js 20 以上。

```bash
npm install
npm run check             # 測試網端點只讀檢查
npm run meid -- me1...    # 查某個地址的 ME ID 等級
```

合約單元測試與編譯（需要 Rust 1.78 與 `wasm32-unknown-unknown`；`scripts/rustenv.sh` 是我們機器上的路徑，換成你的）：

```bash
cd cw && cargo test -p wage-proof-cw
bash scripts/cw-build.sh wage-proof-cw     # 輸出 cw/artifacts/*.wasm 與 checksums
```

網頁：

```bash
node scripts/build-public.mjs   # 產生 public/
```

`api/` 是 Vercel 函式（`demo.mjs` 代簽示範動作、`_cw.mjs` 合約呼叫），需要示範帳號的環境變數，金鑰不在倉庫裡。在測試網重新部署、實跑：`node scripts/cw-settle.mjs`（需要自己的測試網錢包，`npm run wallet` 會產生並寫進被 `.gitignore` 擋掉的 `.env`）。

## 前幾版

- `contracts/WageProof.sol`：第一天在 ME 測試網 EVM 部署的 Solidity 版（`0x07C06de8D0D593E45Fa4f16bF4B7D82d96D723E0`）。EVM 合約查不到 ME ID，所以改走 CosmWasm。
- CosmWasm code id 21（`me1kwhfggqzzjy3vnyvldymrrrmjcvxe8ajzlerhx3putherrht2xqsgfpjqc`）：沒有補發功能的前一版，18 筆紀錄留在原地。

## 授權與示範資料

MIT。`demo/` 的兩份報告是手寫的合成資料，人名、公司、金額都是虛構的；測試網 ME ID 是官方水龍頭發的模擬身分。本作品不構成法律意見。
