/** Private objects always use a separate bucket; the key records its routing. */
export function isPrivateStorageKey(key: string): boolean {
  return /^(kyc|exports|private)\//.test(key);
}
export function storageKey(key: string, isPublic = true): string {
  if (
    !key ||
    key.length > 1024 ||
    key.includes("%") ||
    key.startsWith("/") ||
    key.split("/").some((part) => part === ".." || part === ".") ||
    /[\\\u0000-\u001f]/.test(key)
  )
    throw new Error("Invalid storage key");
  return !isPublic && !isPrivateStorageKey(key) ? `private/${key}` : key;
}

export function storagePath(key: string): string {
  return storageKey(key).split("/").map(encodeURIComponent).join("/");
}
