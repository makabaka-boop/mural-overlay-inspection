/**
 * 本地图片文件校验与解码。
 * 只读取用户本地文件：魔数嗅探限定 PNG/JPEG，解码失败即视为损坏。
 */

export type ImageFormat = 'png' | 'jpeg';

/** 按文件头魔数识别格式；无法识别返回 null */
export function sniffFormat(bytes: Uint8Array): ImageFormat | null {
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return 'png';
  }
  // JPEG: FF D8 FF
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'jpeg';
  }
  return null;
}

export type LoadErrorKind = 'format' | 'decode';

export class ImageLoadError extends Error {
  readonly kind: LoadErrorKind;
  constructor(kind: LoadErrorKind, message: string) {
    super(message);
    this.name = 'ImageLoadError';
    this.kind = kind;
  }
}

export interface LoadedImage {
  bitmap: ImageBitmap;
  width: number;
  height: number;
  name: string;
}

/** 校验格式并解码为 ImageBitmap；抛出 ImageLoadError 指明原因 */
export async function decodeImageFile(file: File): Promise<LoadedImage> {
  const header = new Uint8Array(await file.slice(0, 8).arrayBuffer());
  const format = sniffFormat(header);
  if (format === null) {
    throw new ImageLoadError('format', '非 PNG/JPEG 格式');
  }
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new ImageLoadError('decode', '文件损坏或无法解码');
  }
  return { bitmap, width: bitmap.width, height: bitmap.height, name: file.name };
}
