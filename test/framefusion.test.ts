import { readFileSync, readdirSync } from 'fs';
import { performance } from 'perf_hooks';
import httpServer from 'http-server';
import { rimraf } from 'rimraf';
import {
    describe,
    it,
    expect,
    beforeAll,
    beforeEach,
    afterAll
} from 'vitest';
import sinon from 'sinon';
import { toMatchImageSnapshot } from 'jest-image-snapshot';
import { fileExistsSync } from 'tsconfig-paths/lib/filesystem';
import { createCanvas } from 'canvas';
import { BeamcoderExtractor } from '../framefusion';

declare global {
    // eslint-disable-next-line @typescript-eslint/no-namespace
    namespace jest {
        interface Matchers<R> {
            toMatchImageSnapshot(): R;
        }
    }
}

const TEST_SERVER_PORT = 4242;

expect.extend({ toMatchImageSnapshot });

const TEST_VIDEO = './test/samples/bbb10m.mp4';
const TEST_VIDEO_WIDTH = 1920;
const TEST_VIDEO_HEIGHT = 1080;

const TEST_VIDEO_MEDIUM = './test/samples/bbb-medium.mp4';
const TEST_VIDEO_MEDIUM_WIDTH = 720;
const TEST_VIDEO_MEDIUM_HEIGHT = 406;

const TEST_VIDEO_SMALL = './test/samples/bbb-small.mp4';
const TEST_VIDEO_SMALL_WIDTH = 480;
const TEST_VIDEO_SMALL_HEIGHT = 270;

const TEST_VIDEO_SMALLER = './test/samples/bbb-smaller.mp4';
const TEST_VIDEO_SMALLER_WIDTH = 384
const TEST_VIDEO_SMALLER_HEIGHT = 216

const TEST_VIDEO_COUNT_TO_60 = './test/samples/countTo60.mp4';
const TEST_VIDEO_COUNT_TO_60_WIDTH = 24;
const TEST_VIDEO_COUNT_TO_60_HEIGHT = 24;

const TEST_VIDEO_LOW_FRAMERATE = './test/samples/bbb-low-fps.mp4';

const ALL_TEST_VIDEOS = [
    TEST_VIDEO,
    TEST_VIDEO_MEDIUM,
    TEST_VIDEO_SMALL,
    TEST_VIDEO_SMALLER,
    TEST_VIDEO_COUNT_TO_60
]

const ALL_TEST_VIDEO_WIDTHS = [
    TEST_VIDEO_WIDTH,
    TEST_VIDEO_MEDIUM_WIDTH,
    TEST_VIDEO_SMALL_WIDTH,
    TEST_VIDEO_SMALLER_WIDTH,
    TEST_VIDEO_COUNT_TO_60_WIDTH
]

const ALL_TEST_VIDEO_HEIGHTS = [
    TEST_VIDEO_HEIGHT,
    TEST_VIDEO_MEDIUM_HEIGHT,
    TEST_VIDEO_SMALL_HEIGHT,
    TEST_VIDEO_SMALLER_HEIGHT,
    TEST_VIDEO_COUNT_TO_60_HEIGHT
]

// TODOS
// There are a few sleeps (timeouts) to probably remove

