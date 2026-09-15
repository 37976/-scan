package com.xunuo.pocketscan;

import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.util.Base64;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.opencv.android.Utils;
import org.opencv.android.OpenCVLoader;
import org.opencv.core.Core;
import org.opencv.core.CvType;
import org.opencv.core.Mat;
import org.opencv.core.MatOfByte;
import org.opencv.core.MatOfDouble;
import org.opencv.core.MatOfPoint;
import org.opencv.core.MatOfPoint2f;
import org.opencv.core.Point;
import org.opencv.core.Scalar;
import org.opencv.core.Size;
import org.opencv.imgcodecs.Imgcodecs;
import org.opencv.imgproc.Imgproc;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;

@CapacitorPlugin(name = "Scanner")
public class ScannerPlugin extends Plugin {
    private static final int MAX_SIDE = 2400;
    private boolean openCvReady;

    @Override
    public void load() {
        openCvReady = OpenCVLoader.initLocal();
    }

    @PluginMethod
    public void detectCorners(PluginCall call) {
        runInBackground(call, () -> detectDocument(decode(call.getString("image"))));
    }

    @PluginMethod
    public void restore(PluginCall call) {
        runInBackground(call, () -> restoreDocument(decode(call.getString("image"))));
    }

    private interface Work { JSObject run() throws Exception; }

    private void runInBackground(PluginCall call, Work work) {
        new Thread(() -> {
            try {
                JSObject result = work.run();
                getActivity().runOnUiThread(() -> call.resolve(result));
            } catch (Exception error) {
                getActivity().runOnUiThread(() -> call.reject(error.getMessage(), error));
            }
        }, "PocketScan-OpenCV").start();
    }

