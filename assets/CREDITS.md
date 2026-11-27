# Assets 与许可

| 文件 | 来源 | 许可 / 说明 |
| --- | --- | --- |
| `pet-idle.png` | 上游同人立绘（`surfcore/assets/deepseek娘.png`） | CC BY-NC-SA 4.0，仅非商业；公开发布前请确认你有权分发 |
| `head-front.png` / `head-side.png` / `head-back.png` | 从用户提供的三视图裁切 + 去底 + 羽化 | 同上，随角色形象走 |
| `tray.png` | 由 `pet-idle.png` 头部裁圆 | 同上 |
| `anger.png` | Twemoji 💢 | CC-BY 4.0 <https://github.com/twitter/twemoji> |
| `ball-cloud.png` / `ball-bubble.png` / `ball-rice.png` | 本项目用 Pillow 程序化重绘 | 随代码 MIT |
| `voice/*.wav` | 用户自己的声音克隆（voxd） | **不随仓库分发**；请自备 |

## 替换立绘

1. 准备一张 512×768 左右的透明 PNG（角色朝右或朝正脸都可以）。
2. 设置页 → 宠物立绘 → 导入，文件会被复制到 `assets/` 并写进 `config.json`。
3. 若要让头部四向也换掉，需要替换 `head-front/side/back.png`（同名、透明底、大致方形），否则会继续用原来的头。

## 不要提交的东西

- `assets/voice/`（个人声音）
- `config.json`（本机偏好）
- `logs/`、`dist/`、`node_modules/`

`.gitignore` 已经默认排除。
