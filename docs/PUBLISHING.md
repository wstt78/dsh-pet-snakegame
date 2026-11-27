# 发布到 GitHub

这份文档是给「把仓库推上 GitHub 并打包一个 Release」用的检查清单。

## 0. 发布前确认

- [ ] `node --test test/` 全绿（当前 31/31）
- [ ] `node scripts/release-check.mjs` 通过（检查必需文件、资源引用、无个人路径）
- [ ] `assets/voice/` 没有进 git（个人声音克隆）
- [ ] `config.json`、`logs/`、`dist/`、`node_modules/` 没有进 git
- [ ] 角色立绘的再分发权利已确认（见 `assets/CREDITS.md`）；不确定就删掉 `pet-idle.png` / `head-*.png` / `tray.png`，换成自己的图

## 1. 建仓

```powershell
cd <项目目录>
git init -b main
git add .
git commit -m "feat: 鲸鱼娘桌宠贪吃蛇首版（透明覆盖层 + 只读输入探针 + 四向蛇头）"
# 在 GitHub 上建空仓库后：
git remote add origin https://github.com/<you>/whale-snake-pet.git
git push -u origin main
```

> 不想用命令行：GitHub Desktop → Add local repository → 选这个目录 → Publish repository。

## 2. 打包可执行文件

```powershell
npm run build:helper   # 确认 bin\input-helper.exe 是最新的
npm run pack           # 产出 dist\WhaleSnakePet\WhaleSnakePet.exe
```

打包脚本只复制 `electron\dist` + `src/assets/bin/package.json`，不联网、不需要 electron-builder。

## 3. 发 Release

1. 在 `package.json` 里把 `version` 改成要发的版本（例如 `0.1.0`）。
2. `git tag v0.1.0 && git push --tags`
3. GitHub → Releases → Draft a new release → 选 tag → 上传 `dist\WhaleSnakePet` 的 zip。
4. Release notes 写清：Windows x64、未签名（SmartScreen 提示）、语音文件自备。

## 4. 可选：CI

`.github/workflows/test.yml` 会在 push / PR 时跑 `node --test`（不装 Electron 二进制）。

## 5. 版本号纪律

- 玩法/视觉改动 → patch 或 minor
- 破坏配置兼容 → minor
- 只是文档/截图 → 不改版本

## 6. 回滚

- 发布后发现问题：`git revert <sha>` 发 patch；不要 force-push main。
- 本地打包坏掉：删 `dist\WhaleSnakePet` 重跑 `npm run pack`，不会动源码。
