import type {
    Packet,
    Demuxer,
    Decoder,
    Filterer,
    Frame
} from '@lumen5/beamcoder';
import beamcoder from '@lumen5/beamcoder';
import type { ImageData } from '../types';
import { BaseExtractor } from '../BaseExtractor';
import type { Extractor, ExtractorArgs, InterpolateMode } from '../../framefusion';
import { DownloadVideoURL } from '../DownloadVideoURL';

const VERBOSE = false;

/**
 * RGBA format need one byte for every components: r, g, b and a
 */
const RGBA_PIXEL_SIZE = 4;

const createDecoder = ({
    demuxer,
    streamIndex,
    threadCount,
}: {
    demuxer: Demuxer;
    streamIndex: number;
    threadCount: number;
}): Decoder => {
    const commonParams = {
        width: demuxer.streams[streamIndex].codecpar.width,
        height: demuxer.streams[streamIndex].codecpar.height,
        pix_fmt: demuxer.streams[streamIndex].codecpar.format,
        thread_count: threadCount,
    };

    if (demuxer.streams[streamIndex].codecpar.name === 'vp8') {
        return beamcoder.decoder({
            ...commonParams,
            name: 'libvpx',
        });
    }

    if (demuxer.streams[streamIndex].codecpar.name === 'vp9') {
        return beamcoder.decoder({
            ...commonParams,
            name: 'libvpx-vp9',
        });
    }

    return beamcoder.decoder({
        ...commonParams,
        demuxer: demuxer,
        stream_index: streamIndex,
    });
};

/**
 * A filter to convert between color spaces.
 * An example would be YUV to RGB, for mp4 to png conversion.
 */
