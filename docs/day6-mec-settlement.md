# 第六天：雇主確認＝用 MEC 補發差額

## 這次改了什麼

以前 MEC 在這個作品裡只拿來付手續費。現在雇主按「確認」的那一筆交易，就同時把差額用 MEC 付給勞工：

1. 勞工登記報告時多填一個「主張補發金額」（`claim`，單位是鏈上的 umec）。
2. 雇主確認時，必須在**同一筆交易**附上剛好這個金額。合約收到後，馬上用銀行轉帳訊息（`BankMsg::Send`）轉給勞工，並在紀錄裡寫「已補發多少」（`settled`）。
3. 少付、多付、沒付、付錯幣，合約一律拒絕，紀錄維持「等待回應」，錢也不會動。
4. 異議、記為逾期、登記這三個動作都不准附錢，附了就拒絕。這樣錢不會卡在合約裡；實測合約地址的餘額一直是 0。
5. 沒填金額（`claim`＝0）就跟舊版一樣：雇主確認不用付錢，附了錢反而會被拒。

打個比方：以前雇主只是在對帳單上簽名說「對，我少給了」；現在簽名和匯款綁在一起，不能只簽不付，也不能付錯金額。

## 示範換算（不是真實匯率）

測試網的 MEC 是 8 位小數（`umec`，1 MEC＝10^8 umec，鏈上 `denoms_metadata` 查得到；`bond_denom` 也是 `umec`）。示範帳號只有零點幾個 MEC，所以訂了一個很小的換算：

**NT$1＝1,000 umec＝0.00001 MEC，報告裡的 NT$523 → 523,000 umec＝0.00523 MEC。**

這只是示範用的換算，畫面、說明、API 都寫明「示範換算，非真實匯率」。線上示範每筆最多主張 NT$5,000（0.05 MEC），避免示範帳號被掏空。

## 合約

- 新版 `wage-proof-cw v0.3.0`，**新上傳、新地址**；舊合約（code 21）和它的 18 筆紀錄原封不動，沒有 migrate。
- code id **22**，地址 `me1gsy3cm2n5mnmv9esz5ysm7np3xgxryktjmfgu22jldfwps2u3rks38x2yg`
- admin 留空（沒有人能改這個合約），`min_employer_level: one`，`settle_denom: umec`
- 上傳交易 `31ACCEEDF21976E082B57A6A77B9DACF82F9CCBE707572ABD79837B8683DFB88`
- 建立交易 `CD9DE85B577CDFDE9A67F40384B4AA0EE0F1AA8D4D1A2A6B07EA4278A7216B78`
- wasm sha256 `7e3a3564614efd81196a3c28d56f167d292a00490603752793d4b3d7f4ddeda6`
- 合約資訊：https://beta-hub-1317.explorer-testnet.me/cosmwasm/wasm/v1/contract/me1gsy3cm2n5mnmv9esz5ysm7np3xgxryktjmfgu22jldfwps2u3rks38x2yg

新的錯誤名稱（訊息開頭，網頁用它翻成白話）：

| 名稱 | 什麼時候 |
|---|---|
| `WrongSettlement` | 雇主附的金額跟主張金額不同（少一個 umec、多一個 umec 都算） |
| `WrongSettlementDenom` | 附的不是 umec，或一次附了好幾種幣 |
| `SettlementMissing` | 有主張金額，雇主確認時卻沒附錢 |
| `UnexpectedFunds` | 登記、異議、記為逾期附了錢；或沒有主張金額的確認附了錢 |

查詢 `record` 會多回 `claim`、`settled` 兩欄（字串，單位 umec）；`submit` 事件多 `claim`，`confirm`／`dispute`／`mark_expired` 事件多 `claim`、`settled`。

## 單元測試

`cargo test`：**28 項全過**（原本 22 項照過，新增 6 項：剛好付清、少付／多付／沒付、錯幣／多種幣、claim＝0 卻附錢、異議／登記／逾期附錢、勞工代付或過期付款不算雇主確認）。紀錄：`docs/evidence/cw-d-unit-test.txt`。

## 測試網實跑（`node scripts/cw-settle.mjs`，17 PASS、0 UNEXPECTED）

全部紀錄在 `docs/evidence/cw-d-e2e.txt`。雇主用的是有 ME ID 進階驗證的舊示範雇主（EVM 金鑰，照第五天的 ethsecp256k1 簽法）。

