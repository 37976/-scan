# 掌上扫描 PocketScan

一个本地优先、可安装到手机桌面的文档扫描 PWA。支持拍照或多图导入、四角调整、透视矫正、文档增强、多页管理，以及 PDF 导出。

## 本地运行

```bash
npm install
npm run dev
```

Web 前端没有 npm 运行依赖，因此可以直接执行 `npm run dev`。默认地址为 `http://localhost:4173`。

最新精修流程依赖本机的 Python、NumPy 与 OpenCV。运行 `npm run dev` 后，由本地接口完成四角检测、残余倾斜校正、光照归一化和扫描质感恢复。

在电脑访问终端显示的地址。手机访问时，相机和离线安装能力需要 HTTPS；部署到任意静态 HTTPS 站点即可。

## Android 64 位 APK

Android 版本使用 Capacitor 8 和 OpenCV 4.14，原生扫描处理只打包 `arm64-v8a`，适用于主流 64 位安卓手机。

准备 Node.js 22、JDK 21 和 Android SDK 36 后执行：

```bash
npm ci
npm run android:debug
```

可直接安装的调试包位于：

```text
android/app/build/outputs/apk/debug/app-debug.apk
```

每次推送到 `main`，GitHub Actions 也会自动构建 `pocketscan-arm64-debug`，可以从仓库 Actions 对应任务的 Artifacts 下载。正式上架应用商店前，还需要创建并妥善保管自己的签名密钥，再执行 `npm run android:release`。

## 已实现

- 手机后置相机与相册多选
- 导入或拍照后用 OpenCV 自动识别纸张四角并显示置信度；识别失败时回退到安全边距，始终支持手动拖动微调
- 自动分割纸张区域、识别四角并通过单应性变换修正斜拍造成的梯形透视畸变
- 唯一的最新精修流程：透视展开后校正残余倾斜、自动检测低清晰度鬼影并保守反卷积、均衡背景光照、压低阴影与褶皱，并保留连续表格线、原始字迹、印章和自然扫描质感
- 多页排序、旋转、删除、重新裁剪
- IndexedDB 本地自动保存
- A4 或原图尺寸 PDF，支持页边距及系统分享
- Service Worker 离线缓存与 PWA 安装

## 隐私

PDF 生成始终在本地完成。Android 版的四角检测、透视校正和精修由手机内置 OpenCV 原生处理，不上传图片；电脑浏览器开发版则通过同一台电脑上的本地 Node/Python 服务处理，临时文件会在每次处理后删除。
