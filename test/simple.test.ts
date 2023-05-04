import {
    describe,
    it,
    expect,
    afterAll,
    beforeAll
} from 'vitest';
import { toMatchImageSnapshot } from 'jest-image-snapshot';
import { createCanvas } from 'canvas';
import httpServer from 'http-server';
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

const TEST_SERVER_PORT = 4242;
const FRAME_SYNC_DELTA = (1 / 30.0) / 2.0;

describe('simple', () => {
    let server;

    beforeAll(async() => {
        server = httpServer.createServer();
        await new Promise<void>(resolve => {
            server.listen({
                port: TEST_SERVER_PORT,
            }, () => {
                console.log(`Server running on port ${TEST_SERVER_PORT}`);
                resolve();
            });
        });
    });

    afterAll(() => {
        server.close();
    });

    it('can get dimensions', async() => {
        // Arrange
        const extractor = await SimpleExtractor.create({
            inputFileOrUrl: 'https://storage.googleapis.com/lumen5-prod-images/countTo60.mp4',
        });

        // Act and Assert
        expect(extractor.width).to.equal(24);
        expect(extractor.height).to.equal(24);
    });

    it('can get duration', async() => {
        // Arrange
        const extractor = await SimpleExtractor.create({
            inputFileOrUrl: 'https://storage.googleapis.com/lumen5-prod-images/countTo60.mp4',
        });

        // Act and Assert
        expect(extractor.duration).to.equal(2);
    });

    it('can identify video stream', async() => {
        const extractor = await SimpleExtractor.create({
            inputFileOrUrl: './test/samples/audio-is-stream0-video-is-stream1.mp4',
            threadCount: 8,
        });

        for (let i = 0; i < 10; i++) {
            const frame = await extractor.getFrameAtTime(i / 30.0 + FRAME_SYNC_DELTA);
            expect(Math.floor(extractor.ptsToTime(frame.pts) * 30)).to.equal(i);
        }
    });

    it('can get frames at random times', async() => {
        // Arrange
        const extractor = await SimpleExtractor.create({
            inputFileOrUrl: 'https://storage.googleapis.com/lumen5-prod-images/countTo60.mp4',
        });
        const times_to_get = [
            1, // forward to 30
            0, // backwards to 15
            1.5, // forward to 45
            0.5, // backward to 15
        ];

        // Act and Assert
        for (let i = 0; i < times_to_get.length; i++) {
            const imageData = await extractor.getImageDataAtTime(times_to_get[i]);
            if (!imageData) {
                continue;
            }
            const canvas = createCanvas(imageData.width, imageData.height);
            const ctx = canvas.getContext('2d');
            ctx.putImageData(imageData, 0, 0);
            expect(canvas.toBuffer('image/png')).toMatchImageSnapshot();
        }
    });

    it('can get the first 10 frames', async() => {
        // Arrange
        const extractor = await SimpleExtractor.create({
            inputFileOrUrl: 'https://storage.googleapis.com/lumen5-prod-images/countTo60.mp4',
        });

        // Act & assert
        // ensure we render the 2nd frame properly - if we read the next packet we'll draw 3 instead of 2
        for (let i = 0; i < 10; i++) {
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

    it('can get the middle 10 frames', async() => {
        // Arrange
        // This test is pretty slow because our countTo60 video only has 1 I-frame. We have to run through all packets
        // to get the last ones.
        const extractor = await SimpleExtractor.create({
            inputFileOrUrl: 'https://storage.googleapis.com/lumen5-prod-images/countTo60.mp4',
        });

        // Act & assert
        // ensure we render the last few frames properly - we have to flush the decoder to get the last few frames
        for (let i = 20; i < 30; i++) {
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

    it('can get the last 10 frames', async() => {
        // Arrange
        // This test is pretty slow because our countTo60 video only has 1 I-frame. We have to run through all packets
        // to get the last ones.
        const extractor = await SimpleExtractor.create({
            inputFileOrUrl: 'https://storage.googleapis.com/lumen5-prod-images/countTo60.mp4',
        });

        // Act & assert
        // ensure we render the last few frames properly - we have to flush the decoder to get the last few frames
        for (let i = 50; i < 60; i++) {
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
