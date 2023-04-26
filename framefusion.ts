import { BeamcoderExtractor } from './src/backends/beamcoder.js';

export type Frame = {
    pts: number;
    data: Array<Buffer>;
    width: number;
    height: number;
};

export type InterpolateMode = 'fast' | 'high-quality';

export type ExtractorArgs = {
    inputFileOrUrl?: string;
    outputFile?: string;
    threadCount?: number;
    endTime?: number;
    interpolateFps?: number;
    interpolateMode?: InterpolateMode;
    // ffmpeg:    https://ffmpeg.org/doxygen/trunk/pixfmt_8h.html#a9a8e335cf3be472042bc9f0cf80cd4c5
    // gstreamer: https://gstreamer.freedesktop.org/documentation/video/video-format.html?gi-language=c#GstVideoFormat
};

export interface Extractor {
    // There is also a static "create" method, but typescript does not like it.
    // create(args: ExtractorArgs): Promise<Extractor>;

    init(_args: ExtractorArgs): Promise<void>;

    get duration(): number;

    get width(): number;

    get height(): number;

    getFrameAtTime(targetTime: number): Promise<Frame>;

    getFrameImageDataAtTime(targetTime: number): Promise<ImageData>;

    dispose(): Promise<void>;
}

//
//  - Debugging -
//
// It can be useful to test code directly here and run it with:
//
//     yarn run dev
//
// Or, with chrome/vs code debugging:
//
//     yarn run debug
//
// And then visit chrome:///inspect, you should see an entry for this script.
//
// Example:
//
// const TEST_VIDEO = './samples/bbb10m.mp4';
// export const run = async() => {
//     // Arrange
//     const extractor = await BeamcoderExtractor.create({
//         inputFileOrUrl: TEST_VIDEO,
//     });
//
//     const frame = await extractor.getFrameImageDataAtTime(0.3);
//     console.log(frame);
//     extractor.dispose();
// };
//
// run();
//

export { BeamcoderExtractor };
