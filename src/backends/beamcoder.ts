import type { Stream } from 'stream';
import type { ReadStream } from 'fs';
import type {
    Frame
} from '@antoinemopa/beamcoder';
import beamcoder from '@antoinemopa/beamcoder';
import { createImageData } from 'canvas';
import type { ImageData } from 'canvas';
import type {
    InterpolateMode,
    Extractor,
    ExtractorArgs
} from '../../framefusion.js';
import {
    BaseExtractor
} from '../BaseExtractor.js';
import { DownloadVideoURL } from '../DownloadVideoURL.js';

const LOG_PACKET_FLOW = false;
const LOG_SINGLE_FRAME_DUMP_FLOW = false;
const STREAM_TYPE_VIDEO = 'video';

/**
 * Assumptions made by this library:
 *
 *  - The input is always a mp4
 *    It would be nice to support other formats. One thing to change is the iformat, hardcoded for mp4.
 *
 */
export const probeCodecPar = codecpar => ({
    type: codecpar.type,
    codec_type: codecpar.codec_type,
    codec_id: codecpar.codec_id,
    name: codecpar.name,
    codec_tag: codecpar.codec_tag,
    extradata: codecpar.extradata,
    format: codecpar.format,
    bit_rate: codecpar.bit_rate,
    bits_per_coded_sample: codecpar.bits_per_coded_sample,
    bits_per_raw_sample: codecpar.bits_per_raw_sample,
    profile: codecpar.profile,
    level: codecpar.level,
    width: codecpar.width,
    height: codecpar.height,
    sample_aspect_ratio: codecpar.sample_aspect_ratio,
    field_order: codecpar.field_order,
    color_range: codecpar.color_range,
    color_primaries: codecpar.color_primaries,
    color_trc: codecpar.color_trc,
    color_space: codecpar.color_space,
    chroma_location: codecpar.chroma_location,
    video_delay: codecpar.video_delay,
    channel_layout: codecpar.channel_layout,
    channels: codecpar.channels,
    sample_rate: codecpar.sample_rate,
    block_align: codecpar.block_align,
    frame_size: codecpar.frame_size,
    initial_padding: codecpar.initial_padding,
    trailing_padding: codecpar.trailing_padding,
    seek_preroll: codecpar.seek_preroll,
});

export const probeStream = stream => ({
    type: stream.type,
    index: stream.index,
    id: stream.id,
    time_base: stream.time_base,
    start_time: stream.start_time,
    duration: stream.duration,
    nb_frames: stream.nb_frames,
    disposition: stream.disposition,
    discard: stream.discard,
    sample_aspect_ratio: stream.sample_aspect_ratio,
    metadata: stream.metadata,
    avg_frame_rate: stream.avg_frame_rate,
    attached_pic: stream.attached_pic,
    side_data: stream.side_data,
    event_flags: stream.event_flags,
    r_frame_rate: stream.r_frame_rate,
    codecpar: probeCodecPar(stream.codecpar),
});


/**
 * A filter to convert between color spaces.
 * An example would be YUV to RGB, for mp4 to png conversion.
 */
const getFilter = async({
    stream,
    outputPixelFormat,
    interpolateFps,
    interpolateMode = 'fast',
}: {
    stream: beamcoder.Stream;
    outputPixelFormat: string;
    interpolateFps?: number;
    interpolateMode?: InterpolateMode;
}): Promise<beamcoder.Filterer> => {
    if (!stream.codecpar.format) {
        return null;
    }

    let filterSpec = [`[in0:v]format=${stream.codecpar.format}`];

    if (interpolateFps) {
        if (interpolateMode === 'high-quality') {
            filterSpec = [...filterSpec, `minterpolate=fps=${interpolateFps}`];
        }
        else if (interpolateMode === 'fast') {
            filterSpec = [...filterSpec, `fps=${interpolateFps}`];
        }
        else {
            throw new Error(`Unexpected interpolation mode: ${interpolateMode}`);
        }
    }

    filterSpec = [...filterSpec];

    const filterSpecStr = filterSpec.join(', ') + '[out0:v]';

    console.log(`filterSpec: ${filterSpecStr}`);

    return beamcoder.filterer({
        filterType: 'video',
        inputParams: [
            {
                name: 'in0:v',
                width: stream.codecpar.width,
                height: stream.codecpar.height,
                pixelFormat: stream.codecpar.format,
                timeBase: stream.time_base,
                pixelAspect: stream.sample_aspect_ratio,
            },
        ],
        outputParams: [
            {
                name: 'out0:v',
                pixelFormat: outputPixelFormat,
            },
        ],
        filterSpec: filterSpecStr,
    });
};

