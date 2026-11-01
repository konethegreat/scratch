export function downloadBytes(bytes, fileName, {
  document: doc = globalThis.document,
  url = globalThis.URL,
  Blob: BlobCtor = globalThis.Blob,
  setTimeout: later = globalThis.setTimeout,
  type = 'application/pdf'
} = {}) {
  const blobUrl = url.createObjectURL(new BlobCtor([bytes], { type }));
  const link = doc.createElement('a');
  link.href = blobUrl;
  link.download = fileName;
  link.click();
  later(() => url.revokeObjectURL(blobUrl), 2000);
}