describe('framefusion', () => {
    let server;

    beforeEach(async() => {
        await rimraf('./output/*', { glob: true });
        console.log('Removed previous results in output/');
    });

    beforeAll(async() => {
        await rimraf('./output/*', { glob: true });
        console.log('Removed previous results in output/');

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

    it('should get duration', async() => {
        // Arrange
        const extractor = await BeamcoderExtractor.create({
            inputFileOrUrl: TEST_VIDEO,
            outputFile: './output/frame-%04d.png',
        });

        // Act
        const duration = extractor.duration;

        // Assert
        expect(duration).to.eq(10);

        // Cleanup
        extractor.dispose();
    });

    it('should get source width', async () => {
        for (let i = 0; i < ALL_TEST_VIDEOS.length; i++) {
            // Arrange
            const extractor = await BeamcoderExtractor.create({
                inputFileOrUrl: ALL_TEST_VIDEOS[i],
                outputFile: './output/frame-%04d.png'
            });

            // Act
            const width = extractor.width;

            // Assert
            expect(width).to.eq(ALL_TEST_VIDEO_WIDTHS[i]);

            // Cleanup
            extractor.dispose();
        }
    });

    it('should get source height', async () => {
        for (let i = 0; i < ALL_TEST_VIDEOS.length; i++) {
            // Arrange
            const extractor = await BeamcoderExtractor.create({
                inputFileOrUrl: ALL_TEST_VIDEOS[i],
                outputFile: './output/frame-%04d.png'
            });

            // Act
            const height = extractor.height;

            // Assert
            expect(height).to.eq(ALL_TEST_VIDEO_HEIGHTS[i]);

            // Cleanup
            extractor.dispose();
        }
    });

    it('should get frame dimensions', async() => {
        for (let i = 0; i < ALL_TEST_VIDEOS.length; i++) {
            // Arrange
            const extractor = await BeamcoderExtractor.create({
                inputFileOrUrl: ALL_TEST_VIDEOS[i],
                outputFile: './output/frame-%04d.png'
            });

            // Act
            const frame = await extractor.getFrameAtTime(0);

            // Assert
            expect(frame.width).to.eq(ALL_TEST_VIDEO_WIDTHS[i]);
            expect(frame.height).to.eq(ALL_TEST_VIDEO_HEIGHTS[i]);

            // Cleanup
            extractor.dispose();
        }
    })

    describe('Continuous dumping', () => {
        it('Should dump an entire mp4 [smaller video version]', async() => {
            // Arrange
            const extractor = await BeamcoderExtractor.create({
                inputFileOrUrl: TEST_VIDEO_SMALLER,
                outputFile: './output/frame-%04d.png',
                threadCount: 8,
            }) as BeamcoderExtractor;

            // Act
            const p1 = performance.now();
            await extractor.readFrames();
            const p2 = performance.now();
            console.log('Time to dump all frames (ms): ', p2 - p1);

            await new Promise(resolve => setTimeout(resolve, 1000));

            expect(fileExistsSync('./output/frame-0001.png')).to.be.true;
            expect(fileExistsSync('./output/frame-0600.png')).to.be.true;

            // Cleanup
            extractor.dispose();
        }, 50000);

        it('Should read a mp4 - without dumping frames', async() => {
            // Arrange
            const extractor = await BeamcoderExtractor.create({
                inputFileOrUrl: TEST_VIDEO_SMALLER,
                threadCount: 8,
            }) as BeamcoderExtractor;

            // Act
            const onFrameAvailable = sinon.spy(() => {
                return true;
            });
            const p1 = performance.now();
            await extractor.readFrames({ onFrameAvailable });
            const p2 = performance.now();
            console.log('Time to dump all frames (ms): ', p2 - p1);

            await new Promise(resolve => setTimeout(resolve, 1000));

            expect(onFrameAvailable.callCount).to.equal(600);
            // We should only have the .gitkeep
            expect(readdirSync('./output/')).to.have.lengthOf(1);

            // Cleanup
            extractor.dispose();
        }, 50000);

        it('Should seek and dump frames', async() => {
            // Arrange
            const extractor = await BeamcoderExtractor.create({
                inputFileOrUrl: TEST_VIDEO_SMALLER,
                outputFile: './output/frame-%04d.png',
                threadCount: 8,
            }) as BeamcoderExtractor;

            // Act
            const p1 = performance.now();
            await extractor.seekToPTS(150016);
            await extractor.readFrames();
            const p2 = performance.now();
            console.log('Time to dump all frames (ms): ', p2 - p1);

            await new Promise(resolve => setTimeout(resolve, 1000));

            // Assert
            expect(fileExistsSync('./output/frame-0001.png')).to.be.true;
            expect(fileExistsSync('./output/frame-0014.png')).to.be.true;
            // There are only 13 frames after 150016, so this one should not exist
            expect(fileExistsSync('./output/frame-0015.png')).to.be.false;

            // Cleanup
            extractor.dispose();
        }, 50000);

        it('Should seek and dump frames precisely', async() => {
            // Arrange
            const extractor = await BeamcoderExtractor.create({
                inputFileOrUrl: './test/samples/countTo60.mp4',
                outputFile: './output/frame-%04d.png',
                threadCount: 8,
            }) as BeamcoderExtractor;

            // Act
            const p1 = performance.now();
            await extractor.seekToPTS(29696);
            await extractor.readFrames();
            const p2 = performance.now();
            console.log('Time to dump all frames (ms): ', p2 - p1);

            await new Promise(resolve => setTimeout(resolve, 1000));

            // Assert
            // There should be only 2 frames
            expect(fileExistsSync('./output/frame-0001.png')).to.be.true;
            expect(fileExistsSync('./output/frame-0002.png')).to.be.true;
            expect(fileExistsSync('./output/frame-0003.png')).to.be.false;
            expect(readFileSync('./output/frame-0001.png')).toMatchImageSnapshot();
            expect(readFileSync('./output/frame-0002.png')).toMatchImageSnapshot();

            // Cleanup
            extractor.dispose();
        }, 50000);

        it('Should dump frames and pause in-between', async() => {
            // Arrange
            const extractor = await BeamcoderExtractor.create({
                inputFileOrUrl: './test/samples/countTo60.mp4',
                outputFile: './output/frame-%04d.png',
                threadCount: 8,
            }) as BeamcoderExtractor;

            // Act
            // Array generated with
            // ffprobe -show_frames samples/bbb-smaller.mp4  | grep pts_time | head -n 5 | sed 's/pts_time=//g'
            await extractor.seekToTime(0);

            const count = 0;

            const onFrameAvailable = async(frame) => {
                return count < 4;
            };

            await extractor.readFrames({
                onFrameAvailable,
            });

            // Assert
            expect(readFileSync('./output/frame-0001.png')).toMatchImageSnapshot();
            expect(readFileSync('./output/frame-0002.png')).toMatchImageSnapshot();
            expect(readFileSync('./output/frame-0003.png')).toMatchImageSnapshot();
            expect(readFileSync('./output/frame-0004.png')).toMatchImageSnapshot();

            // Cleanup
            extractor.dispose();
        }, 50000);
    });

    describe('Dump frame at time', () => {
        it.concurrent('Should seek and dump all frames in the video', async() => {
            // Arrange
            const extractor = await BeamcoderExtractor.create({
                inputFileOrUrl: './test/samples/countTo60.mp4',
                threadCount: 8,
            }) as BeamcoderExtractor;

            // Sample at the middle of each frame
            const FRAME_SYNC_DELTA = (1 / 30.0) / 2.0;

            // Act & assert
            for (let i = 0; i < 60; i++) {
                const frame = await extractor.getFrameAtTime(i / 30.0 + FRAME_SYNC_DELTA);
                expect(Math.floor(extractor.ptsToTime(frame.pts) * 30)).to.equal(i);
            }

            // Cleanup
            extractor.dispose();
        }, 10000);

        it('Should get frame as image data', async() => {
            // Arrange
            const extractor = await BeamcoderExtractor.create({
                inputFileOrUrl: './test/samples/countTo60.mp4',
                threadCount: 8,
            }) as BeamcoderExtractor;

            // Sample at the middle of each frame
            const FRAME_SYNC_DELTA = (1 / 30.0) / 2.0;

            // Act & assert
            for (let i = 0; i < 10; i++) {
                const imagedata = await extractor.getImageDataAtTime(i / 30.0 + FRAME_SYNC_DELTA);
                expect(imagedata.width).to.equal(extractor.width);
                expect(imagedata.height).to.equal(extractor.height);
                const canvas = createCanvas(imagedata.width, imagedata.height);
                const ctx = canvas.getContext('2d');
                ctx.putImageData(imagedata, 0, 0);
                expect(canvas.toBuffer('image/png')).toMatchImageSnapshot();
            }

            // Cleanup
            extractor.dispose();
        }, 2000);

        it.concurrent('Should seek and dump all frames in the video [other video]', async() => {
            // Arrange
            const extractor = await BeamcoderExtractor.create({
                inputFileOrUrl: TEST_VIDEO_LOW_FRAMERATE,
                threadCount: 8,
            }) as BeamcoderExtractor;

            // Sample at the middle of each frame
            const FRAME_SYNC_DELTA = (1 / 30.0) / 2.0;

            // Act & assert
            for (let i = 0; i < extractor.duration * 30.0; i++) {
                const frame = await extractor.getFrameAtTime(i / 30.0 + FRAME_SYNC_DELTA);
                expect(Math.floor(extractor.ptsToTime(frame.pts) * 30)).to.be.closeTo(i, 15);
            }

            // Cleanup
            extractor.dispose();
        }, 10000);

        it.concurrent('Should seek and dump frames at different points in the video', async() => {
            // Arrange
            const extractor = await BeamcoderExtractor.create({
                inputFileOrUrl: './test/samples/countTo60.mp4',
                threadCount: 8,
            });

            // Sample at the middle of each frame
            const FRAME_SYNC_DELTA = (1 / 30.0) / 2.0;

            // Act & assert
            // This should be the frame displaying number 10
            const f1 = await extractor.getFrameAtTime(0.300000 + FRAME_SYNC_DELTA);
            expect(f1.pts).to.eq(4608);

            // This should be the frame displaying number 11
            const f2 = await extractor.getFrameAtTime(0.333333 + FRAME_SYNC_DELTA);
            expect(f2.pts).to.eq(5120);

            // Now skip a few more frames:
            // This should be the frame displaying number 13
            const f3 = await extractor.getFrameAtTime(0.400000 + FRAME_SYNC_DELTA);
            expect(f3.pts).to.eq(6144);

            // Now skip pretty far:
            // This should be the frame displaying number 59
            const f4 = await extractor.getFrameAtTime(1.933333 + FRAME_SYNC_DELTA);
            expect(f4.pts).to.eq(29696);

            // This should be the frame displaying number 60
            const f5 = await extractor.getFrameAtTime(1.966667 + FRAME_SYNC_DELTA);
            expect(f5.pts).to.eq(30208);

            // Cleanup
            extractor.dispose();
        }, 50000);

        it.concurrent('Should seek and dump frames in a video [big video]', async() => {
            // Arrange
            const extractor = await BeamcoderExtractor.create({
                inputFileOrUrl: TEST_VIDEO,
                threadCount: 8,
            }) as BeamcoderExtractor;

            // Sample at the middle of each frame
            const FRAME_SYNC_DELTA = (1 / 60.0) / 2.0;

            // Act & assert
            const p1 = performance.now();
            for (let i = 0; i < 3; i++) {
                const frame = await extractor.getFrameAtTime(i / 60.0 + FRAME_SYNC_DELTA);
                expect(Math.round(extractor.ptsToTime(frame.pts) * 60)).to.equal(i);
            }
            const p2 = performance.now();
            console.log('Time to interpolate all frames (fast) and dump all frames (ms): ', p2 - p1);

            // Cleanup
            extractor.dispose();
        }, 30000);
    });

    it('Should interpolate frames (fast)', async() => {
        // Arrange
        const extractor = await BeamcoderExtractor.create({
            inputFileOrUrl: TEST_VIDEO_LOW_FRAMERATE,
            outputFile: './output/frame-%04d.png',
            threadCount: 8,
            interpolateFps: 25,
            interpolateMode: 'fast',
        }) as BeamcoderExtractor;

        // Act
        const p1 = performance.now();
        let count = 0;
        await extractor.readFrames({
            async onFrameAvailable() {
                count++;
                return true;
            },
        });
        const p2 = performance.now();
        console.log('Time to interpolate all frames (fast) and dump all frames (ms): ', p2 - p1);

        await new Promise(resolve => setTimeout(resolve, 1000));

        expect(count).to.be.greaterThan(240);
        expect(fileExistsSync('./output/frame-0001.png')).to.be.true;
        expect(fileExistsSync('./output/frame-0241.png')).to.be.true;

        // Cleanup
        extractor.dispose();
    }, 200000);

    it('Should minterpolate frames (high-quality)', async() => {
        // Arrange
        const extractor = await BeamcoderExtractor.create({
            inputFileOrUrl: TEST_VIDEO_LOW_FRAMERATE,
            outputFile: './output/frame-%04d.png',
            threadCount: 8,
            interpolateFps: 25,
            interpolateMode: 'high-quality',
        }) as BeamcoderExtractor;

        // Act
        const p1 = performance.now();
        let count = 0;
        await extractor.readFrames({
            async onFrameAvailable() {
                count++;
                return true;
            },
        });
        const p2 = performance.now();
        console.log('Time to interpolate (high-quality) and dump all frames (ms): ', p2 - p1);

        await new Promise(resolve => setTimeout(resolve, 1000));

        expect(count).to.be.greaterThan(240);
        expect(fileExistsSync('./output/frame-0001.png')).to.be.true;
        expect(fileExistsSync('./output/frame-0241.png')).to.be.true;

        // Cleanup
        extractor.dispose();
    }, 200000);

    it('Should open a file from the network and dump all frames  [smaller video version]', async() => {
        // Arrange
        const extractor = await BeamcoderExtractor.create({
            inputFileOrUrl: `http://127.0.0.1:${TEST_SERVER_PORT}/test/samples/bbb-smaller-faststart.mp4`,
            outputFile: './output/frame-%04d.png',
        }) as BeamcoderExtractor;

        // Act
        const p1 = performance.now();
        await extractor.readFrames();
        const p2 = performance.now();
        console.log('Time to dump all frames through local network (ms): ', p2 - p1);

        // Assert
        expect(fileExistsSync('./output/frame-0001.png')).to.be.true;
        expect(fileExistsSync('./output/frame-0600.png')).to.be.true;

        // Cleanup
        extractor.dispose();
    }, 50000);

    it.skip('Encode frames to mp4', async() => {
        expect(false).to.be.true;
    });
});