/**
 * Class to keep track of the muxer/demuxer/encoder/muxer used while extracting a video to frames.
 */
export class BeamcoderExtractor extends BaseExtractor implements Extractor {
    decoder: beamcoder.Decoder = null;
    demuxer: beamcoder.Demuxer = null;
    encoder: beamcoder.Encoder = null;
    muxer: beamcoder.Muxer = null;
    filterer: beamcoder.Filterer = null;
    packet: beamcoder.Packet;
    endTime: number;
    #locked: boolean;
    #targetPts = 0;
    demuxerStream: beamcoder.WritableDemuxerStream;
    readStream: ReadStream;
    lastFrame: beamcoder.Frame = null;
    filteredFrames: beamcoder.Frame[] = [];
    #streamStopped = false;
    #flushed = false;
    #streamIndex = -1;

    /**
     * Encoder/Decoder constuction is async, so it can't be put in a regular constructor.
     *
     * Use and await this method to generate an extactor.
     */
    static async create(args: ExtractorArgs): Promise<Extractor> {
        const extractor = new BeamcoderExtractor();
        await extractor.init(args);
        return extractor as unknown as Extractor;
    }

    async init({
        inputFileOrUrl,
        outputFile,
        threadCount = 8,
        endTime,
        interpolateFps,
        interpolateMode,
    }: ExtractorArgs): Promise<void> {
        if (!inputFileOrUrl) {
            throw new Error('Can only use file OR url');
        }
        let readStream: Stream;
        let outputPixelFormat = 'rgba';

        console.log('init', { inputFileOrUrl, outputFile, threadCount, endTime, interpolateFps, interpolateMode, outputPixelFormat });

        //
        //      - Demuxing -
        //
        //     The demuxer reads the file and outputs packet streams
        //

        let demuxerStream;

        if (inputFileOrUrl.startsWith('http')) {
            console.log('downloading url');
            const downloadUrl = new DownloadVideoURL(inputFileOrUrl);
            await downloadUrl.download();
            inputFileOrUrl = downloadUrl.filepath;
            console.log('finished downloading');
        }

        console.log('file mode');
        const demuxer = await beamcoder.demuxer('file:' + inputFileOrUrl);

        // Find out which is the first video stream
        this.#streamIndex = demuxer.streams.findIndex(stream => stream.codecpar.codec_type === STREAM_TYPE_VIDEO);
        if (this.#streamIndex === -1) {
            throw new Error('File has no video stream!');
        }
        console.log({ time_base: demuxer.streams[this.#streamIndex].time_base, stream: this.#streamIndex });

        //
        //      - Decoding -
        //
        //      The decoder reads packets and can output raw frame data
        //

        const decoder = beamcoder.decoder({
            demuxer: demuxer,
            width: demuxer.streams[this.#streamIndex].codecpar.width,
            height: demuxer.streams[this.#streamIndex].codecpar.height,
            stream_index: this.#streamIndex,
            pix_fmt: demuxer.streams[this.#streamIndex].codecpar.format,
            thread_count: threadCount,
        });

        let outputFormat: OutputFormats | null = null;

        if (outputFile) {
            ['png', 'tiff', 'mjpeg'].forEach(format => {
                if (outputFile.endsWith(format)) {
                    outputFormat = format as OutputFormats;

                    // TODO: build a map of outputFormats to outputPixelFormats and remove this from this loop.
                    if (outputFormat === 'mjpeg') {
                        outputPixelFormat = 'yuvj422p';
                    }

                    if (outputFormat === 'png') {
                        outputPixelFormat = 'rgb24';
                    }
                }
            });

            if (!outputFormat) {
                throw new Error('Output format could not be determined');
            }
        }

        //
        //     - Filtering -
        //
        //     Packets can be filtered to change colorspace, fps and add various effects
        //     If there are no color space changes or filters, filter might not be necessary.
        //

        const filterer = await getFilter({
            stream: demuxer.streams[this.#streamIndex],
            outputPixelFormat,
            interpolateFps,
            interpolateMode,
        });

        if (outputFormat) {
            //
            //     - Encoding -
            //
            //     Encode frames in packets of the output format
            //
            // This process is usually slower than decoding!
            const encoder = createFrameDumpingEncoder({
                decoder,
                outputFormat,
                thread_count: threadCount,
            });
            this.encoder = encoder;

            //
            //     - Muxing -
            //
            //     Assemble packets in a format that can be sent to the outside world!
            //

            // This process is usually slower than decoding!
            const muxer = await createFrameDumpingMuxer({
                thread_count: threadCount,
                filename: outputFile,
                sourceDemuxer: demuxer,
                streamIndex: this.#streamIndex,
            });

            this.muxer = muxer;
        }

        this.decoder = decoder;
        this.demuxer = demuxer;
        this.filterer = filterer;
        this.endTime = endTime;
        this.demuxerStream = demuxerStream;
        this.readStream = readStream as ReadStream;
    }

    get duration(): number {
        const time_base = this.demuxer.streams[this.#streamIndex].time_base;
        const durations = this.demuxer.streams.map(
            stream => stream.duration * time_base[0] / time_base[1]
        );

        return Math.max(...durations);
    }

    get width(): number {
        return this.demuxer.streams[this.#streamIndex].codecpar.width;
    }

    get height(): number {
        return this.demuxer.streams[this.#streamIndex].codecpar.height;
    }

    /**
     * Seek to a given PTS in the stream
     *
     * PTS stands for presentation time stamp. It's expressed in time_base units.
     * If timebase is 1/10000,
     * and a frame PTS is 10000,
     * Then the frame must be displayed at exactly 1 second.
     */
    async seekToPTS(targetPts: number) {
        if (targetPts === 0 && !this.packet) {
            // No need to seek, we haven't started reading yet.
            return;
        }
        this.lastFrame = null;
        this.#targetPts = targetPts;
        console.log(`Seeking to PTS=${targetPts}`);
        await this.#goToCurrentStream();
        await this.demuxer.seek({ stream_index: this.#streamIndex, timestamp: targetPts });
        await this.#goToCurrentStream();

        // When seeking to the past:
        // Skip any packets which were read before.
        // at a PTS bigger than the target PTS.
        while (this.packet && this.packet.pts > targetPts) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (this.packet.flags as any) = { DISCARD: true };
            await this.#nextPacket();
        }
    }


    /**
     * Dump one frame at a specific time
     *
     * This method can seek as required, but generally, it is designed to be
     * performant in the cases where we progressively read a video frame by frame.
     *
     * So the implementation in here should not seek all the time, but rather
     * read packets as they come, when possible,
     *
     * @see getFrameAtPts()
     */
    async getFrameAtTime(targetTime: number): Promise<beamcoder.Frame> {
        LOG_SINGLE_FRAME_DUMP_FLOW && console.log(`Requesting to dump a frame at Time(s)=${targetTime}`);
        const targetPts = Math.floor(this.timeToPts(targetTime));
        return this.getFrameAtPts(targetPts);
    }

    /**
     * Dump one frame's image data (for canvas) at a specific time
     *
     * @see getFrameAtTime()
     */
    async getImageDataAtTime(targetTime: number): Promise<ImageData> {
        LOG_SINGLE_FRAME_DUMP_FLOW && console.log(`Requesting to dump a frame at Time(s)=${targetTime}`);
        const targetPts = Math.floor(this.timeToPts(targetTime));
        const frame = await this.getFrameAtPts(targetPts);

        const components = 4; // 4 components: r, g, b and a
        const size = frame.width * frame.height * components;
        const rawData = new Uint8ClampedArray(size);
        const sourceLineSize = frame.linesize as unknown as number;
        const pixels = frame.data[0] as Uint8Array;

        // libav creates larger buffers because it makes their internal code simpler.
        // we have to trim a part at the right of each pixel row.
        for (let i = 0; i < frame.height; i++) {
            const sourceStart = i * sourceLineSize;
            const sourceEnd = sourceStart + frame.width * components;
            const sourceData = pixels.slice(sourceStart, sourceEnd);
            const targetOffset = i * frame.width * components;
            rawData.set(sourceData, targetOffset);
        }

        const image = createImageData(
            rawData,
            frame.width,
            frame.height
        );

        return image;
    }

    /**
     * Dump one frame at a specific pts
     *
     * This method can seek as required, but generally, it is designed to be
     * performant in the cases where we progressively read a video frame by frame.
     *
     * So the implementation in here should not seek all the time, but rather
     * read packets as they come, when possible,
     */
    async getFrameAtPts(targetPts: number): Promise<beamcoder.Frame> {
        LOG_SINGLE_FRAME_DUMP_FLOW && console.log(`Requesting to dump a frame at PTS=${targetPts}`);

        if (this.packet) {
            const newTime = this.ptsToTime(targetPts);
            const currentTime = this.ptsToTime(this.lastFrame.pts);

            // Heuristic: if moving more than `SEEK_DELAY` away, seek instead
            // of processing packets until target. Note that this logic is not
            // good if playback rate is faster.
            const SEEK_DELAY = 2.0;
            if (Math.abs(newTime - currentTime) > SEEK_DELAY) {
                LOG_SINGLE_FRAME_DUMP_FLOW && console.log(`Time difference is bigger than SEEK_DELAY=${SEEK_DELAY}. Seeking.`);
                await this.seekToPTS(targetPts);
            }
        }

        if (this.packet === null && this.filteredFrames.length === 0 && targetPts >= this.lastFrame.pts) {
            LOG_SINGLE_FRAME_DUMP_FLOW && console.log(`Last frame has been reached, resolving with last frame, pts=${this.lastFrame.pts}`);
            return this.lastFrame;
        }

        if (this.filteredFrames.length > 0 && targetPts < this.filteredFrames[0].pts) {
            LOG_SINGLE_FRAME_DUMP_FLOW && console.log(`Next frame is to be presented later (at PTS=${this.filteredFrames[0].pts}), resolving with last frame again, pts=${this.lastFrame.pts} [video fps is probably low]`);
            return this.lastFrame;
        }

        // TODO:
        //     - Seek if we are:
        //         - Seeking to the past;
        //         - Seeking beyond the next keyframe. AND; - or some other heuristic,
        //           such as seeking more than 1 seconds in the future.
        //     - Clear last image when seeking.
        //     - Clear extra frames when seeking

        // Read packets and dump a single frame.
        let finishReadingCleanlyPromise = null;

        const frame = await new Promise<beamcoder.Frame>(async resolve => {
            const onFrameAvailable = async(frame) => {
                LOG_SINGLE_FRAME_DUMP_FLOW && console.log(`Frame available: pts=${frame.pts}`);

                // When we decoded the next frame after targetPts,
                // that's when we know the last frame was the one
                // that had to be shown at targetPts
                if (frame.pts === targetPts) {
                    LOG_SINGLE_FRAME_DUMP_FLOW && console.log('frame.pts === targetPts | ', `${frame.pts} === ${targetPts} - resolving with this frame!`);
                    this.lastFrame = frame;
                    resolve(frame);
                    return false;
                }

                if (frame.pts > targetPts) {
                    if (this.lastFrame) {
                        LOG_SINGLE_FRAME_DUMP_FLOW && console.log('frame.pts > targetPts | ', `${frame.pts} > ${targetPts} - resolving with previous frame (PTS=${this.lastFrame.pts})!`);
                        resolve(this.lastFrame);
                        // Add this frame back to the buffer - we don't need it yet.
                        this.filteredFrames = [frame, ...this.filteredFrames];
                        return false;
                    }
                    else {
                        LOG_SINGLE_FRAME_DUMP_FLOW && console.log('frame.pts > targetPts | ', `${frame.pts} > ${targetPts} - but no last frame available - resolving with frame!`);
                        // Add this frame back to the buffer - we don't need it yet.
                        this.filteredFrames = [frame, ...this.filteredFrames];
                        this.lastFrame = frame;
                        resolve(frame);
                        return false;
                    }
                }

                if (this.packet === null && this.filteredFrames.length === 0 && targetPts >= this.lastFrame.pts) {
                    LOG_SINGLE_FRAME_DUMP_FLOW && console.log(`Last frame has been reached, resolving with last frame, pts=${this.lastFrame.pts}`);
                    resolve(frame);
                    return false;
                }

                LOG_SINGLE_FRAME_DUMP_FLOW && console.log('frame.pts < targetPts | ', `${frame.pts} < ${targetPts} - continuing`);

                this.lastFrame = frame;

                return true;
            };

            finishReadingCleanlyPromise = this.readFrames({
                onFrameAvailable,
                flush: true,
            });

            await finishReadingCleanlyPromise;
        });

        await finishReadingCleanlyPromise;

        return frame;
    }


    /**
     * Seek to a given time in the stream
     */
    async seekToTime(targetTime: number) {
        await this.seekToPTS(this.timeToPts(targetTime));
    }

    /**
     * Convert a time (in seconds) to PTS (based on timebase)
     */
    timeToPts(time: number) {
        const time_base = this.demuxer.streams[this.#streamIndex].time_base;
        return time * time_base[1] / time_base[0];
    }

    /**
     * Convert a PTS (based on timebase) to PTS (in seconds)
     */
    ptsToTime(pts: number) {
        const time_base = this.demuxer.streams[this.#streamIndex].time_base;
        return pts * time_base[0] / time_base[1];
    }

    /**
     * This just calls `this.demuxer.read()` with additional logging in case of errors.
     */
    async #readPacketWrapped() {
        if (this.#streamStopped) {
            throw new Error('Error: Trying to read after stream has stopped.');
        }
        try {
            const packet = await this.demuxer.read();
            if (!packet) {
                this.#streamStopped = true;
            }
            return packet;
        }
        catch (e) {
            throw e;
        }
    }

    async #nextPacket() {
        if (this.packet === null) {
            throw new Error('Stream is over!');
        }
        this.packet = await this.#readPacketWrapped();
        while (this.packet && this.packet.stream_index !== this.#streamIndex) {
            this.packet = await this.#readPacketWrapped();
            if (this.packet === null) {
                return;
            }
        }
    }

    async #goToCurrentStream() {
        while (!this.packet || this.packet.stream_index !== this.#streamIndex) {
            await this.#nextPacket();
        }
    }

    async #filterFrames(frames) {
        const result = await this.filterer.filter([{
            name: 'in0:v',
            frames: frames,
        }]);
        this.filteredFrames = result.flatMap(r => r.frames);
        return this.filteredFrames;
    }

    /**
     * Note: the promise returned is for the first frame only.
     */
    async #processFilteredFrames(frames: Frame[] | null, {
        onFrameAvailable = () => true,
    }: {
        onFrameAvailable?: (frame: beamcoder.Frame) => boolean | Promise<boolean>;
    }) {
        let needsMore = true;

        while (this.filteredFrames.length > 0 && needsMore) {
            const frame = this.filteredFrames.shift();
            LOG_PACKET_FLOW && console.log(`Sending filter result to encoder PTS=${frame.pts}`);
            needsMore = await onFrameAvailable(frame);
        }

        return { needsMore };
    }

    async #muxImageResults(imageResult): Promise<void> {
        for (let j = 0; j < imageResult.packets.length; j++) {
            const shouldSave = !this.#targetPts || imageResult.packets[j].pts >= this.#targetPts;

            if (shouldSave) {
                await this.muxer.writeFrame(imageResult.packets[j]);
                LOG_PACKET_FLOW && console.log(`wrote image ${JSON.stringify(imageResult.packets[j])}`);
            }
            else {
                LOG_PACKET_FLOW && console.log(`skipped image ${JSON.stringify(imageResult.packets[j])}`);
            }
        }
    }

    async #filterAndProcessFrames({
        decoderResult,
        onFrameAvailable,
    }: {
        decoderResult?: beamcoder.DecodedFrames;
        /**
         * Return true if we need to read more frames.
         */
        onFrameAvailable: (frame: Frame) => Promise<boolean> | boolean;
    }) {
        const filteredFrames = await this.#filterFrames(decoderResult.frames);
        const { needsMore } = await this.#processFilteredFrames(filteredFrames, {
            onFrameAvailable,
        });

        return { needsMore };
    }

    async #readPacketLoop({
        onFrameAvailable,
    }: {
        /**
         * Return true if we need to read more frames.
         */
        onFrameAvailable: (frame: Frame) => Promise<boolean> | boolean;
    }): Promise<{ needsMore: boolean; }> {
        await this.#nextPacket();
        while (this.packet) {
            const decoderResult = await this.decoder.decode(this.packet);
            LOG_PACKET_FLOW && console.log(`Received ${decoderResult.frames.length} decoder frames`);
            const { needsMore } = await this.#filterAndProcessFrames({
                decoderResult,
                onFrameAvailable,
            });

