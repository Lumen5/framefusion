import { DownloadVideoURL } from './DownloadVideoURL';

interface CachedResource {
    url: string;
    filepath: string | undefined;
    download(): Promise<void>;
    destroy(): void;
}

interface CacheEntry {
    downloader: DownloadVideoURL;
    refCount: number;
    downloadPromise?: Promise<void>;
}

export class CachedVideoDownloader {
    #cache: Map<string, CacheEntry> = new Map();

    get(url: string): CachedResource {
        // eslint-disable-next-line @typescript-eslint/no-this-alias
        const self = this;

        let filepath: string | undefined;

        return {
            url,
            get filepath() {
                return filepath;
            },

            async download() {
                let entry = self.#cache.get(url);

                if (entry) {
                    entry.refCount += 1;

                    // Wait for in-progress download if exists
                    if (entry.downloadPromise) {
                        await entry.downloadPromise;
                    }
                }
                else {
                    const downloader = new DownloadVideoURL(url);

                    const promise = downloader.download();
                    entry = {
                        downloader,
                        refCount: 1,
                        downloadPromise: promise,
                    };
                    self.#cache.set(url, entry);

                    try {
                        await promise;
                    }
                    finally {
                        entry.downloadPromise = undefined; // Clear after completion
                    }
                }

                filepath = self.#cache.get(url).downloader.filepath;
            },

            destroy() {
                const entry = self.#cache.get(url);
                if (!entry) return;

                entry.refCount -= 1;

                if (entry.refCount <= 0) {
                    entry.downloader.clear();
                    self.#cache.delete(url);
                }

                filepath = undefined;
            },
        };
    }
}