    private Mat decode(String dataUrl) {
        if (!openCvReady) throw new IllegalStateException("OpenCV 初始化失败");
        if (dataUrl == null || !dataUrl.contains(",")) throw new IllegalArgumentException("无效的图片数据");
        byte[] bytes = Base64.decode(dataUrl.substring(dataUrl.indexOf(',') + 1), Base64.DEFAULT);
        Bitmap bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.length);
        if (bitmap == null) throw new IllegalArgumentException("无法读取图片");
        Mat rgba = new Mat();
        Utils.bitmapToMat(bitmap, rgba);
        bitmap.recycle();
        Mat bgr = new Mat();
        Imgproc.cvtColor(rgba, bgr, Imgproc.COLOR_RGBA2BGR);
        rgba.release();
        return bgr;
    }

    private JSObject detectDocument(Mat original) {
        int originalWidth = original.cols(), originalHeight = original.rows();
        double scale = Math.min(1.0, 1100.0 / Math.max(originalWidth, originalHeight));
        Mat image = new Mat();
        Imgproc.resize(original, image, new Size(Math.round(originalWidth * scale), Math.round(originalHeight * scale)), 0, 0, Imgproc.INTER_AREA);
        original.release();
        int width = image.cols(), height = image.rows();
        Mat gray = new Mat();
        Imgproc.cvtColor(image, gray, Imgproc.COLOR_BGR2GRAY);
        Imgproc.GaussianBlur(gray, gray, new Size(5, 5), 0);

        List<Mat> masks = new ArrayList<>();
        Mat edges = new Mat();
        Imgproc.Canny(gray, edges, 35, 115);
        Imgproc.morphologyEx(edges, edges, Imgproc.MORPH_CLOSE, Imgproc.getStructuringElement(Imgproc.MORPH_RECT, new Size(9, 9)));
        masks.add(edges);
        Mat bright = new Mat();
        Imgproc.threshold(gray, bright, 0, 255, Imgproc.THRESH_BINARY | Imgproc.THRESH_OTSU);
        Imgproc.morphologyEx(bright, bright, Imgproc.MORPH_CLOSE, Imgproc.getStructuringElement(Imgproc.MORPH_RECT, new Size(13, 13)));
        masks.add(bright);
        Mat adaptive = new Mat();
        Imgproc.adaptiveThreshold(gray, adaptive, 255, Imgproc.ADAPTIVE_THRESH_GAUSSIAN_C, Imgproc.THRESH_BINARY, 81, -5);
        Imgproc.morphologyEx(adaptive, adaptive, Imgproc.MORPH_CLOSE, Imgproc.getStructuringElement(Imgproc.MORPH_RECT, new Size(15, 15)));
        masks.add(adaptive);

        Point[] best = null;
        double bestScore = -1;
        for (Mat mask : masks) {
            List<MatOfPoint> contours = new ArrayList<>();
            Imgproc.findContours(mask, contours, new Mat(), Imgproc.RETR_LIST, Imgproc.CHAIN_APPROX_SIMPLE);
            contours.sort((a, b) -> Double.compare(Imgproc.contourArea(b), Imgproc.contourArea(a)));
            for (MatOfPoint contour : contours.subList(0, Math.min(35, contours.size()))) {
                MatOfPoint2f curve = new MatOfPoint2f(contour.toArray());
                double perimeter = Imgproc.arcLength(curve, true);
                for (double epsilon : new double[]{.012, .02, .032, .05}) {
                    MatOfPoint2f approx = new MatOfPoint2f();
                    Imgproc.approxPolyDP(curve, approx, epsilon * perimeter, true);
                    if (approx.total() == 4) {
                        MatOfPoint polygon = new MatOfPoint(approx.toArray());
                        if (Imgproc.isContourConvex(polygon)) {
                            Point[] ordered = order(approx.toArray());
                            double score = polygonScore(ordered, width, height);
                            if (score > bestScore) { best = ordered; bestScore = score; }
                        }
                        polygon.release();
                    }
                    approx.release();
                }
                curve.release(); contour.release();
            }
        }

        double confidence;
        if (best == null) {
            double mx = width * .035, my = height * .035;
            best = new Point[]{new Point(mx, my), new Point(width - mx, my), new Point(width - mx, height - my), new Point(mx, height - my)};
            confidence = 0;
        } else {
            double areaRatio = polygonArea(best) / (width * (double) height);
            if (areaRatio < .72) {
                Point centre = centre(best);
                double factor = Math.min(1.38, Math.max(1.08, Math.sqrt(.86 / Math.max(areaRatio, .01))));
                for (Point p : best) {
                    p.x = clamp(centre.x + (p.x - centre.x) * factor, 0, width - 1);
                    p.y = clamp(centre.y + (p.y - centre.y) * factor, 0, height - 1);
                }
            }
            applyFrameContact(best, gray);
            confidence = Math.min(.99, Math.max(.35, .45 + areaRatio * .55));
        }

        JSObject corners = new JSObject();
        String[] keys = {"tl", "tr", "br", "bl"};
        for (int i = 0; i < 4; i++) {
            JSObject point = new JSObject();
            point.put("x", round(best[i].x / scale, 2));
            point.put("y", round(best[i].y / scale, 2));
            corners.put(keys[i], point);
        }
        JSObject result = new JSObject();
        result.put("corners", corners);
        result.put("confidence", round(confidence, 3));
        result.put("method", "android-opencv-quadrilateral");
        for (Mat mask : masks) mask.release();
        gray.release(); image.release();
        return result;
    }

    private JSObject restoreDocument(Mat source) {
        double scale = Math.min(1.0, MAX_SIDE / (double) Math.max(source.cols(), source.rows()));
        if (scale < 1) {
            Mat resized = new Mat();
            Imgproc.resize(source, resized, new Size(Math.round(source.cols() * scale), Math.round(source.rows() * scale)), 0, 0, Imgproc.INTER_AREA);
            source.release(); source = resized;
        }
        DeskewResult deskewed = deskew(source);
        source = deskewed.image;
        double focusScore = sharpnessScore(source);
        int width = source.cols(), height = source.rows();

        Mat gray = new Mat();
        Imgproc.cvtColor(source, gray, Imgproc.COLOR_BGR2GRAY);
        Mat grayFloat = new Mat(); gray.convertTo(grayFloat, CvType.CV_32F);
        double fieldSigma = Math.max(22, Math.round(Math.max(height, width) / 75.0));
        Mat illumination = new Mat();
        Imgproc.GaussianBlur(grayFloat, illumination, new Size(0, 0), fieldSigma);
        Core.max(illumination, Scalar.all(16), illumination);
        Mat normalized = new Mat();
        Core.divide(grayFloat, illumination, normalized, 242);
        clip(normalized, 0, 255);
        boolean ghostCorrection = focusScore < 280;
        if (ghostCorrection) {
            Mat corrected = deghost(normalized, focusScore);
            normalized.release(); normalized = corrected;
        }

        Mat blurFine = new Mat(), blurBroad = new Mat(), texture = new Mat();
        Imgproc.GaussianBlur(normalized, blurFine, new Size(0, 0), .7);
        Imgproc.GaussianBlur(normalized, blurBroad, new Size(0, 0), 3);
        Core.subtract(blurFine, blurBroad, texture);
        Core.multiply(texture, Scalar.all(.08), texture);
        Core.add(texture, Scalar.all(253), texture);
        clip(texture, 247, 255);

        Mat strength = new Mat();
        Core.multiply(normalized, Scalar.all(-1), strength);
        Core.add(strength, Scalar.all(245), strength);
        Core.multiply(strength, Scalar.all(1.0 / 30), strength);
        clip(strength, 0, 1);
        Imgproc.GaussianBlur(strength, strength, new Size(0, 0), .35);
        Mat ink = new Mat();
        Core.multiply(normalized, normalized, ink, 1.0 / 255);
        Mat oneMinus = new Mat();
        Core.multiply(strength, Scalar.all(-1), oneMinus);
        Core.add(oneMinus, Scalar.all(1), oneMinus);
        Mat restoredGray = new Mat();
        Core.multiply(texture, oneMinus, restoredGray);
        Mat darkPart = new Mat();
        Core.multiply(ink, strength, darkPart);
        Core.add(restoredGray, darkPart, restoredGray);

        Mat hsv = new Mat();
        Imgproc.cvtColor(source, hsv, Imgproc.COLOR_BGR2HSV);
        List<Mat> hsvChannels = new ArrayList<>(); Core.split(hsv, hsvChannels);
        Mat colourStrength = new Mat();
        Core.subtract(hsvChannels.get(1), Scalar.all(38), colourStrength);
        colourStrength.convertTo(colourStrength, CvType.CV_32F, 1.0 / 120);
        clip(colourStrength, 0, 1);
        List<Mat> sourceChannels = new ArrayList<>(); Core.split(source, sourceChannels);
        List<Mat> correctedChannels = new ArrayList<>();
        for (Mat channel : sourceChannels) {
            Mat channelFloat = new Mat(); channel.convertTo(channelFloat, CvType.CV_32F);
            Mat field = new Mat(); Imgproc.GaussianBlur(channelFloat, field, new Size(0, 0), fieldSigma);
            Core.max(field, Scalar.all(18), field);
            Mat corrected = new Mat(); Core.divide(channelFloat, field, corrected, 228);
            clip(corrected, 0, 255); correctedChannels.add(corrected);
            channelFloat.release(); field.release(); channel.release();
        }
        Mat colourCorrected = new Mat(); Core.merge(correctedChannels, colourCorrected);
        Mat restoredBgr = new Mat(); Imgproc.cvtColor(restoredGray, restoredBgr, Imgproc.COLOR_GRAY2BGR);
        List<Mat> masks = Arrays.asList(colourStrength, colourStrength, colourStrength);
        Mat colourMask = new Mat(); Core.merge(masks, colourMask);
        Mat inverseMask = new Mat(); Core.multiply(colourMask, Scalar.all(-1), inverseMask); Core.add(inverseMask, Scalar.all(1), inverseMask);
        Core.multiply(restoredBgr, inverseMask, restoredBgr);
        Core.multiply(colourCorrected, colourMask, colourCorrected);
        Core.add(restoredBgr, colourCorrected, restoredBgr);
        Mat output = new Mat(); restoredBgr.convertTo(output, CvType.CV_8UC3);

        MatOfByte encoded = new MatOfByte();
        Imgcodecs.imencode(".png", output, encoded);
        String image = "data:image/png;base64," + Base64.encodeToString(encoded.toArray(), Base64.NO_WRAP);
        JSObject metadata = new JSObject();
        metadata.put("algorithmVersion", 8);
        metadata.put("width", width); metadata.put("height", height);
        metadata.put("deskewAngle", round(deskewed.angle, 3));
        metadata.put("sharpnessScore", round(focusScore, 2));
        metadata.put("ghostCorrection", ghostCorrection);
        metadata.put("continuousRaster", true); metadata.put("preservesOriginalInk", true);
        JSObject result = new JSObject(); result.put("image", image); result.put("metadata", metadata);

        for (Mat mat : hsvChannels) mat.release();
        for (Mat mat : correctedChannels) mat.release();
        gray.release(); grayFloat.release(); illumination.release(); normalized.release(); blurFine.release();
        blurBroad.release(); texture.release(); strength.release(); ink.release(); oneMinus.release(); darkPart.release();
        restoredGray.release(); hsv.release(); colourStrength.release(); colourCorrected.release(); restoredBgr.release();
        colourMask.release(); inverseMask.release(); output.release(); encoded.release(); source.release();
        return result;
    }

    private Mat deghost(Mat channel, double score) {
        double severity = clamp((280 - score) / 220, 0, 1);
        double sigma = .82 + severity * .34;
        double balance = .012 + severity * .009;
        int pad = 18;
        Mat padded = new Mat(); Core.copyMakeBorder(channel, padded, pad, pad, pad, pad, Core.BORDER_REFLECT_101);
        int height = padded.rows(), width = padded.cols();
        Mat psf = new Mat(height, width, CvType.CV_32F);
        for (int y = 0; y < height; y++) {
            float[] row = new float[width]; int dy = Math.min(y, height - y);
            for (int x = 0; x < width; x++) { int dx = Math.min(x, width - x); row[x] = (float) Math.exp(-(dx * dx + dy * dy) / (2 * sigma * sigma)); }
            psf.put(y, 0, row);
        }
        psf.convertTo(psf, CvType.CV_32F, 1.0 / Core.sumElems(psf).val[0]);
        Mat observedSpectrum = new Mat(), transfer = new Mat();
        Core.dft(padded, observedSpectrum, Core.DFT_COMPLEX_OUTPUT, 0);
        Core.dft(psf, transfer, Core.DFT_COMPLEX_OUTPUT, 0);
        List<Mat> g = new ArrayList<>(), h = new ArrayList<>(); Core.split(observedSpectrum, g); Core.split(transfer, h);
        Mat denominator = h.get(0).mul(h.get(0));
        Core.add(denominator, h.get(1).mul(h.get(1)), denominator);
        Core.add(denominator, Scalar.all(balance), denominator);
        Mat real = g.get(0).mul(h.get(0)), temporary = g.get(1).mul(h.get(1)); Core.add(real, temporary, real);
        Mat imaginary = g.get(1).mul(h.get(0)); temporary.release(); temporary = g.get(0).mul(h.get(1)); Core.subtract(imaginary, temporary, imaginary);
        Core.divide(real, denominator, real); Core.divide(imaginary, denominator, imaginary);
        Mat restoredSpectrum = new Mat(); Core.merge(Arrays.asList(real, imaginary), restoredSpectrum);
        Mat restored = new Mat(); Core.idft(restoredSpectrum, restored, Core.DFT_REAL_OUTPUT | Core.DFT_SCALE, 0);
        Mat cropped = restored.submat(pad, restored.rows() - pad, pad, restored.cols() - pad).clone(); clip(cropped, 0, 255);
        padded.release(); psf.release(); observedSpectrum.release(); transfer.release(); denominator.release();
        for (Mat mat : g) mat.release(); for (Mat mat : h) mat.release();
        real.release(); imaginary.release(); temporary.release(); restoredSpectrum.release(); restored.release();
        return cropped;
    }

    private DeskewResult deskew(Mat image) {
        Mat gray = new Mat(), edges = new Mat(), lines = new Mat();
        Imgproc.cvtColor(image, gray, Imgproc.COLOR_BGR2GRAY); Imgproc.Canny(gray, edges, 55, 155);
        int width = image.cols(), height = image.rows();
        Imgproc.HoughLinesP(edges, lines, 1, Math.PI / 720, Math.max(70, width / 12), Math.max(140, width / 5), Math.max(16, width / 80));
        List<Double> angles = new ArrayList<>();
        for (int i = 0; i < lines.rows(); i++) {
            double[] l = lines.get(i, 0); if (l == null || l.length < 4) continue;
            double angle = Math.toDegrees(Math.atan2(l[3] - l[1], l[2] - l[0]));
            double length = Math.hypot(l[2] - l[0], l[3] - l[1]);
            if (Math.abs(angle) <= 8) for (int n = 0; n < Math.max(1, Math.round(length / Math.max(1, width * .12))); n++) angles.add(angle);
        }
        gray.release(); edges.release(); lines.release();
        if (angles.size() < 5) return new DeskewResult(image, 0);
        Collections.sort(angles); double angle = angles.get(angles.size() / 2);
        if (Math.abs(angle) < .12 || Math.abs(angle) > 5) return new DeskewResult(image, 0);
        Mat matrix = Imgproc.getRotationMatrix2D(new Point(width / 2.0, height / 2.0), angle, 1);
        Mat rotated = new Mat(); Imgproc.warpAffine(image, rotated, matrix, new Size(width, height), Imgproc.INTER_CUBIC, Core.BORDER_CONSTANT, Scalar.all(255));
        matrix.release(); image.release(); return new DeskewResult(rotated, angle);
    }

    private double sharpnessScore(Mat image) {
        double scale = Math.min(1.0, 1600.0 / Math.max(image.cols(), image.rows()));
        Mat sample = new Mat(); Imgproc.resize(image, sample, new Size(Math.round(image.cols() * scale), Math.round(image.rows() * scale)), 0, 0, Imgproc.INTER_AREA);
        Mat gray = new Mat(), laplacian = new Mat(); Imgproc.cvtColor(sample, gray, Imgproc.COLOR_BGR2GRAY);
        int mx = Math.round(gray.cols() * .04f), my = Math.round(gray.rows() * .04f);
        Mat content = gray.submat(my, gray.rows() - my, mx, gray.cols() - mx);
        Imgproc.Laplacian(content, laplacian, CvType.CV_32F);
        MatOfDouble mean = new MatOfDouble(), std = new MatOfDouble(); Core.meanStdDev(laplacian, mean, std);
        double value = std.get(0, 0)[0] * std.get(0, 0)[0];
        content.release(); laplacian.release(); mean.release(); std.release(); gray.release(); sample.release(); return value;
    }

    private void applyFrameContact(Point[] points, Mat gray) {
        int width = gray.cols(), height = gray.rows(), sx = Math.max(3, width / 40), sy = Math.max(3, height / 40);
        Mat centre = gray.submat(height / 4, height * 3 / 4, width / 4, width * 3 / 4);
        double[] centreStats = stats(centre); centre.release();
        Mat[] strips = {gray.submat(0, sy, 0, width), gray.submat(0, height, width - sx, width), gray.submat(height - sy, height, 0, width), gray.submat(0, height, 0, sx)};
        boolean[] touches = new boolean[4];
        for (int i = 0; i < 4; i++) { double[] value = stats(strips[i]); touches[i] = value[0] >= centreStats[0] - 10 && value[1] <= centreStats[1] * .9 + 2; strips[i].release(); }
        if (touches[0]) { points[0].y = 0; points[1].y = 0; }
        if (touches[1]) { points[1].x = width - 1; points[2].x = width - 1; }
        if (touches[2]) { points[2].y = height - 1; points[3].y = height - 1; }
        if (touches[3]) { points[0].x = 0; points[3].x = 0; }
    }

    private double[] stats(Mat mat) {
        MatOfDouble mean = new MatOfDouble(), std = new MatOfDouble(); Core.meanStdDev(mat, mean, std);
        double[] result = {mean.get(0, 0)[0], std.get(0, 0)[0]}; mean.release(); std.release(); return result;
    }

    private Point[] order(Point[] points) {
        Point tl = points[0], tr = points[0], br = points[0], bl = points[0];
        double minSum = Double.MAX_VALUE, maxSum = -Double.MAX_VALUE, minDiff = Double.MAX_VALUE, maxDiff = -Double.MAX_VALUE;
        for (Point p : points) {
            double sum = p.x + p.y, diff = p.x - p.y;
            if (sum < minSum) { minSum = sum; tl = p; } if (sum > maxSum) { maxSum = sum; br = p; }
            if (diff > maxDiff) { maxDiff = diff; tr = p; } if (diff < minDiff) { minDiff = diff; bl = p; }
        }
        return new Point[]{new Point(tl.x, tl.y), new Point(tr.x, tr.y), new Point(br.x, br.y), new Point(bl.x, bl.y)};
    }

    private double polygonScore(Point[] points, int width, int height) {
        double areaRatio = polygonArea(points) / (width * (double) height);
        int borderHits = 0; for (Point p : points) if (p.x < 3 || p.y < 3 || p.x > width - 4 || p.y > height - 4) borderHits++;
        if (areaRatio < .16 || areaRatio > .985 || borderHits >= 3) return -1;
        double[] sides = new double[4]; for (int i = 0; i < 4; i++) sides[i] = distance(points[i], points[(i + 1) % 4]);
        if (Arrays.stream(sides).min().orElse(0) < Math.min(width, height) * .12) return -1;
        Point centre = centre(points);
        double centrePenalty = Math.abs(centre.x / width - .5) + Math.abs(centre.y / height - .5);
        double opposite = Math.min(sides[0], sides[2]) / Math.max(sides[0], sides[2]);
        opposite *= Math.min(sides[1], sides[3]) / Math.max(sides[1], sides[3]);
        return areaRatio * 2.4 + opposite * .45 - centrePenalty * .55;
    }

    private double polygonArea(Point[] p) {
        double area = 0; for (int i = 0; i < 4; i++) area += p[i].x * p[(i + 1) % 4].y - p[(i + 1) % 4].x * p[i].y;
        return Math.abs(area) / 2;
    }

    private Point centre(Point[] points) { double x = 0, y = 0; for (Point p : points) { x += p.x; y += p.y; } return new Point(x / 4, y / 4); }
    private double distance(Point a, Point b) { return Math.hypot(a.x - b.x, a.y - b.y); }
    private double clamp(double value, double low, double high) { return Math.max(low, Math.min(high, value)); }
    private double round(double value, int digits) { double factor = Math.pow(10, digits); return Math.round(value * factor) / factor; }
    private void clip(Mat mat, double low, double high) { Core.max(mat, Scalar.all(low), mat); Core.min(mat, Scalar.all(high), mat); }

    private static class DeskewResult {
        final Mat image; final double angle;
        DeskewResult(Mat image, double angle) { this.image = image; this.angle = angle; }
    }
}
