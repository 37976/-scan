#!/usr/bin/env python3
"""Restore a perspective-corrected photo without replacing its real content.

This single processing pass removes broad lighting and crease variation, fixes
small residual skew, and keeps the original ink, table rules and anti-aliasing.
"""

import json
import sys
from pathlib import Path

import cv2
import numpy as np


MAX_SIDE = 2800


def resize(image: np.ndarray) -> np.ndarray:
    height, width = image.shape[:2]
    scale = min(1.0, MAX_SIDE / max(height, width))
    if scale == 1.0:
        return image
    return cv2.resize(image, (round(width * scale), round(height * scale)), interpolation=cv2.INTER_AREA)


def deskew_whole_page(image: np.ndarray) -> tuple[np.ndarray, float]:
    """Rotate the complete raster using consensus from long horizontal rules."""
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    edges = cv2.Canny(gray, 55, 155)
    height, width = gray.shape
    lines = cv2.HoughLinesP(edges, 1, np.pi / 720, threshold=max(70, width // 12),
                            minLineLength=max(140, width // 5), maxLineGap=max(16, width // 80))
    angles = []
    if lines is not None:
        for x1, y1, x2, y2 in lines[:, 0]:
            angle = np.degrees(np.arctan2(y2 - y1, x2 - x1))
            length = np.hypot(x2 - x1, y2 - y1)
            if abs(angle) <= 8:
                angles.extend([angle] * max(1, round(length / max(1, width * 0.12))))
    if len(angles) < 5:
        return image, 0.0
    angle = float(np.median(angles))
    if abs(angle) < 0.12 or abs(angle) > 5:
        return image, 0.0
    matrix = cv2.getRotationMatrix2D((width / 2, height / 2), angle, 1.0)
    return cv2.warpAffine(image, matrix, (width, height), flags=cv2.INTER_CUBIC,
                          borderMode=cv2.BORDER_CONSTANT, borderValue=(255, 255, 255)), angle


def sharpness_score(image: np.ndarray) -> float:
    """Return a resolution-normalised focus score for automatic deghosting."""
    height, width = image.shape[:2]
    scale = min(1.0, 1600 / max(height, width))
    sample = cv2.resize(image, (round(width * scale), round(height * scale)), interpolation=cv2.INTER_AREA)
    gray = cv2.cvtColor(sample, cv2.COLOR_BGR2GRAY)
    margin_y, margin_x = round(gray.shape[0] * .04), round(gray.shape[1] * .04)
    content = gray[margin_y:gray.shape[0] - margin_y, margin_x:gray.shape[1] - margin_x]
    return float(cv2.Laplacian(content, cv2.CV_32F).var())


def deghost(channel: np.ndarray, score: float) -> tuple[np.ndarray, bool]:
    """Conservative Wiener deconvolution for uniform defocus/camera ghosting.

    It runs only on demonstrably soft pages. Sharp scans bypass this branch, so
    table rules do not acquire ringing or artificial double edges.
    """
    if score >= 280:
        return channel, False
    severity = np.clip((280 - score) / 220, 0, 1)
    kernel_sigma = float(.82 + severity * .34)
    balance = float(.012 + severity * .009)
    pad = 18
    padded = cv2.copyMakeBorder(channel, pad, pad, pad, pad, cv2.BORDER_REFLECT_101)
    height, width = padded.shape
    yy, xx = np.mgrid[:height, :width]
    yy = np.minimum(yy, height - yy)
    xx = np.minimum(xx, width - xx)
    psf = np.exp(-(xx * xx + yy * yy) / (2 * kernel_sigma * kernel_sigma))
    psf /= psf.sum()
    transfer = np.fft.rfft2(psf)
    observed = np.fft.rfft2(padded)
    restored = np.fft.irfft2(observed * np.conj(transfer) /
                             (np.abs(transfer) ** 2 + balance), s=padded.shape)
    restored = restored[pad:-pad, pad:-pad]
    return np.clip(restored, 0, 255).astype(np.float32), True


def main() -> None:
    if len(sys.argv) != 4:
        raise SystemExit("usage: scan_restore.py INPUT OUTPUT.png OUTPUT.json")
    source = cv2.imread(sys.argv[1], cv2.IMREAD_COLOR)
    if source is None:
        raise SystemExit("无法读取输入图片")
    source = resize(source)
    source, deskew_angle = deskew_whole_page(source)
    focus_score = sharpness_score(source)
    height, width = source.shape[:2]
    gray = cv2.cvtColor(source, cv2.COLOR_BGR2GRAY)

    # Estimate only low-frequency illumination. Division removes folds and cast
    # shadows while leaving the photographed edge shape of every glyph intact.
    sigma = max(22, round(max(height, width) / 75))
    illumination = cv2.GaussianBlur(gray, (0, 0), sigma)
    normalized = np.clip(gray.astype(np.float32) / np.maximum(illumination, 16) * 242, 0, 255)
    normalized, ghost_corrected = deghost(normalized, focus_score)

    # Match a scanner response: clean white paper, but a steep tone curve for
    # faint rules and anti-aliased glyph edges. The previous linear blend made
    # the content grey and was perceived as overexposure.
    fine_texture = cv2.GaussianBlur(normalized, (0, 0), 0.7) - cv2.GaussianBlur(normalized, (0, 0), 3.0)
    paper = np.clip(253 + fine_texture * 0.08, 247, 255)
    ink_strength = np.clip((245 - normalized) / 30, 0, 1)
    ink_strength = cv2.GaussianBlur(ink_strength, (0, 0), 0.35)
    ink_tone = 255 * np.power(np.clip(normalized / 255, 0, 1), 2.0)
    restored_gray = paper * (1 - ink_strength) + ink_tone * ink_strength
    restored = np.repeat(restored_gray[:, :, None], 3, axis=2)

    # Preserve real coloured ink, especially seals, instead of recreating it.
    hsv = cv2.cvtColor(source, cv2.COLOR_BGR2HSV)
    colour_strength = np.clip((hsv[:, :, 1].astype(np.float32) - 38) / 120, 0, 1)[:, :, None]
    colour_corrected = np.empty_like(source, dtype=np.float32)
    for channel in range(3):
        field = cv2.GaussianBlur(source[:, :, channel], (0, 0), sigma)
        colour_corrected[:, :, channel] = np.clip(source[:, :, channel].astype(np.float32) / np.maximum(field, 18) * 228, 0, 255)
    restored = restored * (1 - colour_strength) + colour_corrected * colour_strength

    # Never erase or redraw document geometry. Text, table rules and seals stay
    # in one continuous raster layer; geometry is handled upstream by the
    # perspective crop performed by the browser.
    restored = np.uint8(np.clip(restored, 0, 255))

    cv2.imwrite(sys.argv[2], restored, [cv2.IMWRITE_PNG_COMPRESSION, 3])
    metadata = {"algorithmVersion": 8, "width": width, "height": height,
                "deskewAngle": round(deskew_angle, 3),
                "sharpnessScore": round(focus_score, 2),
                "ghostCorrection": ghost_corrected,
                "continuousRaster": True, "preservesOriginalInk": True}
    Path(sys.argv[3]).write_text(json.dumps(metadata, ensure_ascii=False), encoding="utf-8")


if __name__ == "__main__":
    main()
