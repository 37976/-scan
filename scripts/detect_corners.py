#!/usr/bin/env python3
"""Detect the most plausible photographed document quadrilateral."""

import json
import sys

import cv2
import numpy as np


def order(points: np.ndarray) -> np.ndarray:
    points = points.reshape(4, 2).astype(np.float32)
    sums = points.sum(axis=1)
    diffs = points[:, 0] - points[:, 1]
    return np.array([points[np.argmin(sums)], points[np.argmax(diffs)],
                     points[np.argmax(sums)], points[np.argmin(diffs)]])


def polygon_score(points: np.ndarray, width: int, height: int) -> float:
    points = order(points)
    area = abs(cv2.contourArea(points))
    area_ratio = area / (width * height)
    border_hits = sum(point[0] < 3 or point[1] < 3 or point[0] > width - 4 or point[1] > height - 4 for point in points)
    if area_ratio < 0.16 or area_ratio > 0.985 or border_hits >= 3:
        return -1
    sides = [np.linalg.norm(points[(i + 1) % 4] - points[i]) for i in range(4)]
    if min(sides) < min(width, height) * 0.12:
        return -1
    centre = points.mean(axis=0)
    centre_penalty = abs(centre[0] / width - 0.5) + abs(centre[1] / height - 0.5)
    opposite = min(sides[0], sides[2]) / max(sides[0], sides[2])
    opposite *= min(sides[1], sides[3]) / max(sides[1], sides[3])
    return area_ratio * 2.4 + opposite * 0.45 - centre_penalty * 0.55


def candidates_from_mask(mask: np.ndarray) -> list[np.ndarray]:
    result = []
    contours, _ = cv2.findContours(mask, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
    for contour in sorted(contours, key=cv2.contourArea, reverse=True)[:35]:
        perimeter = cv2.arcLength(contour, True)
        for epsilon in (0.012, 0.02, 0.032, 0.05):
            approx = cv2.approxPolyDP(contour, epsilon * perimeter, True)
            if len(approx) == 4 and cv2.isContourConvex(approx):
                result.append(approx.reshape(4, 2))
                break
    return result


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit("usage: detect_corners.py INPUT")
    original = cv2.imread(sys.argv[1], cv2.IMREAD_COLOR)
    if original is None:
        raise SystemExit("无法读取输入图片")
    original_height, original_width = original.shape[:2]
    scale = min(1.0, 1100 / max(original_height, original_width))
    image = cv2.resize(original, (round(original_width * scale), round(original_height * scale)), interpolation=cv2.INTER_AREA)
    height, width = image.shape[:2]
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    gray = cv2.GaussianBlur(gray, (5, 5), 0)

    masks = []
    edges = cv2.Canny(gray, 35, 115)
    edges = cv2.morphologyEx(edges, cv2.MORPH_CLOSE, np.ones((9, 9), np.uint8))
    masks.append(edges)
    _, bright = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    masks.append(cv2.morphologyEx(bright, cv2.MORPH_CLOSE, np.ones((13, 13), np.uint8)))
    adaptive = cv2.adaptiveThreshold(gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
                                     cv2.THRESH_BINARY, 81, -5)
    masks.append(cv2.morphologyEx(adaptive, cv2.MORPH_CLOSE, np.ones((15, 15), np.uint8)))

    best, best_score = None, -1.0
    for mask in masks:
        for points in candidates_from_mask(mask):
            score = polygon_score(points, width, height)
            if score > best_score:
                best, best_score = order(points), score

    if best is None:
        margin_x, margin_y = width * 0.035, height * 0.035
        best = np.array([[margin_x, margin_y], [width - margin_x, margin_y],
                         [width - margin_x, height - margin_y], [margin_x, height - margin_y]])
        confidence = 0.0
    else:
        area_ratio = abs(cv2.contourArea(best)) / (width * height)
        # When the physical paper edge blends into the background, forms often
        # expose a much stronger outer table/content rectangle. Expand that
        # quadrilateral to infer the page boundary instead of cropping away the
        # title and margins.
        if area_ratio < 0.72:
            centre = best.mean(axis=0)
            factor = min(1.38, max(1.08, np.sqrt(0.86 / max(area_ratio, 0.01))))
            best = centre + (best - centre) * factor
            best[:, 0] = np.clip(best[:, 0], 0, width - 1)
            best[:, 1] = np.clip(best[:, 1], 0, height - 1)

        # Phone photos often crop one physical paper edge out of the frame. A
        # low-variation border strip with paper-like brightness means that the
        # document continues to that image edge; extend the two corresponding
        # corners instead of mistaking an inner table border for the page edge.
        centre = gray[height // 4:height * 3 // 4, width // 4:width * 3 // 4]
        centre_median, centre_std = float(np.median(centre)), float(np.std(centre))
        strips = {
            "top": gray[:max(3, height // 40), :],
            "right": gray[:, width - max(3, width // 40):],
            "bottom": gray[height - max(3, height // 40):, :],
            "left": gray[:, :max(3, width // 40)],
        }
        touches = {name: float(np.median(strip)) >= centre_median - 10 and
                   float(np.std(strip)) <= centre_std * .9 + 2
                   for name, strip in strips.items()}
        if touches["top"]:
            best[0, 1] = best[1, 1] = 0
        if touches["right"]:
            best[1, 0] = best[2, 0] = width - 1
        if touches["bottom"]:
            best[2, 1] = best[3, 1] = height - 1
        if touches["left"]:
            best[0, 0] = best[3, 0] = 0
        confidence = min(0.99, max(0.35, 0.45 + area_ratio * 0.55))

    best /= scale
    keys = ("tl", "tr", "br", "bl")
    payload = {"corners": {key: {"x": round(float(point[0]), 2), "y": round(float(point[1]), 2)}
                           for key, point in zip(keys, best)},
               "confidence": round(confidence, 3), "method": "opencv-quadrilateral"}
    print(json.dumps(payload, ensure_ascii=False))


if __name__ == "__main__":
    main()
