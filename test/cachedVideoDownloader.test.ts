import {
    describe, expect,
    it
} from 'vitest';
import { fileExistsSync } from 'tsconfig-paths/lib/filesystem';
import { CachedVideoDownloader } from '../src/cachedVideoDownloader';

describe('cachedVideoDownloader', () => {
    it('can download url', async() => {
        const url = 'https://storage.googleapis.com/lumen5-prod-images/countTo60.mp4';
        const downloader = new CachedVideoDownloader();
        const resource = downloader.get(url);
        await resource.download();

        expect(fileExistsSync(resource.filepath as string)).to.be.true;
    }, 10000);

    it('deletes file when cleared', async() => {
        const url = 'https://storage.googleapis.com/lumen5-prod-images/countTo60.mp4';
        const downloader = new CachedVideoDownloader();
        const resource = downloader.get(url);
        await resource.download();
        const filepath = resource.filepath as string;

        resource.destroy();
        expect(fileExistsSync(filepath)).to.be.false;
    }, 10000);


    it('returns cached temp file for the same url', async() => {
        const url = 'https://storage.googleapis.com/lumen5-prod-images/countTo60.mp4';
        const downloader = new CachedVideoDownloader();
        const resource1 = downloader.get(url);
        await resource1.download();
        const filepath = resource1.filepath as string;

        const resource2 = downloader.get(url);
        await resource2.download();
        const filepath2 = resource2.filepath as string;

        expect(filepath).to.equal(filepath2);
        expect(fileExistsSync(filepath)).to.be.true;

        resource1.destroy();
        expect(fileExistsSync(filepath)).to.be.true;

        resource2.destroy();
        expect(fileExistsSync(filepath)).to.be.false;
    }, 10000);
});
