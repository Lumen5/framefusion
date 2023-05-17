import path from 'path';
import https from 'node:https';
import type { ClientRequest } from 'http';
import http from 'http';
import tmp from 'tmp';
import fs from 'fs-extra';

class CancelRequestError extends Error { }

/**
 * Downloads a video file from a given URL as a temporary file. When the object is cleared, the temporary file is
 * deleted.
 */
export class DownloadVideoURL {
    #url: string | undefined;
    #httpRequest: ClientRequest | undefined = undefined;
    #filepath: string | undefined = undefined;
    #tmpObj: tmp.FileResult | undefined = undefined;

    constructor(url: string) {
        this.#url = url;
    }

    /**
     * returns the filepath of the downloaded file. If the file has not been downloaded yet, it will be undefined
     */
    get filepath() {
        return this.#filepath;
    }

    /**
     * Downloads the file from the given URL. The file will be downloaded to a temporary file.
     */
    async download() {
        await new Promise<void>((resolve, reject) => {
            const source = this.#url;
            const extension = path.extname(source);
            this.#tmpObj = tmp.fileSync({ postfix: extension });
            try {
                const connectionHandler = source.startsWith('https://') ? https : http;
                this.#httpRequest = connectionHandler.get(source, (res) => {
                    const contentType = res.headers['content-type'];
                    if (!contentType.includes('video')) {
                        const err = new Error(`Source ${source}, returned unsupported content type ${contentType}`);
                        reject(err);
                        return;
                    }
                    const writeStream = fs.createWriteStream(this.#tmpObj.name);
                    res.pipe(writeStream);
                    writeStream.on('finish', () => {
                        writeStream.close();
                        this.#filepath = this.#tmpObj.name;
                        resolve();
                    });
                    writeStream.on('error', (e) => {
                        reject(e);
                    });
                });
                this.#httpRequest.on('error', (e) => {
                    if (e instanceof CancelRequestError) {
                        return;
                    }
                    reject(e);
                });
            }
            catch (e) {
                reject(e);
            }
        });
    }

    clear() {
        if (this.#tmpObj) this.#tmpObj.removeCallback();
        if (this.#url) this.#url = undefined;
        if (this.#httpRequest) this.#httpRequest = null;
        if (this.#filepath) this.#filepath = undefined;
    }
}
