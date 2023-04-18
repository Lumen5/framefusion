import {
    describe, expect,
    it
} from 'vitest';
import { fileExistsSync } from 'tsconfig-paths/lib/filesystem';
import {DownloadURL} from "../src/DownloadURL";

describe('downloadUrl', () => {
    it.only('can download url', async () => {
        const url = 'https://storage.googleapis.com/lumen5-prod-images/countTo60.mp4';
        const downloadUrl = new DownloadURL(url);
        await downloadUrl.download();

        expect(fileExistsSync(downloadUrl.filepath)).to.be.true;
    });
});