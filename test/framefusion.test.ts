import {
    describe,
    it,
    expect,
    afterAll,
    beforeAll
} from 'vitest';
import { toMatchImageSnapshot } from 'jest-image-snapshot';
import { createCanvas, createImageData } from 'canvas';
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
const TEST_VIDEO_COUNT_0_TO_179 = './test/samples/count0To179.mp4';
const TEST_VIDEO_LOW_FRAMERATE = './test/samples/bbb-low-fps.mp4';

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

    it('can get duration from mp4', async() => {
        // Arrange
        const extractor = await BeamcoderExtractor.create({
            inputFileOrUrl: 'https://storage.googleapis.com/lumen5-prod-images/countTo60.mp4',
        });

        // Act and Assert
        expect(extractor.duration).to.equal(2);

        // Cleanup
        await extractor.dispose();
    });

    it('can get duration from webm', async() => {
        // Arrange
        const extractor = await BeamcoderExtractor.create({
            inputFileOrUrl: 'https://storage.googleapis.com/lumen5-prod-video/anita-6uTzyZtNRKztypC.webm',
        });

        // Act and Assert
        expect(extractor.duration).to.equal(115.248);

        // Cleanup
        await extractor.dispose();
    });

    it('can get duration when audio stream is longer than video stream', async() => {
        // Arrange
        const extractor = await BeamcoderExtractor.create({
            inputFileOrUrl: 'https://storage.googleapis.com/lumen5-prod-video/fixed_tmpRjwSJC.mp4',
        });

        // Act
        expect(extractor.duration).to.equal(12.92);

        // Cleanup
        await extractor.dispose();
    });

    it('only reads a few packets to get the next frame after a seek', async() => {
        const extractor = await BeamcoderExtractor.create({
            inputFileOrUrl: 'https://storage.googleapis.com/lumen5-prod-video/mvc-4k-new-orleans-a053c0340725rv-112014WA74Rf.mp4',
        });

        const offset = 1.0 * FPS;
        for (let i = offset; i < offset + 10; i++) {
            const time = i / FPS;
            await extractor.getFrameAtTime(time);

            // for the first frame query we have to find the closest PTS and read several packets to get the closest
            // frame, after that we should only have to read a few packets
            if (i > offset + 2) {
                expect(extractor.packetReadCount).to.equal(1);
            }
        }

        // Cleanup
        await extractor.dispose();
    });

    it('Only reads a few packets when getting frames which are far apart', async() => {
        // Arrange
        const extractor = await BeamcoderExtractor.create({
            inputFileOrUrl: 'https://storage.googleapis.com/lumen5-prod-video/mvc-4k-new-orleans-a053c0340725rv-112014WA74Rf.mp4',
        });

        // Act & assert
        await extractor.getFrameAtTime(0);
        expect(extractor.packetReadCount).to.be.below(15);

        await extractor.getFrameAtTime(20);
        expect(extractor.packetReadCount).to.be.below(15);

        await extractor.getFrameAtTime(0);
        expect(extractor.packetReadCount).to.be.below(15);

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
            const frame = await extractor.getFrameAtTime(i / FPS);
            expect(Math.floor(extractor.ptsToTime(frame.pts) * FPS)).to.equal(i);
        }

        // Cleanup
        await extractor.dispose();
    });

    it('can get frame from vp8 encoded webm with alpha', async() => {
        // Arrange
        const extractor = await BeamcoderExtractor.create({
            inputFileOrUrl: './test/samples/vp8-webm-with-alpha.webm',
            threadCount: 8,
        });

        // Act and Assert
        const imageData = await extractor.getImageDataAtTime(100);
        const canvasImageData = createImageData(imageData.data, imageData.width, imageData.height);

        const canvas = createCanvas(imageData.width, imageData.height);
        const ctx = canvas.getContext('2d', { alpha: true });

        ctx.putImageData(canvasImageData, 0, 0);
        expect(canvas.toBuffer('image/png')).toMatchImageSnapshot();

        // Cleanup
        await extractor.dispose();
    });

    it('can get frame from vp9 encoded webm with alpha', async() => {
        // Arrange
        const extractor = await BeamcoderExtractor.create({
            inputFileOrUrl: './test/samples/vp9-webm-with-alpha.webm',
            threadCount: 8,
        });

        // Act and Assert
        const imageData = await extractor.getImageDataAtTime(100);
        const canvasImageData = createImageData(imageData.data, imageData.width, imageData.height);

        const canvas = createCanvas(imageData.width, imageData.height);
        const ctx = canvas.getContext('2d', { alpha: true });

        ctx.putImageData(canvasImageData, 0, 0);
        expect(canvas.toBuffer('image/png')).toMatchImageSnapshot();

        // Cleanup
        await extractor.dispose();
    });

    it('can get first frame from vp9 encoded webm with alpha', async() => {
        // Arrange
        const extractor = await BeamcoderExtractor.create({
            inputFileOrUrl: './test/samples/vp9-webm-with-alpha.webm',
            threadCount: 8,
        });

        // Act and Assert
        const imageData = await extractor.getImageDataAtTime(0);
        const canvasImageData = createImageData(imageData.data, imageData.width, imageData.height);

        const canvas = createCanvas(imageData.width, imageData.height);
        const ctx = canvas.getContext('2d', { alpha: true });

        ctx.putImageData(canvasImageData, 0, 0);
        expect(canvas.toBuffer('image/png')).toMatchImageSnapshot();

        // Cleanup
        await extractor.dispose();
    });

    it('can get HDR Video fame', async() => {
        // Arrange
        const extractor = await BeamcoderExtractor.create({
            inputFileOrUrl: './test/samples/hdr.mp4',
            threadCount: 8,
        });

        // Act and Assert
        const imageData = await extractor.getImageDataAtTime(100);
        const canvasImageData = createImageData(imageData.data, imageData.width, imageData.height);

        const canvas = createCanvas(imageData.width, imageData.height);
        const ctx = canvas.getContext('2d', { alpha: true });

        ctx.putImageData(canvasImageData, 0, 0);
        expect(canvas.toBuffer('image/png')).toMatchImageSnapshot();

        // Cleanup
        await extractor.dispose();
    });

    it('can get the same frame multiple times', async() => {
        // When smaller increments are requested, the same frame can be returned multiple times. This happens when the
        // caller plays the video at a lower playback rate than the source video.

        // Arrange
        const extractor = await BeamcoderExtractor.create({
            inputFileOrUrl: 'https://storage.googleapis.com/lumen5-prod-images/countTo60.mp4',
        });
        const times = [
            1.6,
            1.623077,
            1.646154,
            1.669231,
            1.692308,
            1.715384,
            1.738462,
            1.761538,
            1.784615,
            1.807693,
            1.830769,
            1.853846,
            1.876923,
        ];

        for (let i = 0; i < times.length; i++) {
            const imageData = await extractor.getImageDataAtTime(times[i]); // 3
            const canvasImageData = createImageData(imageData.data, imageData.width, imageData.height);
            if (!imageData) {
                throw new Error(`Failed to get image data for time ${times[i]}`);
            }
            const canvas = createCanvas(imageData.width, imageData.height);
            const ctx = canvas.getContext('2d');
            ctx.putImageData(canvasImageData, 0, 0);
            expect(canvas.toBuffer('image/png')).toMatchImageSnapshot();
        }

        // Cleanup
        await extractor.dispose();
    });

    it('can get the last frame multiple times', async() => {
        // Arrange
        const extractor = await BeamcoderExtractor.create({
            inputFileOrUrl: 'https://storage.googleapis.com/lumen5-prod-images/countTo60.mp4',
        });
        const times = [
            1.98,
            1.99,
            2.0,
            2.01,
            2.02,
        ];

        for (let i = 0; i < times.length; i++) {
            const imageData = await extractor.getImageDataAtTime(times[i]); // 3
            if (!imageData) {
                throw new Error(`Failed to get image data for time ${times[i]}`);
            }
            const canvasImageData = createImageData(imageData.data, imageData.width, imageData.height);
            const canvas = createCanvas(imageData.width, imageData.height);
            const ctx = canvas.getContext('2d');
            ctx.putImageData(canvasImageData, 0, 0);
            expect(canvas.toBuffer('image/png')).toMatchImageSnapshot();
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
            const frame = await extractor.getFrameAtTime(i / FPS);
            expect(Math.floor(extractor.ptsToTime(frame.pts) * FPS)).to.equal(i);
        }

        // Cleanup
        await extractor.dispose();
    });

    it('can get all frames (low framerate)', async() => {
        // Arrange
        const extractor = await BeamcoderExtractor.create({
            inputFileOrUrl: TEST_VIDEO_LOW_FRAMERATE,
        });

        // Act & assert
        for (let i = 0; i < 5; i++) {
            const frame = await extractor.getFrameAtTime(i / FPS);
            expect(Math.floor(extractor.ptsToTime(frame.pts) * 30)).to.be.closeTo(i, 15);
        }

        // Cleanup
        await extractor.dispose();
    });

    it('can get frame towards to end when decoder is flushed', async() => {
        // Arrange
        const extractor = await BeamcoderExtractor.create({
            inputFileOrUrl: 'https://storage.googleapis.com/lumen5-prod-video/fixed_tmpRjwSJC.mp4',
        });

        // Act
        await extractor.getFrameAtTime(12.866667);
        const frame = await extractor.getFrameAtTime(12.9);

        // Assert
        expect(frame).to.not.be.null;
        expect(frame.pts).to.equal(321000);

        // Cleanup
        await extractor.dispose();
    });

    it('can get frame towards to end when no packets are available', async() => {
        // Arrange
        const extractor = await BeamcoderExtractor.create({
            inputFileOrUrl: 'https://storage.googleapis.com/lumen5-prod-video/fixed_tmpRjwSJC.mp4',
        });

        // Act
        const frame = await extractor.getFrameAtTime(12.9);

        // Assert
        expect(frame).to.not.be.null;
        expect(frame.pts).to.equal(321000);

        // Cleanup
        await extractor.dispose();
    });

    it('can get frames at random times (forward and backward)', async() => {
        // Arrange
        const extractor = await BeamcoderExtractor.create({
            inputFileOrUrl: 'https://storage.googleapis.com/lumen5-prod-images/countTo60.mp4',
        });
        const times_to_get = [
            1, // forward to 31
            0, // backwards to 1
            1.5, // forward to 46
            0.5, // backward to 16
        ];

        // Act and Assert
        for (let i = 0; i < times_to_get.length; i++) {
            const imageData = await extractor.getImageDataAtTime(times_to_get[i]);
            if (!imageData) {
                continue;
            }
            const canvasImageData = createImageData(imageData.data, imageData.width, imageData.height);
            const canvas = createCanvas(imageData.width, imageData.height);
            const ctx = canvas.getContext('2d');
            ctx.putImageData(canvasImageData, 0, 0);
            expect(canvas.toBuffer('image/png')).toMatchImageSnapshot();
        }

        // Cleanup
        await extractor.dispose();
    });

    it('can get frames when looping', async() => {
        const extractor = await BeamcoderExtractor.create({
            inputFileOrUrl: 'https://media-share.lumen5.com/proxy-url/?url=https%3A%2F%2Fmedia.tenor.com%2F37odVJNnxHEAAAPo%2Fdominos-dominos-pizza.mp4',
        });

        const times = [0.012667, 1.212667, 1.246, 0.012666];
        for (let i = 0; i < times.length; i++) {
            const frame = await extractor.getFrameAtTime(times[i]);
            expect(Math.floor(extractor.ptsToTime(frame.pts))).to.equal(Math.floor(times[i]));
        }
    });

    it('can get the first 10 frames', async() => {
        // Arrange
        const extractor = await BeamcoderExtractor.create({
            inputFileOrUrl: 'https://storage.googleapis.com/lumen5-prod-images/countTo60.mp4',
        });

        // Act & assert
        // ensure we render the 2nd frame properly - if we read the next packet we'll draw 3 instead of 2
        for (let i = 0; i < 10; i++) {
            const time = i / FPS;
            const imageData = await extractor.getImageDataAtTime(time);
            if (!imageData) {
                continue;
            }
            const canvasImageData = createImageData(imageData.data, imageData.width, imageData.height);
            const canvas = createCanvas(imageData.width, imageData.height);
            const ctx = canvas.getContext('2d');
            ctx.putImageData(canvasImageData, 0, 0);
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
            const time = i / FPS;
            const imageData = await extractor.getImageDataAtTime(time);
            if (!imageData) {
                continue;
            }
            const canvasImageData = createImageData(imageData.data, imageData.width, imageData.height);
            const canvas = createCanvas(imageData.width, imageData.height);
            const ctx = canvas.getContext('2d');
            ctx.putImageData(canvasImageData, 0, 0);
            expect(canvas.toBuffer('image/png')).toMatchImageSnapshot();
        }

        // Cleanup
        await extractor.dispose();
    });

    it('should accurately generate frames when seeking to time that aligns with frame boundaries.', async() => {
        // Arrange
        // ffprobe -show_frames test/samples/count0To179.mp4 | grep pts
        // pts=30720
        // pts_time=2.000000
        // pts=31232
        // pts_time=2.033333
        // pts=31744
        // pts_time=2.066667
        // it should return 60, 61, 62 frames
        const extractor = await BeamcoderExtractor.create({
            inputFileOrUrl: TEST_VIDEO_COUNT_0_TO_179,
        });
        // Act & assert
        for (const time of [2.0, 2.033333, 2.066667]) {
            const imageData = await extractor.getImageDataAtTime(time);
            if (!imageData) {
                continue;
            }
            const canvasImageData = createImageData(imageData.data, imageData.width, imageData.height);
            const canvas = createCanvas(imageData.width, imageData.height);
            const ctx = canvas.getContext('2d');
            ctx.putImageData(canvasImageData, 0, 0);
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
            const time = i / FPS;
            const imageData = await extractor.getImageDataAtTime(time);
            if (!imageData) {
                continue;
            }
            const canvasImageData = createImageData(imageData.data, imageData.width, imageData.height);
            const canvas = createCanvas(imageData.width, imageData.height);
            const ctx = canvas.getContext('2d');
            ctx.putImageData(canvasImageData, 0, 0);
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
                const time = i / FPS;
                await extractor.getFrameAtTime(time);
            }
            const end = Date.now();
            duration += end - start;

            // Cleanup
            await extractor.dispose();
        }
        const total_duration = duration / samples;
        const duration_per_frame = total_duration / FPS;
        console.log(`On average, it took ${total_duration}ms or ${duration_per_frame}ms per frame`);
    }, 100000);
});
