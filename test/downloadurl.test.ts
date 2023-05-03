import {
    describe, expect,
    it
} from 'vitest';
import { fileExistsSync } from 'tsconfig-paths/lib/filesystem';
import { DownloadVideoURL } from '../src/DownloadVideoURL';

describe('downloadUrl', () => {
    it('can download url', async() => {
        const url = 'https://storage.googleapis.com/lumen5-prod-images/countTo60.mp4';
        const downloadUrl = new DownloadVideoURL(url);
        await downloadUrl.download();

        expect(fileExistsSync(downloadUrl.filepath)).to.be.true;
    }, 10000);

    it('deletes file when cleared', async() => {
        const url = 'https://storage.googleapis.com/lumen5-prod-images/countTo60.mp4';
        const downloadUrl = new DownloadVideoURL(url);
        await downloadUrl.download();
        const filepath = downloadUrl.filepath;

        downloadUrl.clear();
        expect(fileExistsSync(filepath)).to.be.false;
    }, 10000);
});
