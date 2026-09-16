async function blobToBase64(blob) {
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error('PDF 数据读取失败'));
    reader.readAsDataURL(blob);
  });
  return String(dataUrl).split(',')[1];
}

export async function savePdfNatively(blob, fileName) {
  if (!globalThis.Capacitor?.isNativePlatform?.()) return null;
  const PdfSave = globalThis.Capacitor.registerPlugin('PdfSave');
  return PdfSave.save({ fileName, data: await blobToBase64(blob) });
}

export async function sharePdfNatively(blob, fileName, title) {
  if (!globalThis.Capacitor?.isNativePlatform?.()) return false;
  const [{ Filesystem, Directory }, { Share }] = await Promise.all([
    import('@capacitor/filesystem'),
    import('@capacitor/share'),
  ]);
  const written = await Filesystem.writeFile({
    path: `exports/${fileName}`,
    data: await blobToBase64(blob),
    directory: Directory.Cache,
    recursive: true,
  });
  await Share.share({
    title,
    dialogTitle: '保存或分享 PDF',
    files: [written.uri],
  });
  return true;
}
