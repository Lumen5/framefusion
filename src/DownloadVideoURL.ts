import path from 'path';
import type { ClientRequest } from 'http';

import { Writable } from 'stream';
import tmp from 'tmp';
import fs from 'fs-extra';

/**
 * Downloads a video file from a given URL as a temporary file. When the object is cleared, the temporary file is
 * deleted.
 */
export class DownloadVideoURL {
    #url: string | undefined;
    #httpRequest: ClientRequest | undefined = undefined;
    #filepath: string;
    #tmpObj: tmp.FileResult | undefined = undefined;

    constructor(url: string) {
        this.#url = url;

        const extension = path.extname(url);
        this.#tmpObj = tmp.fileSync({ postfix: extension });
        this.#filepath = this.#tmpObj.name;
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
        const source = this.#url;
        try {
            const response = await fetch(source);
            if (!response.ok) {
                throw new Error(
                    `Failed to fetch ${source}, status: ${response.status}`
                );
            }

            const contentType = response.headers.get('content-type');
            if (!contentType || !contentType.includes('video')) {
                throw new Error(
                    `Source ${source}, returned unsupported content type ${contentType}`
                );
            }

            const writeStream = fs.createWriteStream(this.#tmpObj.name);
            const readableStream = response.body;

            if (!readableStream) {
                throw new Error(`Response body is null for ${source}`);
            }

            await new Promise<void>((resolve, reject) => {
                readableStream.pipeTo(Writable.toWeb(writeStream));
                writeStream.on('finish', () => {
                    writeStream.close();
                    this.#filepath = this.#tmpObj.name;
                    resolve();
                });
                writeStream.on('error', (e) => {
                    reject(e);
                });
            });
        }
        catch (e) {
            throw e;
        }
    }

    clear() {
        if (this.#tmpObj) this.#tmpObj.removeCallback();
        if (this.#url) this.#url = undefined;
        if (this.#httpRequest) this.#httpRequest = null;
        if (this.#filepath) this.#filepath = undefined;
    }
}
