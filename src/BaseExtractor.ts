import type { ImageData } from 'canvas';

import type {
    ExtractorArgs,
    Frame,
    Extractor
} from '../framefusion';

export class BaseExtractor implements Extractor {
    static async create(args: ExtractorArgs): Promise<Extractor> {
        throw new Error('Not implemented');
    }

    async init({
        inputFileOrUrl,
        threadCount = 8,
    }: ExtractorArgs): Promise<void> {
        throw new Error('Not implemented');
    }

    get duration(): number {
        throw new Error('Not implemented');
    }

    get width(): number {
        throw new Error('Not implemented');
    }

    get height(): number {
        throw new Error('Not implemented');
    }

    async getFrameAtTime(targetTime: number): Promise<Frame> {
        throw new Error('Not implemented');
    }

    async getImageDataAtTime(targetTime: number): Promise<ImageData> {
        throw new Error('Not implemented');
    }

    /**
     * Convert a PTS (based on timebase) to PTS (in seconds)
     */
    ptsToTime(pts: number) {
        throw new Error('Not implemented');
    }

    async dispose() {
        throw new Error('Not implemented');
    }
}
