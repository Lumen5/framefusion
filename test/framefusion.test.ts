const { performance } = require('perf_hooks');
import httpServer from 'http-server';
import { readFileSync, readdirSync } from 'fs';
import { rimraf } from 'rimraf';
import {
    describe,
    it,
    expect,
    beforeAll,
    beforeEach,
    afterAll
} from 'vitest';
import { BeamcoderExtractor } from '../framefusion';
import sinon from 'sinon';
import { toMatchImageSnapshot } from 'jest-image-snapshot';
import { fileExistsSync } from 'tsconfig-paths/lib/filesystem';

declare global {
  namespace jest {
    interface Matchers<R> {
      toMatchImageSnapshot(): R
    }
  }
}

const TEST_SERVER_PORT = 4242;

expect.extend({ toMatchImageSnapshot })

const TEST_VIDEO = './samples/bbb10m.mp4';
const TEST_VIDEO_SMALLER = './samples/bbb-smaller.mp4';
const TEST_VIDEO_LOW_FRAMERATE = './samples/bbb-low-fps.mp4';

// TODOS
// There are a few sleeps (timeouts) to probably remove

describe('framefusion', async () => {
    let server;

    beforeEach(async () => {
        await rimraf('./output/*', { glob: true });
        console.log('Removed previous results in output/');
    });

    beforeAll(async () => {
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

    it('Should create an extractor', async () => {
        const p1 = performance.now();

        // Arrange & Act
        const extractor = await BeamcoderExtractor.create({
            inputFile: TEST_VIDEO,
            outputFile: './output/frame-%04d.png'
        });

        const p2 = performance.now();
        console.log('Time to build a demuxer + decoder + muxer + encoder (ms): ', p2 - p1);

        // Assert
        expect((extractor as any).decoder.type).to.equal('decoder');
        expect((extractor as any).demuxer.type).to.equal('demuxer');

        // Cleanup
        extractor.dispose();
    });

    it('Should create an extractor', async () => {
        const p1 = performance.now();

        // Arrange & Act
        const extractor = await BeamcoderExtractor.create({
            inputFile: TEST_VIDEO,
            outputFile: './output/frame-%04d.png'
        });

        const p2 = performance.now();
        console.log('Time to build a demuxer + decoder + muxer + encoder (ms): ', p2 - p1);

        // Assert
        expect((extractor as any).decoder.type).to.equal('decoder');
        expect((extractor as any).demuxer.type).to.equal('demuxer');

        // Cleanup
        extractor.dispose();
    });

    it('Should get duration', async () => {
        // Arrange
        const extractor = await BeamcoderExtractor.create({
            inputFile: TEST_VIDEO,
            outputFile: './output/frame-%04d.png'
        });

        // Act
        const duration = extractor.duration;

        // Assert
        expect(duration).to.eq(10);

        // Cleanup
        extractor.dispose();
    });

    it('Should get width', async () => {
        // Arrange
        const extractor = await BeamcoderExtractor.create({
            inputFile: TEST_VIDEO,
            outputFile: './output/frame-%04d.png'
        });

        // Act
        const width = extractor.width;

        // Assert
        expect(width).to.eq(1920);

        // Cleanup
        extractor.dispose();
    });

    it('Should get height', async () => {
        // Arrange
        const extractor = await BeamcoderExtractor.create({
            inputFile: TEST_VIDEO,
            outputFile: './output/frame-%04d.png'
        });

        // Act
        const height = extractor.height;

        // Assert
        expect(height).to.eq(1080);

        // Cleanup
        extractor.dispose();
    });

    describe('Continuous dumping', () => {
        // This should always work, but skipped because it's pretty slow
        it.skip('Should dump an entire mp4', async () => {
            // Arrange
            const extractor = await BeamcoderExtractor.create({
                inputFile: TEST_VIDEO,
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

            // Cleanups
            extractor.dispose();
        }, 50000);

        it('Should dump an entire mp4 [smaller video version]', async () => {
            // Arrange
            const extractor = await BeamcoderExtractor.create({
                inputFile: TEST_VIDEO_SMALLER,
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

        it('Should read a mp4 - without dumping frames', async () => {
            // Arrange
            const extractor = await BeamcoderExtractor.create({
                inputFile: TEST_VIDEO_SMALLER,
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

        it('Should read a mp4 with specified pixel format', async () => {
            // Arrange
            const extractor = await BeamcoderExtractor.create({
                inputFile: TEST_VIDEO_SMALLER,
                threadCount: 8,
                outputPixelFormat: 'argb'
            }) as BeamcoderExtractor;

            // Act
            const frame = await extractor.getFrameAtTime(1);

            // Assert
            expect(frame.format).to.equal('argb');

            // Cleanup
            extractor.dispose();
        }, 50000);

        it('Should seek and dump frames', async () => {
            // Arrange
            const extractor = await BeamcoderExtractor.create({
                inputFile: TEST_VIDEO_SMALLER,
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

        it('Should seek and dump frames precisely', async () => {
            // Arrange
            const extractor = await BeamcoderExtractor.create({
                inputFile: './samples/countTo60.mp4',
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

        it('Should dump frames and pause in-between', async () => {
            // Arrange
            const extractor = await BeamcoderExtractor.create({
                inputFile: './samples/countTo60.mp4',
                outputFile: './output/frame-%04d.png',
                threadCount: 8,
            }) as BeamcoderExtractor;

            // Act
            // Array generated with
            // ffprobe -show_frames samples/bbb-smaller.mp4  | grep pts_time | head -n 5 | sed 's/pts_time=//g'
            await extractor.seekToTime(0);

            let count = 0;

            const onFrameAvailable = async (frame) => {
                return count < 4;
            }

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
        it('Should seek and dump all frames in the video', async () => {
            // Arrange
            const extractor = await BeamcoderExtractor.create({
                inputFile: './samples/countTo60.mp4',
                outputFile: './output/frame-%04d.png',
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
        }, 2000);

        it('Should seek and dump frames at different points in the video', async () => {
            // Arrange
            const extractor = await BeamcoderExtractor.create({
                inputFile: './samples/countTo60.mp4',
                outputFile: './output/frame-%04d.png',
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

        it.skip('Should seek and dump all frames in the video [big video]', async () => {
            // Arrange
            const extractor = await BeamcoderExtractor.create({
                inputFile: TEST_VIDEO,
                outputFile: './output/frame-%04d.png',
                threadCount: 8,
            }) as BeamcoderExtractor;

            // Sample at the middle of each frame
            const FRAME_SYNC_DELTA = (1 / 60.0) / 2.0;

            // Act & assert
            const p1 = performance.now();
            for (let i = 0; i < extractor.duration * 60; i++) {
                const frame = await extractor.getFrameAtTime(i / 60.0 + FRAME_SYNC_DELTA);
                expect(Math.round(extractor.ptsToTime(frame.pts) * 60)).to.equal(i);
            }
            const p2 = performance.now();
            console.log('Time to interpolate all frames (fast) and dump all frames (ms): ', p2 - p1);

            // Cleanup
            extractor.dispose();
        }, 30000);
    });

    it('Should minterpolate frames (fast)', async () => {
        // Arrange
        const extractor = await BeamcoderExtractor.create({
            inputFile: TEST_VIDEO_LOW_FRAMERATE,
            outputFile: './output/frame-%04d.png',
            threadCount: 8,
            interpolateFps: 25,
            interpolateMode: 'fast',
        }) as BeamcoderExtractor;

        // Act
        const p1 = performance.now();
        await extractor.readFrames();
        const p2 = performance.now();
        console.log('Time to interpolate all frames (fast) and dump all frames (ms): ', p2 - p1);

        await new Promise(resolve => setTimeout(resolve, 1000));

        expect(fileExistsSync('./output/frame-0001.png')).to.be.true;
        expect(fileExistsSync('./output/frame-0241.png')).to.be.true;

        // Cleanup
        extractor.dispose();
    }, 200000);

    it('Should interpolate frames (high-quality)', async () => {
        // Arrange
        const extractor = await BeamcoderExtractor.create({
            inputFile: TEST_VIDEO_LOW_FRAMERATE,
            outputFile: './output/frame-%04d.png',
            threadCount: 8,
            interpolateFps: 25,
            interpolateMode: 'high-quality',
        }) as BeamcoderExtractor;

        // Act
        const p1 = performance.now();
        await extractor.readFrames();
        const p2 = performance.now();
        console.log('Time to interpolate (high-quality) and dump all frames (ms): ', p2 - p1);

        await new Promise(resolve => setTimeout(resolve, 1000));

        expect(fileExistsSync('./output/frame-0001.png')).to.be.true;
        expect(fileExistsSync('./output/frame-0241.png')).to.be.true;

        // Cleanup
        extractor.dispose();
    }, 200000);


    it('Should open a file from the network and dump all frames  [smaller video version]', async () => {
        // Arrange
        const extractor = await BeamcoderExtractor.create({
            url: `http://127.0.0.1:${TEST_SERVER_PORT}/samples/bbb-smaller-faststart.mp4`,
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

    // Skipped because this test is pretty slow.
    it.skip('Should open a file from the network and dump all frames', async () => {
        // Arrange
        const extractor = await BeamcoderExtractor.create({
            url: `http://127.0.0.1:${TEST_SERVER_PORT}/samples/bbb10m.mp4`,
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

    it.skip('Encode frames to mp4', async () => {

    });
});