            if (!needsMore) {
                return { needsMore };
            }

            await this.#nextPacket();
        }

        return { needsMore: true };
    }

    /**
     * #hasEncoder
     *
     * Sometimes, we don't need to encode so we'll have no encoder.
     * (when reading raw frames, and no outputFile is given)
     * Otherwise, here we'll want to pass frames to the encoder as well
     * as running onFrameAvailable.
     */
    get #hasEncoder() {
        return this.encoder !== null;
    }

    async #flushEncoder() {
        if (!this.#hasEncoder) {
            return;
        }
        LOG_PACKET_FLOW && console.log(`\n                  Flushing encoder`);
        const imageResult = await this.encoder.flush();
        await this.#muxImageResults(imageResult);
    }

    async #flushFilterAndProcessFrames({
        onFrameAvailable,
    }: {
        onFrameAvailable: (frame: Frame) => Promise<boolean> | boolean;
    }) {
        LOG_PACKET_FLOW && console.log(`\n                  Flushing decoder`);

        if (this.#flushed) {
            throw new Error('Already flushed');
        }

        this.#flushed = true;
        const decoderResult = await this.decoder.flush();
        const { needsMore } = await this.#filterAndProcessFrames({
            decoderResult,
            onFrameAvailable,
        });

        if (!needsMore) {
            return;
        }

        await this.#flushEncoder();
    }

    /**
     * Detect multiple access to beamcoder which could put our system in an unexpected state.
     */
    async withLock(callback) {
        if (this.#locked) {
            throw new Error('Multiple attempts to use beamcoder at the same time.');
        }
        this.#locked = true;
        await callback();
        this.#locked = false;
    }

    /**
     * Dump all frames from the current point.
     * Stops processing packets after target is reached.
     */
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
        await this.withLock(async() => {
            const originalOnFrameAvailable = onFrameAvailable;

            if (this.#hasEncoder) {
                onFrameAvailable = async(frame): Promise<boolean> => {
                    LOG_PACKET_FLOW && console.log(`About to encode ${frame.pts}.\n`);
                    const imageResult = await this.encoder.encode(frame);
                    await this.#muxImageResults(imageResult);

                    LOG_PACKET_FLOW && console.log(`About to run originalOnFrameAvailable.\n`);
                    const needsMore = await originalOnFrameAvailable(frame);

                    return needsMore;
                };
            }

            // First output successively frames which were already decoded and filtered
            const needsMore = this.#processFilteredFrames([], { onFrameAvailable });
            if (!needsMore) {
                LOG_PACKET_FLOW && console.log('No need to read more after reading buffered frames.');
                return;
            }

            // Maybe after processing extra frames. there are no frames left, because
            // we already read the last packet the previous time around.
            if (this.packet === null) {
                return;
            }

            // Main reading loop
            // Most frame reading happens here.
            // We read packets, filter them and call onFrameAvailable to let the calling code
            // perform it's work.
            {
                const { needsMore } = await this.#readPacketLoop({ onFrameAvailable });
                if (!needsMore) {
                    return;
                }
            }

            // Flushing.
            // After every packet has been read by the main loop, we need to get the
            // last packets from the decoder (flush) and repeat filtering and calling onFrameAvailable like the main loop.
            if (flush) {
                await this.#flushFilterAndProcessFrames({ onFrameAvailable });
            }

            LOG_PACKET_FLOW && console.log(`\nRead frame ended.\n`);
        });
    }

    async dispose() {
        await new Promise((resolve) => {
            setTimeout(() => {
                if (this.readStream) {
                    // These might be creating memory issues.
                    this.readStream.unpipe(this.demuxerStream);
                    this.readStream.destroy();
                }
            }, 30);
        });
    }
}

