export async function sharePdfNatively(blob, fileName, title) {
  if (!globalThis.Capacitor?.isNativePlatform?.()) return false;
  const [{ Filesystem, Directory }, { Share }] = await Promise.all([
    import('@capacitor/filesystem'),
    import('@capacitor/share'),
  ]);
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error('PDF 数据读取失败'));
    reader.readAsDataURL(blob);
  });
  const written = await Filesystem.writeFile({
    path: `exports/${fileName}`,
    data: String(dataUrl).split(',')[1],
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
