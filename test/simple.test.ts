import {
    describe,
    it,
    expect
} from 'vitest';
import { toMatchImageSnapshot } from 'jest-image-snapshot';
import { createCanvas } from 'canvas';
import { SimpleExtractor } from '../src/backends/simple';

declare global {
    // eslint-disable-next-line @typescript-eslint/no-namespace
    namespace jest {
        interface Matchers<R> {
            toMatchImageSnapshot(): R;
        }
    }
}

expect.extend({ toMatchImageSnapshot });

describe('simple', () => {
    it('can get frame', async() => {
        const extractor = await SimpleExtractor.create({
            inputFileOrUrl: 'https://storage.googleapis.com/lumen5-prod-images/countTo60.mp4',
        });
        const FRAME_SYNC_DELTA = (1 / 30.0) / 2.0;

        // Act & assert
        // this tests a few tricky situations:
        // 1. ensures we render the 2nd frame properly - if we read the next packet we'll draw 3 instead of 2
        // 2. ensures we render the last few frames properly - we have to flush the decoder to get the last few frames
        for (let i = 0; i < 60; i++) {
            const time = i / 30.0 + FRAME_SYNC_DELTA;
            const imageData = await extractor.getImageDataAtTime(time);
            if (!imageData) {
                continue;
            }
            const canvas = createCanvas(imageData.width, imageData.height);
            const ctx = canvas.getContext('2d');
            ctx.putImageData(imageData, 0, 0);
            expect(canvas.toBuffer('image/png')).toMatchImageSnapshot();
        }
    });
});
