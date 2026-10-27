@AGENTS.md

## Claude 向け

- Claude の作業場所はプロジェクトの共有フォルダ（`/mnt/project-files/borderbreak/`）で、公開版のページ（https://claude.ai/artifact/EBViVFVaYZFHUNuuF3bBPF ）もそこから出す。このリポジトリはその写しと、Codex の PR の受け口。
- 合わせ方は `tools/repo_sync.py`：PR をマージしたら先に `from-repo <clone> <マージ前のコミット>` で共有フォルダへ写し、共有フォルダの変更は `to-repo <clone>` で写してからコミットする（逆の順にすると、マージした変更を消してしまう）。
- Codex は「任せる所」だけの PR を自分でマージする（AGENTS.md「自分でマージしてよい変更」、オーナーの指定 2026-10-20）。1時間ごとの確認で、開いている PR に加えて main の新しいコミットも見る。共有フォルダへ写した最後の main のコミットは `/mnt/project-files/.notes/borderbreak-repo-sync.txt` に書いてあるので、それを `from-repo` の基準にし、写したら書き換える。
- GitHub Pages（`gh-pages`）は AGENTS.md「GitHub Pages の更新」の手順で、`tools/build_pages.py` で作り直して push する。Codex も同じ手順で push してよい（オーナーの指定 2026-10-27）。push の前に `git pull --ff-only` で Codex の更新を取り込む。
