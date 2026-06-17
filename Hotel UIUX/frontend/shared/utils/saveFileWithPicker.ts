export function supportsSaveFilePicker(): boolean {
  try {
    return typeof (window as Window & { showSaveFilePicker?: unknown }).showSaveFilePicker === 'function';
  } catch {
    return false;
  }
}

type SavePickerType = {
  description: string;
  accept: Record<string, string[]>;
};

export async function saveBlobWithPicker(
  blob: Blob,
  suggestedName: string,
  types: SavePickerType[],
): Promise<'saved' | 'cancelled'> {
  const anyWindow = window as Window & {
    showSaveFilePicker?: (options: {
      suggestedName: string;
      types: SavePickerType[];
    }) => Promise<FileSystemFileHandle>;
  };

  if (typeof anyWindow.showSaveFilePicker === 'function') {
    try {
      const handle = await anyWindow.showSaveFilePicker({ suggestedName, types });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return 'saved';
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        return 'cancelled';
      }
      throw error;
    }
  }

  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = suggestedName;
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
  return 'saved';
}
