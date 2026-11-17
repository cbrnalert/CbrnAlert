/** Chrome's direct file writer avoids the download manager's temporary-file rename. */
export interface ExportFileHandle {
  createWritable(): Promise<{
    write(data: Blob): Promise<void>;
    close(): Promise<void>;
    abort(): Promise<void>;
  }>;
}

type SavePicker = (options: {
  suggestedName: string;
  types: {description: string; accept: Record<string, string[]>}[];
}) => Promise<ExportFileHandle>;

export function exportFilename(extension: string): string {
  return `cbrnalert-map-${new Date().toISOString().replace(/[:.]/g, '-')}.${extension}`;
}

// Invoke synchronously from the camera/stop click while user activation is live.
// undefined uses the normal browser download; null means the user canceled.
export async function chooseExportFile(extension: string, mime: string): Promise<ExportFileHandle | null | undefined> {
  const picker = (window as Window & {showSaveFilePicker?: SavePicker}).showSaveFilePicker;
  if (!picker || !window.isSecureContext || !navigator.userActivation?.isActive) return undefined;
  try {
    return await picker.call(window, {
      suggestedName: exportFilename(extension),
      types: [{description: extension === 'png' ? 'PNG image' : 'Video', accept: {[mime.split(';')[0]]: [`.${extension}`]}}]
    });
  } catch (error) {
    if ((error as DOMException).name === 'AbortError') return null;
    // Restricted browser contexts can still use a normal named download.
    if (['SecurityError', 'NotAllowedError'].includes((error as DOMException).name)) return undefined;
    throw error;
  }
}

export async function writeExportFile(handle: ExportFileHandle, blob: Blob): Promise<void> {
  const writer = await handle.createWritable();
  try {
    await writer.write(blob);
    // The file is not finalized until close resolves.
    await writer.close();
  } catch (error) {
    try { await writer.abort(); } catch { /* Preserve the original write error. */ }
    throw error;
  }
}
