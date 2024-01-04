import type {
    ExtractorArgs,
    Frame,
    Extractor
} from '../framefusion';
import type { ImageData } from './types';


export class BaseExtractor implements Extractor {
    static async create(args: ExtractorArgs): Promise<Extractor> {
        throw new Error('Not implemented');
    }

    async init({
        inputFileOrUrl,
        outputFile,
        threadCount = 8,
        endTime,
        interpolateFps,
        interpolateMode,
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

    async seekToPTS(targetPts: number) {
        throw new Error('Not implemented');
    }

    async getFrameAtTime(targetTime: number): Promise<Frame> {
        throw new Error('Not implemented');
    }

    async getImageDataAtTime(targetTime: number): Promise<ImageData> {
        throw new Error('Not implemented');
    }

    async getFrameAtPts(targetPts: number): Promise<Frame> {
        throw new Error('Not implemented');
    }

    async seekToTime(targetTime: number) {
        throw new Error('Not implemented');
    }

    /**
     * Convert a PTS (based on timebase) to PTS (in seconds)
     */
    ptsToTime(pts: number) {
        throw new Error('Not implemented');
    }

    async readFrames({
        onFrameAvailable,
        flush = true,
    }: {
        /**
         * Return true if we need to read more frames.
         */
        onFrameAvailable?: (frame: Frame) => Promise<boolean> | boolean;
        flush?: boolean;
    } = {
        flush: true,
        onFrameAvailable: () => true,
    }) {
        throw new Error('Not implemented');
    }

    async dispose() {
        throw new Error('Not implemented');
    }
}
