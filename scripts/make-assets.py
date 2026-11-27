"""把宠物立绘的纯色背景抠成透明，并生成托盘图标。

输入：surfcore/assets/deepseek娘.png（552x770，背景 #e0e0e0）
输出：assets/pet-idle.png、assets/tray.png、assets/preview-dark.png（验证用）

不依赖 rembg：背景是均匀灰 #e0e0e0，从边缘泛洪 + 边界 alpha 估计即可。
"""
import sys
from collections import deque
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
SRC = Path(r"C:/Users/35376/surfcore/assets/deepseek娘.png")
OUT = ROOT / "assets"
BG = np.array([224, 224, 224], dtype=np.int16)


def flood_background(dist: np.ndarray, threshold: int) -> np.ndarray:
    h, w = dist.shape
    mask = np.zeros((h, w), dtype=bool)
    q = deque()
    for x in range(w):
        for y in (0, h - 1):
            if dist[y, x] <= threshold and not mask[y, x]:
                mask[y, x] = True
                q.append((y, x))
    for y in range(h):
        for x in (0, w - 1):
            if dist[y, x] <= threshold and not mask[y, x]:
                mask[y, x] = True
                q.append((y, x))
    while q:
        y, x = q.popleft()
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            ny, nx = y + dy, x + dx
            if 0 <= ny < h and 0 <= nx < w and not mask[ny, nx] and dist[ny, nx] <= threshold:
                mask[ny, nx] = True
                q.append((ny, nx))
    return mask


def dilate(mask: np.ndarray, radius: int) -> np.ndarray:
    m = Image.fromarray((mask * 255).astype(np.uint8), "L")
    m = m.filter(ImageFilter.MaxFilter(radius * 2 + 1))
    return np.asarray(m) > 127


def average_foreground(arr: np.ndarray, solid: np.ndarray, y: int, x: int, radius: int) -> np.ndarray:
    h, w = solid.shape
    y0, y1 = max(0, y - radius), min(h, y + radius + 1)
    x0, x1 = max(0, x - radius), min(w, x + radius + 1)
    patch = arr[y0:y1, x0:x1].astype(np.float32)
    sm = solid[y0:y1, x0:x1]
    if not sm.any():
        return np.array([40, 40, 60], dtype=np.float32)
    return patch[sm].mean(axis=0)


def main() -> None:
    im = Image.open(SRC).convert("RGB")
    arr = np.asarray(im).astype(np.int16)
    h, w = arr.shape[:2]
    dist = np.abs(arr - BG).max(axis=2)

    bgmask = flood_background(dist, 12)
    band = dilate(bgmask, 3) & ~bgmask
    solid = dist > 55

    out = np.zeros((h, w, 4), dtype=np.uint8)
    out[..., :3] = arr.astype(np.uint8)
    out[..., 3] = 255
    out[bgmask, 3] = 0

    # 边界带：用邻近不透明像素估前景色 F，再按 C = aF + (1-a)B 解 alpha 并去灰边。
    ys, xs = np.nonzero(band)
    B = BG.astype(np.float32)
    for y, x in zip(ys, xs):
        C = arr[y, x].astype(np.float32)
        F = average_foreground(arr, solid, y, x, 4)
        fb = F - B
        denom = float(np.dot(fb, fb))
        if denom < 1e-3:
            out[y, x, 3] = 0
            continue
        alpha = float(np.dot(C - B, fb) / denom)
        alpha = max(0.0, min(1.0, alpha))
        if alpha < 0.04:
            out[y, x, 3] = 0
            continue
        F2 = (C - (1 - alpha) * B) / max(alpha, 1e-3)
        out[y, x, :3] = np.clip(F2, 0, 255).astype(np.uint8)
        out[y, x, 3] = int(round(alpha * 255))

    pet = Image.fromarray(out, "RGBA")
    # 去掉全透明边，保留一点留白
    bbox = pet.getbbox()
    pet = pet.crop(bbox)
    pet.save(OUT / "pet-idle.png")

    # 深色背景预览，检查灰边
    preview = Image.new("RGB", pet.size, (20, 22, 30))
    preview.paste(pet, (0, 0), pet)
    preview.save(OUT / "preview-dark.png")

    # 托盘图标：取头部区域，圆形裁切
    head = pet.crop((int(pet.width * 0.28), int(pet.height * 0.10), int(pet.width * 0.76), int(pet.height * 0.52)))
    head = head.resize((256, 256), Image.LANCZOS)
    canvas = Image.new("RGBA", (256, 256), (0, 0, 0, 0))
    canvas.paste(head, (0, 0))
    mask = Image.new("L", (256, 256), 0)
    from PIL import ImageDraw
    ImageDraw.Draw(mask).ellipse((2, 2, 253, 253), fill=255)
    canvas.putalpha(mask)
    canvas.save(OUT / "tray.png")

    print("pet", pet.size)
    print("tray", canvas.size)
    print("saved to", OUT)


if __name__ == "__main__":
    main()
