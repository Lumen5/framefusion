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
import { BeamcoderExtractor } from '../src/backends/beamcoder';

declare global {
    // eslint-disable-next-line @typescript-eslint/no-namespace
    namespace jest {
        interface Matchers<R> {
            toMatchImageSnapshot(): R;
        }
    }
}

expect.extend({ toMatchImageSnapshot });

const FPS = 30.0;
const TEST_SERVER_PORT = 4242;
const TEST_VIDEO = './test/samples/bbb10m.mp4';
const TEST_VIDEO_SMALLER = './test/samples/bbb-smaller.mp4';
const TEST_VIDEO_LOW_FRAMERATE = './test/samples/bbb-low-fps.mp4';
const FRAME_SYNC_DELTA = (1 / FPS) / 2.0;

describe('FrameFusion', () => {
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
        const extractor = await BeamcoderExtractor.create({
            inputFileOrUrl: 'https://storage.googleapis.com/lumen5-prod-images/countTo60.mp4',
        });

        // Act and Assert
        expect(extractor.width).to.equal(24);
        expect(extractor.height).to.equal(24);

        // Cleanup
        await extractor.dispose();
    });

    it('can get duration', async() => {
        // Arrange
        const extractor = await BeamcoderExtractor.create({
            inputFileOrUrl: 'https://storage.googleapis.com/lumen5-prod-images/countTo60.mp4',
        });

        // Act and Assert
        expect(extractor.duration).to.equal(2);

        // Cleanup
        await extractor.dispose();
    });

    it('can identify video stream index', async() => {
        // Arrange
        const extractor = await BeamcoderExtractor.create({
            inputFileOrUrl: './test/samples/audio-is-stream0-video-is-stream1.mp4',
            threadCount: 8,
        });

        // Act and Assert
        for (let i = 0; i < 10; i++) {
            const frame = await extractor.getFrameAtTime(i / FPS + FRAME_SYNC_DELTA);
            expect(Math.floor(extractor.ptsToTime(frame.pts) * FPS)).to.equal(i);
        }

        // Cleanup
        await extractor.dispose();
    });

    it('can get all frames', async() => {
        // Arrange
        const extractor = await BeamcoderExtractor.create({
            inputFileOrUrl: 'https://storage.googleapis.com/lumen5-prod-images/countTo60.mp4',
        });

        // Act & assert
        for (let i = 0; i < 60; i++) {
            const frame = await extractor.getFrameAtTime(i / FPS + FRAME_SYNC_DELTA);
            expect(Math.floor(extractor.ptsToTime(frame.pts) * FPS)).to.equal(i);
        }

        // Cleanup
        await extractor.dispose();
    });

    describe('can set playbackRate', () => {
        it('low', async() => {
            // Arrange
            const extractor = await BeamcoderExtractor.create({
                inputFileOrUrl: TEST_VIDEO_SMALLER,
            });
            extractor.playbackRate = 0.5;

            for (let i = 0; i < 10; i++) {
                const time = i / FPS + FRAME_SYNC_DELTA;
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

        it('normal', async() => {
            // Arrange
            const extractor = await BeamcoderExtractor.create({
                inputFileOrUrl: TEST_VIDEO_SMALLER,
            });
            extractor.playbackRate = 1.0;

            for (let i = 0; i < 10; i++) {
                const time = i / FPS + FRAME_SYNC_DELTA;
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

        it('high', async() => {
            // Arrange
            const extractor = await BeamcoderExtractor.create({
                inputFileOrUrl: TEST_VIDEO_SMALLER,
            });
            extractor.playbackRate = 2.0;

            for (let i = 0; i < 10; i++) {
                const time = i / FPS + FRAME_SYNC_DELTA;
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

    it('can get all frames (low framerate)', async() => {
        // Arrange
        const extractor = await BeamcoderExtractor.create({
            inputFileOrUrl: TEST_VIDEO_LOW_FRAMERATE,
        });

        // Act & assert
        for (let i = 0; i < 5; i++) {
            const frame = await extractor.getFrameAtTime(i / FPS + FRAME_SYNC_DELTA);
            expect(Math.floor(extractor.ptsToTime(frame.pts) * 30)).to.be.closeTo(i, 15);
        }

        // Cleanup
        await extractor.dispose();
    });

    it('can get frames at random times (forward and backward)', async() => {
        // Arrange
        const extractor = await BeamcoderExtractor.create({
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

        // Cleanup
        await extractor.dispose();
    });

    it('can get the first 10 frames', async() => {
        // Arrange
        const extractor = await BeamcoderExtractor.create({
            inputFileOrUrl: 'https://storage.googleapis.com/lumen5-prod-images/countTo60.mp4',
        });

        // Act & assert
        // ensure we render the 2nd frame properly - if we read the next packet we'll draw 3 instead of 2
        for (let i = 0; i < 10; i++) {
            const time = i / FPS + FRAME_SYNC_DELTA;
            const imageData = await extractor.getImageDataAtTime(time);
            if (!imageData) {
                continue;
            }
            const canvas = createCanvas(imageData.width, imageData.height);
            const ctx = canvas.getContext('2d');
            ctx.putImageData(imageData, 0, 0);
            expect(canvas.toBuffer('image/png')).toMatchImageSnapshot();
        }

        // Cleanup
        await extractor.dispose();
    });

    it('can get the middle 10 frames', async() => {
        // Arrange
        // This test is pretty slow because our countTo60 video only has 1 I-frame. We have to run through all packets
        // to get the last ones.
        const extractor = await BeamcoderExtractor.create({
            inputFileOrUrl: 'https://storage.googleapis.com/lumen5-prod-images/countTo60.mp4',
        });

        // Act & assert
        // ensure we render the last few frames properly - we have to flush the decoder to get the last few frames
        for (let i = 20; i < 30; i++) {
            const time = i / FPS + FRAME_SYNC_DELTA;
            const imageData = await extractor.getImageDataAtTime(time);
            if (!imageData) {
                continue;
            }
            const canvas = createCanvas(imageData.width, imageData.height);
            const ctx = canvas.getContext('2d');
            ctx.putImageData(imageData, 0, 0);
            expect(canvas.toBuffer('image/png')).toMatchImageSnapshot();
        }

        // Cleanup
        await extractor.dispose();
    });

    it('can get the last 10 frames', async() => {
        // Arrange
        // This test is pretty slow because our countTo60 video only has 1 I-frame. We have to run through all packets
        // to get the last ones.
        const extractor = await BeamcoderExtractor.create({
            inputFileOrUrl: 'https://storage.googleapis.com/lumen5-prod-images/countTo60.mp4',
        });

        // Act & assert
        // ensure we render the last few frames properly - we have to flush the decoder to get the last few frames
        for (let i = 50; i < 60; i++) {
            const time = i / FPS + FRAME_SYNC_DELTA;
            const imageData = await extractor.getImageDataAtTime(time);
            if (!imageData) {
                continue;
            }
            const canvas = createCanvas(imageData.width, imageData.height);
            const ctx = canvas.getContext('2d');
            ctx.putImageData(imageData, 0, 0);
            expect(canvas.toBuffer('image/png')).toMatchImageSnapshot();
        }

        // Cleanup
        await extractor.dispose();
    });

    // we want to skip this test in CI because it's slow
    // PERFORMANCE TEST - 158.568ms or 5.2856ms per frame
    it.skip('playback HD video', async() => {
        let duration = 0;
        const samples = 250;
        for (let i = 0; i < samples; i++) {
            // Arrange
            // here we make small currentTime increments, mimicking playback
            const extractor = await BeamcoderExtractor.create({
                inputFileOrUrl: TEST_VIDEO,
            });

            // Act & assert
            const start = Date.now();
            for (let i = 0; i < 60; i++) {
                const time = i / FPS + FRAME_SYNC_DELTA;
                await extractor.getFrameAtTime(time);
            }
            const end = Date.now();
            duration += end - start;

            // Cleanup
            await extractor.dispose();
        }
    }, 100000);
});