type OutputFormats = 'mjpeg' | 'png' | 'tiff';

const createFrameDumpingEncoder = ({
    decoder,
    outputFormat,
    thread_count,
}: {
    decoder: beamcoder.Decoder;
    outputFormat: OutputFormats;
    thread_count: number;
}) => {
    let colorspace = 'rgb24';
    if (outputFormat === 'mjpeg') {
        colorspace = 'yuvj422p';
    }

    return beamcoder.encoder({
        name: outputFormat,
        width: decoder.width,
        height: decoder.height,
        pix_fmt: colorspace,
        thread_count: thread_count,
        time_base: [1, 1],
    });
};

const createFrameDumpingMuxer = async({
    filename,
    sourceDemuxer,
    thread_count,
    streamIndex,
}: {
    filename: string;
    sourceDemuxer: beamcoder.Demuxer;
    thread_count: number;
    streamIndex: number;
}) => {
    const demuxers = beamcoder.demuxers();
    // The iformat is necessary to have a working probe when using a stream
    const iformat = demuxers[Object.keys(demuxers).find(key => key.indexOf('mp4') > -1)];

    const muxer = beamcoder.muxer({
        name: 'image2',
        filename,
        thread_count: thread_count,
        iformat,
    });

    muxer.newStream(sourceDemuxer.streams[streamIndex]);
    await muxer.writeHeader();
    return muxer;
};