| 步驟 | 結果 | 交易 |
|---|---|---|
| 勞工登記 #1，主張 523,000 umec | 成功 | [7ED3FD8C…1D33](https://beta-hub-1317.explorer-testnet.me/cosmos/tx/v1beta1/txs/7ED3FD8C88B9C124B334B5ACD3515491B40BBCADB90F532023A691A12B151D33) |
| 雇主只付 522,999 | 被拒 `WrongSettlement` | [94C8585C…096F](https://beta-hub-1317.explorer-testnet.me/cosmos/tx/v1beta1/txs/94C8585CE22D4AEF908337D786975416C771D6A4627B79E373E2A4C39D43096F) |
| 雇主付 523,001 | 被拒 `WrongSettlement` | [135DBA4B…D3EB](https://beta-hub-1317.explorer-testnet.me/cosmos/tx/v1beta1/txs/135DBA4B8F9938B9C9D3D6BED40EE72D5E00CFB530998C30149F60468902D3EB) |
| 雇主沒付就確認 | 被拒 `SettlementMissing` | [91E19D72…DE5](https://beta-hub-1317.explorer-testnet.me/cosmos/tx/v1beta1/txs/91E19D722015A631C87B2811D232F2D2924DBA48BE27B362A039C05647DBCDE5) |
| **雇主付剛好 523,000 並確認** | **成功，勞工餘額 59,700,000 → 60,223,000（剛好 +523,000）**；雇主少 533,000＝523,000＋手續費 10,000；合約餘額 0 | [D708AC6A…A557](https://beta-hub-1317.explorer-testnet.me/cosmos/tx/v1beta1/txs/D708AC6AFFF03E5B965181AF723B8732E0C7861AB49AAE1B6B4F4E300CCBA557) |
| 雇主對 #2 異議但附 523,000 | 被拒 `UnexpectedFunds` | [999780C1…05D3](https://beta-hub-1317.explorer-testnet.me/cosmos/tx/v1beta1/txs/999780C131E99BB4B42762EB32F3F04C86E5B491E7CBE28AE9931C2F597905D3) |
| 雇主對 #2 異議（不附錢） | 成功，`settled=0`，勞工餘額不變 | [AA44227E…47C1](https://beta-hub-1317.explorer-testnet.me/cosmos/tx/v1beta1/txs/AA44227E511C9AC3ED43B3C584B570DC5B6B5B94DDAF60AFEAC429DF752B47C1) |
| #3 不主張金額，雇主確認卻附 1 umec | 被拒 `UnexpectedFunds` | [34A6280C…560B](https://beta-hub-1317.explorer-testnet.me/cosmos/tx/v1beta1/txs/34A6280C6E5A7BE5109C5BE884DF8DDA65F8DE823308EFD06175C3183F55560B) |
| 指定沒有 ME ID 的雇主登記 | 被拒 `EmployerNotVerified`，紀錄數不變 | [7209D85A…56FF](https://beta-hub-1317.explorer-testnet.me/cosmos/tx/v1beta1/txs/7209D85ABA15FAAA0F40962058BE045D9ECF6724748B023E8FA9CB78FDAD56FF) |

被拒的交易是故意用固定手續費送上鏈的，所以查得到雜湊和原始錯誤（`code=5`）。

雇主示範帳號原本有 19,819,997 umec（約 0.198 MEC），由部署主錢包轉 20,000,000 umec（0.2 測試 MEC）過去：[A000D25B…1819](https://beta-hub-1317.explorer-testnet.me/cosmos/tx/v1beta1/txs/A000D25B9ADC8BE6496F685CBE61C6479D55C640AE0AD99BC553B83589511819)。只轉測試幣。

## 線上示範

https://wage-proof.vercel.app/ 已改接新合約（`api/_cw.mjs` 的 `CW`，改完重跑 `node scripts/bundle-api.mjs`）。

- 登記面板：「補發金額」一欄寫「主張補發 NT$523（示範換算）0.00523 MEC」，下方註明示範換算、非真實匯率。送出時 API 收 `claimTwd`，伺服器乘上 1,000 換成 umec 寫進合約。
- 雇主回應：按鈕是「確認並補發 0.00523 MEC」。伺服器先向合約讀這筆紀錄的 `claim`，附上剛好這個金額送出；金額對不對由合約再檢查一次。
- 時間軸：確認那一步顯示「雇主確認並補發」＋「補發 0.00523 MEC 給勞工」＋交易連結。
- 明細多兩列：「主張補發」與「結算：已補發 X MEC 給勞工／未結算（等雇主確認、雇主異議沒有付款、逾期沒有付款）」。
- 舊合約的 18 筆不顯示；「規則」面板放一個「舊合約紀錄」連結（直接看合約回傳的原始資料）。

線上實測（headless Chrome，1440 與 390，紀錄在 `docs/evidence/cw-d-online.txt`）：

- 登記 #4（示範雇主、1 小時）6.0 秒成功：`41E26714474055E8036ABE095CFB9CD12BFB1DED4D741C75C04544781E592921`
- 按「確認並補發 0.00523 MEC」8.8 秒成功，同一筆交易附 523,000 umec、事件 `settled=523000`：[2E36A409…9F03](https://beta-hub-1317.explorer-testnet.me/cosmos/tx/v1beta1/txs/2E36A40910791541CA0D2997514E15F27E11033F05FA12898E99BA5D06C19F03)
- 改指定沒有 ME ID 的地址：合約拒絕（`EmployerNotVerified`），沒有產生紀錄。
- 390 寬沒有橫向捲動。截圖在 `docs/evidence/day6-shots/`。

## 檔案

- `cw/wage-proof-cw/src/lib.rs`、`state.rs`、`tests.rs`：補發規則與測試
- `scripts/cw-settle.mjs`：上傳＋建立新合約（已部署就跳過）＋測試網實跑
- `scripts/cw-settle-reject.mjs`：把一筆「雇主沒有 ME ID」的拒絕送上鏈，給線上示範連結用
- `scripts/cw-lib.mjs`：`execMsg` 可以帶 `funds`
- `deployments/cw-testnet.json`：新增 `wageProofSettle`
- `api/_cw.mjs`、`api/_cwbundle.mjs`、`api/demo.mjs`、`web/app.js`、`web/index.html`

## 已知限制

1. 換算是示範用的固定數字，不是匯率；真實上線要換成穩定幣或法幣通道，這裡沒做。
2. 補發金額由勞工主張，合約只保證「雇主確認時付的剛好是這個數」，不判斷金額本身對不對；雇主不同意就用異議。
3. 雇主可以先不回應讓它逾期，逾期不付款；這跟舊版一樣，逾期本身就是一筆紀錄。
4. 示範雇主帳號的測試幣會隨示範次數減少（每次確認約 0.00533 MEC），目前約 0.39 MEC；低於門檻時 API 回「示範額度用完」。
