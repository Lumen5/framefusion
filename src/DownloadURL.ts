import tmp from 'tmp';
const fs = require('fs-extra');
import path from "path";
import https from "node:https";
import {ClientRequest} from "node:http";
import http from "http";

class CancelRequestError extends Error { };

export class DownloadURL {
    #url: string;
    #httpRequest: ClientRequest = null;
    #cachedSource: string | undefined = undefined;

    constructor(url) {
        this.#url = url;
    }

    get filepath() {
        return this.#cachedSource;
    }

    async download() {
        await new Promise<void>((resolve, reject) => {
            const source = this.#url;
            const extension = path.extname(source);
            const tmpobj = tmp.fileSync({ postfix: extension });
            try {
                const connectionHandler = source.startsWith('https://') ? https : http;
                this.#httpRequest = connectionHandler.get(source, (res) => {
                    const contentType = res.headers['content-type'];
                    if (!contentType.includes('video')) {
                        const err = new Error(`Source ${source}, returned unsupported content type ${contentType}`);
                        reject(err);
                        return;
                    }
                    const writeStream = fs.createWriteStream(tmpobj.name);
                    res.pipe(writeStream);
                    writeStream.on('finish', () => {
                        writeStream.close();
                        this.#cachedSource = tmpobj.name;
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
}