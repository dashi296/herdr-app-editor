// Which files the editor shows as a picture instead of text.
// The list is what the host's image() displayed in spike S13 (docs/spikes/2026-11-23-s13-image.md):
// avif and heic stayed blank, and .svg is left out on purpose so it stays editable as text.

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp", "tif", "tiff"]);

export function isImagePath(path: string): boolean {
  const name = path.split(/[\\/]/).pop() ?? "";
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return false;
  return IMAGE_EXTENSIONS.has(name.slice(dot + 1).toLowerCase());
}
