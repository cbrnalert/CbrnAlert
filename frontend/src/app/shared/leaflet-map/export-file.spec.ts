import { ExportFileHandle, writeExportFile } from './export-file';

describe('Export file finalization', () => {
  it('waits for the entire blob write before closing the destination', async () => {
    const events: string[] = [];
    const handle: ExportFileHandle = {createWritable: async () => ({
      write: async (blob: Blob) => { events.push(`write:${blob.size}`); },
      close: async () => { events.push('close'); },
      abort: async () => { events.push('abort'); }
    })};
    await writeExportFile(handle, new Blob(['video']));
    expect(events).toEqual(['write:5', 'close']);
  });

  it('aborts a failed write and reports the original error', async () => {
    const error = new Error('Disk write failed');
    const close = jasmine.createSpy('close').and.returnValue(Promise.resolve());
    const abort = jasmine.createSpy('abort').and.returnValue(Promise.resolve());
    const handle: ExportFileHandle = {createWritable: async () => ({
      write: async () => { throw error; }, close, abort
    })};
    await expectAsync(writeExportFile(handle, new Blob(['video']))).toBeRejectedWith(error);
    expect(abort).toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
  });
});
