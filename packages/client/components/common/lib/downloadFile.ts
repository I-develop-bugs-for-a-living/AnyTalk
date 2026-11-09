/**
 * Save a file to the viewer's device
 * @param data Contents
 * @param type Media type
 * @param name File name
 */
export function downloadFile(data: BlobPart, type: string, name: string) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}