const createFilter = async({
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

    const filterSpecStr = filterSpec.join(', ') + '[out0:v]';

    VERBOSE && console.log(`filterSpec: ${filterSpecStr}`);

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

const STREAM_TYPE_VIDEO = 'video';
const MAX_RECURSION = 5;

/**
 * A simple extractor that uses beamcoder to extract frames from a video file.
 */
export class BeamcoderExtractor extends BaseExtractor implements Extractor {
    /**
     * The demuxer reads the file and outputs packet streams
     */
    #demuxer: Demuxer = null;

    /**
     * The decoder reads packets and can output raw frame data
     */
    #decoder: Decoder = null;

    /**
     * Packets can be filtered to change colorspace, fps and add various effects. If there are no colorspace changes or
     * filters, filter might not be necessary.
     */
    #filterer: Filterer = null;

    /**
     * This is where we store filtered frames from each previously processed packet.
     * We keep these in chronological order. We hang on to them for two reasons:
     * 1. so we can return them if we get a request for the same time again
     * 2. so we can return frames close the end of the stream. When such a frame is requested we have to flush (destroy)
     * the encoder to get the last few frames. This avoids having to re-create an encoder.
     */
    #filteredFramesPacket: undefined[] | Array<Array<Frame>> = [];

    /**
     * This contains the last raw frames we read from the demuxer. We use it as a starting point for each new query. We
     * do this ensure we don't skip any frames.
     */
    #frames = [];

    /**
     * This contains the last packet we read from the demuxer. We use it as a starting point for each new query. We do
     * this ensure we don't skip any frames.
     */
    #packet: null | Packet = null;

    /**
     * The last target presentation timestamp (PTS) we requested. If we never requested a time(stamp) then this
     * value is null
     */
    #previousTargetPTS: null | number = null;

    /**
     * The number of threads to use for decoding
     */
    #threadCount = 8;

    /**
     * The index of the video stream in the demuxer
     */
    #streamIndex = 0;

    /**
     * The number of packets we've read from the demuxer to complete the frame query
     * @private
     */
    #packetReadCount = 0;

    /**
     * The number of times we've recursively read packets from the demuxer to complete the frame query
     * @private
     */
    #recursiveReadCount = 0;

    /**
     * Encoder/Decoder construction is async, so it can't be put in a regular constructor.
     * Use and await this method to generate an extractor.
     */
    static async create(args: ExtractorArgs): Promise<BeamcoderExtractor> {
        const extractor = new BeamcoderExtractor();
        await extractor.init(args);
        return extractor;
    }

    async init({
        inputFileOrUrl,
        threadCount = 8,
        outputPixelFormat = 'rgba',
    }: ExtractorArgs): Promise<void> {
        this.#threadCount = threadCount;
        if (inputFileOrUrl.startsWith('http')) {
            VERBOSE && console.log('downloading url', inputFileOrUrl);
            const downloadUrl = new DownloadVideoURL(inputFileOrUrl);
            await downloadUrl.download();
            inputFileOrUrl = downloadUrl.filepath;
            VERBOSE && console.log('finished downloading');
        }
        // Assume file url at this point
        if (!inputFileOrUrl.startsWith('file:')) {
            inputFileOrUrl = 'file:' + inputFileOrUrl;
        }
        this.#demuxer = await beamcoder.demuxer(inputFileOrUrl);
        this.#streamIndex = this.#demuxer.streams.findIndex(stream => stream.codecpar.codec_type === STREAM_TYPE_VIDEO);

        if (this.#streamIndex === -1) {
            throw new Error(`File has no ${STREAM_TYPE_VIDEO} stream!`);
        }
        this.#filterer = await createFilter({
            stream: this.#demuxer.streams[this.#streamIndex],
            outputPixelFormat: outputPixelFormat === 'original' ? this.#demuxer.streams[this.#streamIndex].codecpar.format : 'rgba',
        });
    }

    async #createDecoder() {
        // It's possible that we need to create decoder multiple times during the lifecycle of this extractor so we
        // need to make sure we destroy the old one first if it exists
        if (this.#decoder) {
            await this.#decoder.flush();
            this.#decoder = null;
        }
        this.#decoder = createDecoder({
            demuxer: this.#demuxer as Demuxer,
            streamIndex: this.#streamIndex,
            threadCount: this.#threadCount,
        });
    }

    get duration(): number {
        const maxStreamsDuration = Math.max(...this.#demuxer.streams
            .map(s => {
                const time_base = s.time_base;
                return s.duration * time_base[0] / time_base[1];
            }));
        // MP4 duration is defined as the longest stream duration
        // Webm stores it in Segment.Info.Duration
        return maxStreamsDuration || (this.ptsToTime(this.#demuxer.duration) / 1000);
    }

    /**
     * Width in pixels
     */
    get width(): number {
        return this.#demuxer.streams[this.#streamIndex].codecpar.width;
    }

    /**
     * Height in pixels
     */
    get height(): number {
        return this.#demuxer.streams[this.#streamIndex].codecpar.height;
    }

    /**
     * Get the beamcoder Frame for a given time in seconds
     * @param targetTime
     */
    async getFrameAtTime(targetTime: number): Promise<beamcoder.Frame> {
        VERBOSE && console.log(`getFrameAtTime time(s)=${targetTime}`);
        const targetPts = Math.round(this._timeToPTS(targetTime));
        return this._getFrameAtPts(targetPts);
    }

    /**
     * Get imageData for a given time in seconds
     * @param targetTime
     */
    async getImageDataAtTime(targetTime: number, rgbaBufferTarget?: Uint8ClampedArray): Promise<ImageData> {
        const targetPts = Math.round(this._timeToPTS(targetTime));
        VERBOSE && console.log('targetTime', targetTime, '-> targetPts', targetPts);
        const frame = await this._getFrameAtPts(targetPts);
        if (!frame) {
            VERBOSE && console.log('no frame found');
            return null;
        }

        if (rgbaBufferTarget) {
            this._setFrameDataToRGBABufferTarget(frame, rgbaBufferTarget);
        }

        return {
            width: frame.width,
            height: frame.height,
            frame,
        };
    }

    /**
     * Get the presentation timestamp (PTS) for a given time in seconds
     */
    _timeToPTS(time: number) {
        const time_base = this.#demuxer.streams[this.#streamIndex].time_base;
        return time * time_base[1] / time_base[0];
    }

    /**
     * Get the time in seconds from a given presentation timestamp (PTS)
     */
    ptsToTime(pts: number) {
        const time_base = this.#demuxer.streams[this.#streamIndex].time_base;
        return pts * time_base[0] / time_base[1];
    }

    get packetReadCount() {
        return this.#packetReadCount;
    }

    /**
     * Get the frame at the given presentation timestamp (PTS)
     * @param targetPTS - the target presentation timestamp (PTS) we want to retrieve
     * @param SeekPTSOffset - the offset to use when seeking to the targetPTS. This is used when we have trouble finding
     * the targetPTS. We use it to further move away from the requested PTS to find a frame. The allows use to read
     * additional packets and find a frame that is closer to the targetPTS.
     */
    async _getFrameAtPts(targetPTS: number, SeekPTSOffset = 0): Promise<beamcoder.Frame> {
        VERBOSE && console.log('_getFrameAtPts', targetPTS, 'seekPTSOffset', SeekPTSOffset, 'duration', this.duration);
        this.#packetReadCount = 0;

        // seek and create a decoder when retrieving a frame for the first time or when seeking backwards
        // we have to create a new decoder when seeking backwards as the decoder can only process frames in
        // chronological order.
        // RE_SEEK_DELTA: sometimes, we are looking for a frame so far ahead that it's better to drop everything and seek.
        // Example: when we got a frame a 0 and request a frame at t = 30s just after, we don't want to start reading all packets
        // until 30s.
        const RE_SEEK_THRESHOLD = 3; // 3 seconds - typically we have keyframes at shorter intervals
        const hasFrameWithinThreshold = this.#filteredFramesPacket.flat().some(frame => {
            return this.ptsToTime(Math.abs(targetPTS - (frame as Frame).pts)) < RE_SEEK_THRESHOLD;
        });
        VERBOSE && console.log('hasPreviousTargetPTS:', this.#previousTargetPTS === null, ', targetPTS is smaller:', this.#previousTargetPTS > targetPTS, ', has frame within threshold:', hasFrameWithinThreshold);
        if (this.#previousTargetPTS === null || this.#previousTargetPTS > targetPTS || !hasFrameWithinThreshold) {
            VERBOSE && console.log(`Seeking to ${targetPTS + SeekPTSOffset}`);

            await this.#demuxer.seek({
                stream_index: 0, // even though we specify the stream index, it still seeks all streams
                timestamp: targetPTS + SeekPTSOffset,
                any: false,
            });
            await this.#createDecoder();
            this.#packet = null;
            this.#frames = [];
            this.#previousTargetPTS = targetPTS;
            this.#filteredFramesPacket = [];
        }

        let filteredFrames = null;
        let closestFramePTS = -1;
        let outputFrame = null;

        // If we have previously filtered frames, get the frame closest to our targetPTS
        if (this.#filteredFramesPacket.length > 0) {
            const closestFrame = this.#filteredFramesPacket
                .flat()
                .find(f => (f as Frame).pts <= targetPTS) as Frame;

            if (closestFrame) {
                const nextFrame = this.#filteredFramesPacket
                    .flat()
                    .find(f => (f as Frame).pts > closestFrame.pts) as Frame;

                VERBOSE && console.log('returning previously filtered frame with pts', (closestFrame as Frame).pts);
                closestFramePTS = (closestFrame as Frame).pts;
                outputFrame = closestFrame;

                if ((nextFrame && nextFrame.pts > targetPTS) || (closestFramePTS === targetPTS)) {
                    // We have a next frame, so we know the frame being displayed at targetPTS is the previous one,
                    // which corresponds to outputFrame.
                    this.#previousTargetPTS = targetPTS;
                    return outputFrame;
                }
            }
        }

        // This is the first time we're decoding frames. Get the first packet and decode it.
        if (!this.#packet && this.#frames.length === 0) {
            ({ packet: this.#packet, frames: this.#frames } = await this._getNextPacketAndDecodeFrames());
            this.#packetReadCount++;
        }
        // Read packets until we have a frame which is closest to targetPTS
        while ((this.#packet || this.#frames.length !== 0) && closestFramePTS < targetPTS) {
            VERBOSE && console.log('packet si:', this.#packet?.stream_index, 'pts:', this.#packet?.pts, 'frames:', this.#frames?.length);
            VERBOSE && console.log('frames', this.#frames?.length, 'frames.pts:', JSON.stringify(this.#frames?.map(f => f.pts)), '-> target.pts:', targetPTS);

            // packet contains frames
            if (this.#frames.length !== 0) {
                // filter the frames
                const filteredResult = await this.#filterer.filter([{ name: 'in0:v', frames: this.#frames }]);
                filteredFrames = filteredResult.flatMap(r => r.frames);
                VERBOSE && console.log('filteredFrames', filteredFrames.length, 'filteredFrames.pts:', JSON.stringify(filteredFrames.map(f => f.pts)), '-> target.pts:', targetPTS);

                // get the closest frame to our target presentation timestamp (PTS)
                // Beamcoder returns decoded packet frames as follows: [1000, 2000, 3000, 4000]
                // If we're looking for a frame at 0, we want to return the frame at 1000
                // If we're looking for a frame at 2500, we want to return the frame at 2000
                const closestFrame = (this.#packetReadCount === 1 && filteredFrames[0].pts > targetPTS)
                    ? filteredFrames[0]
                    : filteredFrames.reverse().find(f => f.pts <= targetPTS);

                // The packet contains frames, but all of them have PTS larger than our a targetPTS (we looked too far)
                if (!closestFrame) {
                    return outputFrame;
                }

                // store the filtered packet frames for later reuse
                this.#filteredFramesPacket.unshift(filteredFrames);
                if (this.#filteredFramesPacket.length > 2) {
                    this.#filteredFramesPacket.pop();
                }

                closestFramePTS = closestFrame?.pts;
                VERBOSE && console.log('closestFramePTS', closestFramePTS, 'targetPTS', targetPTS);
                if (!outputFrame || closestFramePTS <= targetPTS) {
                    VERBOSE && console.log('assigning outputFrame', closestFrame?.pts);
                    this.#previousTargetPTS = targetPTS;
                    outputFrame = closestFrame;
                }
                else {
                    // break out of the loop if we've found the closest frame (and ensure we don't move to the next
                    // packet by calling _getNextPacketAndDecodeFrames again) as this risks us getting a frame that is
                    // after our targetPTS
                    VERBOSE && console.log('breaking');
                    break;
                }
            }
            // get the next packet and frames
            ({ packet: this.#packet, frames: this.#frames } = await this._getNextPacketAndDecodeFrames());

            // keep track of how many packets we've read
            this.#packetReadCount++;
        }

        // we read through all the available packets and frames, but we still don't have a frame. This can happen
        // when our targetPTS is to close to the end of the video. In this case, we'll try to seek further away from
        // the end of the video and try again. We've set up a MAX_RECURSION to prevent an infinite loop.
        if (!outputFrame) {
            if (MAX_RECURSION < this.#recursiveReadCount) {
                throw Error('No matching frame found');
            }
            const TIME_OFFSET = 0.1; // time offset in seconds
            const PTSOffset = this._timeToPTS(TIME_OFFSET);
            this.#recursiveReadCount++;
            outputFrame = await this._getFrameAtPts(targetPTS, SeekPTSOffset - PTSOffset);
            if (outputFrame) {
                this.#recursiveReadCount = 0;
            }
        }
        VERBOSE && console.log('read', this.packetReadCount, 'packets');

        return outputFrame;
    }

    /**
     * Get the next packet from the video stream and decode it into frames. Each frame has a presentation time stamp
     * (PTS). If we've reached the end of the stream and no more packets are available, we'll extract the last frames
     * from the decoder and destroy it.
     */
    async _getNextPacketAndDecodeFrames() {
        const packet = await this._getNextVideoStreamPacket();
        VERBOSE && console.log('packet pts:', packet?.pts);

        // extract frames from the packet
        let decodedFrames = null;
        if (packet !== null && this.#decoder) {
            decodedFrames = await this.#decoder.decode(packet as Packet);
            VERBOSE && console.log('decodedFrames', decodedFrames.frames.length, decodedFrames.frames.map(f => f.pts));
        }
        // we've reached the end of the stream
        else {
            if (this.#decoder) {
                VERBOSE && console.log('getting the last frames from the decoder');
                // flush the decoder -- this will return the last frames and destroy the decoder
                decodedFrames = await this.#decoder.flush();
                this.#decoder = null;
            }
            else {
                // we don't have a decoder, so we can't decode any more frames
                VERBOSE && console.log('no more frames to decode');
            }
        }

        let frames = [];
        if (decodedFrames && decodedFrames.frames.length !== 0) {
            frames = decodedFrames.frames;
        }
        VERBOSE && console.log(`returning ${frames.length} decoded frames`);

        return { packet, frames };
    }

    async _getNextVideoStreamPacket(): Promise<null | Packet> {
        VERBOSE && console.log('_getNextVideoStreamPacket');

        let packet = await this.#demuxer.read();
        while (packet && packet.stream_index !== this.#streamIndex) {
            packet = await this.#demuxer.read();
            if (packet === null) {
                VERBOSE && console.log('no more packets');
                return null;
            }
        }
        VERBOSE && console.log('returning packet', !!packet, 'pts', packet?.pts, 'si', packet?.stream_index);
        return packet as Packet;
    }

    _setFrameDataToRGBABufferTarget(frame: beamcoder.Frame, rgbaBufferTarget: Uint8ClampedArray) {
        const sourceLineSize = frame.linesize as unknown as number;
        // frame.data can contain multiple "planes" in other colorspaces, but in rgba, there is just one "plane", so
        // our data is in frame.data[0]
        const pixels = frame.data[0] as Uint8Array;

        // libav creates larger buffers because it makes their internal code simpler.
        // we have to trim a part at the right of each pixel row.

        for (let i = 0; i < frame.height; i++) {
            const sourceStart = i * sourceLineSize;
            const sourceEnd = sourceStart + frame.width * RGBA_PIXEL_SIZE;
            const sourceData = pixels.subarray(sourceStart, sourceEnd);
            const targetOffset = i * frame.width * RGBA_PIXEL_SIZE;
            rgbaBufferTarget.set(sourceData, targetOffset);
        }
    }

    async dispose() {
        if (this.#decoder) {
            await this.#decoder.flush();
            this.#decoder = null;
        }
        this.#demuxer.forceClose();
        this.#filterer = null;
        this.#filteredFramesPacket = undefined;
        this.#frames = [];
        this.#packet = null;
        this.#previousTargetPTS = null;
        this.#streamIndex = 0;
    }
}
