# 特別装備の画面確認

全3系統で型の一覧・比較（▲▼）・オリジナルモデルを確認。選択した型を保存し、再読み込みして維持されることも自動検証。

- [GB-6 防護バリア](gb.png)：前半球／小型全周／大型全周。
- [IT-3 背部自動銃](it.png)：標準／連射／強装。
- [IP-4 リペアビーコン](ip.png)：標準／広域／高出力。

再現：`python3 tools/test/make_dbg.py dbg` → `node tools/test/special_equipment_check.js dbg <出力先> [変更前stats.json]`。Playwright/Chromiumを使用。
