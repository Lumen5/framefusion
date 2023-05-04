import type {
    DecodedFrames,
    Packet,
    Demuxer,
    Decoder,
    Filterer
} from '@antoinemopa/beamcoder';
import beamcoder from '@antoinemopa/beamcoder';
import type { ImageData } from 'canvas';
import { createImageData } from 'canvas';
import { BaseExtractor } from '../BaseExtractor';
import type { Extractor, ExtractorArgs, InterpolateMode } from '../../framefusion';
import { DownloadVideoURL } from '../DownloadVideoURL';

const VERBOSE = false;

const createDecoder = ({
    demuxer,
    streamIndex,
    threadCount,
}: {
    demuxer: Demuxer;
    streamIndex: number;
    threadCount: number;
}): Decoder => {
    return beamcoder.decoder({
        demuxer: demuxer,
        width: demuxer.streams[streamIndex].codecpar.width,
        height: demuxer.streams[streamIndex].codecpar.height,
        stream_index: streamIndex,
        pix_fmt: demuxer.streams[streamIndex].codecpar.format,
        thread_count: threadCount,
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
const COLORSPACE_RGBA = 'rgba';

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
     * This is where we store available filtered frames which have not been requested yet.
     * We keep these in chronological order. We hang on to them for two reasons:
     * 1. so we can return them if we get a request for the same time again
     * 2. so we can return frames close the end of the stream. When such a frame is requested we have to flush (destroy)
     * the encoder to get the last few frames. This avoids having to re-create an encoder.
     */
    #filteredFrames: undefined[] | DecodedFrames = [];

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
    }: ExtractorArgs): Promise<void> {
        this.#threadCount = threadCount;
        if (inputFileOrUrl.startsWith('http')) {
            VERBOSE && console.log('downloading url', inputFileOrUrl);
            const downloadUrl = new DownloadVideoURL(inputFileOrUrl);
            await downloadUrl.download();
            inputFileOrUrl = downloadUrl.filepath;
            VERBOSE && console.log('finished downloading');
        }
        this.#demuxer = await beamcoder.demuxer('file:' + inputFileOrUrl);
        this.#streamIndex = this.#demuxer.streams.findIndex(stream => stream.codecpar.codec_type === STREAM_TYPE_VIDEO);
        if (this.#streamIndex === -1) {
            throw new Error(`File has no ${STREAM_TYPE_VIDEO} stream!`);
        }
        this.#filterer = await createFilter({
            stream: this.#demuxer.streams[this.#streamIndex],
            outputPixelFormat: COLORSPACE_RGBA,
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

    /**
     * Duration in seconds
     */
    get duration(): number {
        const time_base = this.#demuxer.streams[this.#streamIndex].time_base;
        const durations = this.#demuxer.streams.map(
            stream => stream.duration * time_base[0] / time_base[1]
        );

        return Math.max(...durations);
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
        const targetPts = Math.floor(this._timeToPTS(targetTime));
        return this._getFrameAtPts(targetPts);
    }

    /**
     * Get imageData for a given time in seconds
     * @param targetTime
     */
    async getImageDataAtTime(targetTime: number): Promise<ImageData> {
        const targetPts = Math.floor(this._timeToPTS(targetTime));
        VERBOSE && console.log('targetTime', targetTime, '-> targetPts', targetPts);
        const frame = await this._getFrameAtPts(targetPts);
        if (!frame) {
            VERBOSE && console.log('no frame found');
            return null;
        }
        const rawData = this._resizeFrameData(frame);
        const image = createImageData(
            rawData,
            frame.width,
            frame.height
        ) as ImageData;
        return image;
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

    /**
     * Get the frame at the given presentation timestamp (PTS)
     */
    async _getFrameAtPts(targetPTS: number) {
        VERBOSE && console.log('_getFrameAtPts', targetPTS, '-> duration', this.duration);
        let packetReadCount = 0;

        // seek and create a decoder when retrieving a frame for the first time or when seeking backwards
        //  we have to create a new decoder when seeking backwards as the decoder can only process frames in
        //  chronological order.
        if (!this.#previousTargetPTS || this.#previousTargetPTS > targetPTS) {
            await this.#demuxer.seek({
                stream_index: 0, // even though we specify the stream index, it still seeks all streams
                timestamp: targetPTS,
                any: false,
            });
            await this.#createDecoder();
            this.#packet = null;
            this.#frames = [];
        }

        // the decoder has been previously flushed while retrieving frames at the end of the stream and has thus been
        // destroyed. See if the requested targetPTS is part of the last few frames we decoded. If so, return it.
        if (!this.#decoder) {
            VERBOSE && console.log('no decoder');
            if ((this.#filteredFrames as any).length > 0) {
                const closestFrame = (this.#filteredFrames as any).find(f => f.pts <= targetPTS);
                // we should probably check the delta between the targetPTS and the closestFrame. If it's too big, we
                // should return null or something.
                VERBOSE && console.log('returning closest frame with pts', closestFrame.pts);
                VERBOSE && console.log('read', packetReadCount, 'packets');
                this.#previousTargetPTS = targetPTS;
                return closestFrame;
            }
            throw Error('Unexpected condition: no decoder and no frames');
        }

        // Read packets until we have a frame which is closest to targetPTS
        let filteredFrames = null;
        let closestFramePTS = -1;
        let outputFrame = null;

        // This is the first time we're decoding frames. Get the first packet and decode it.
        if (!this.#packet && this.#frames.length === 0) {
            ({ packet: this.#packet, frames: this.#frames } = await this._getNextPacketAndDecodeFrames());
            packetReadCount++;
        }
        while ((this.#packet || this.#frames.length !== 0) && closestFramePTS < targetPTS) {
            VERBOSE && console.log('packet si:', this.#packet?.stream_index, 'pts:', this.#packet?.pts, 'frames:', this.#frames?.length);
            VERBOSE && console.log('frames', this.#frames?.length, 'frames.pts:', this.#frames?.map(f => f.pts), '-> target.pts:', targetPTS);

            // packet contains frames
            if (this.#frames.length !== 0) {
                // filter the frames
                const filteredResult = await this.#filterer.filter([{ name: 'in0:v', frames: this.#frames }]);
                filteredFrames = filteredResult.flatMap(r => r.frames);
                VERBOSE && console.log('filteredFrames', filteredFrames.length, 'filteredFrames.pts:', filteredFrames.map(f => f.pts), '-> target.pts:', targetPTS);
                this.#filteredFrames = filteredFrames as beamcoder.DecodedFrames;

                // get the closest frame to our target presentation timestamp (PTS)
                // Beamcoder returns decoded packet frames as follows: [1000, 2000, 3000, 4000]
                // If we're looking for a frame at 2500, we want to return the frame at 2000
                const closestFrame = filteredFrames.reverse().find(f => f.pts <= targetPTS);
                closestFramePTS = closestFrame?.pts;
                VERBOSE && console.log('closestFramePTS', closestFramePTS, 'targetPTS', targetPTS);
                if (!outputFrame || closestFramePTS < targetPTS) {
                    VERBOSE && console.log('assigning outputFrame', closestFrame?.pts);
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
            packetReadCount++;
        }

        if (!outputFrame) {
            throw Error('No matching frame found');
        }
        VERBOSE && console.log('read', packetReadCount, 'packets');

        this.#previousTargetPTS = targetPTS;
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

        // NOTE: maybe we should only decode frames when we're relatively close to our targetPTS?
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

        return { packet, frames };
    }

    async _getNextVideoStreamPacket(): Promise<null | Packet> {
        VERBOSE && console.log('_getNextVideoStreamPacket');

        let packet = await this.#demuxer.read();
        // VERBOSE && console.log('packet pts', packet.pts, 'stream_index', packet.stream_index);
        while (packet && packet.stream_index !== this.#streamIndex) {
            packet = await this.#demuxer.read();
            // VERBOSE && console.log('packet pts', packet.pts, 'stream_index', packet.stream_index);
            if (packet === null) {
                VERBOSE && console.log('no more packets');
                return null;
            }
        }
        VERBOSE && console.log('returning packet', !!packet, 'pts', packet?.pts, 'si', packet?.stream_index);
        return packet as Packet;
    }

    _resizeFrameData(frame): Uint8ClampedArray {
        const components = 4; // 4 components: r, g, b and a
        const size = frame.width * frame.height * components;
        const rawData = new Uint8ClampedArray(size); // we should probably reuse this buffer
        const sourceLineSize = frame.linesize as unknown as number;
        // frame.data can contain multiple "planes" in other colorspaces, but in rgba, there is just one "plane", so
        // our data is in frame.data[0]
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
        return rawData;
    }

    async dispose() {
        if (this.#decoder) {
            await this.#decoder.flush();
            this.#decoder = null;
        }
        this.#demuxer.forceClose();
        this.#filterer = null;
        this.#filteredFrames = undefined;
        this.#frames = [];
        this.#packet = null;
        this.#previousTargetPTS = null;
        this.#streamIndex = 0;
    }
}
