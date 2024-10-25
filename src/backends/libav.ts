/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable no-undef */
/* eslint-disable @typescript-eslint/ban-types */
import type {
    Packet,
    Frame,
    Stream,
    CodecParameters,
    LibAV
} from 'libav.js';
import LibAVJs from 'libav.js';
// import * as LibAVWebCodecsBridge from 'libavjs-webcodecs-bridge';
import type { ImageData } from '../types';
import { BaseExtractor } from '../BaseExtractor';
import type { Extractor, ExtractorArgs } from '../../framefusion';

const VERBOSE = false;

/**
 * RGBA format need one byte for every components: r, g, b and a
 */
const RGBA_PIXEL_SIZE = 4;


class Decoder {
    decode: (packet: Packet) => Promise<{ frames: Frame[]; }>;
    flush: () => Promise<{ frames: Frame[]; }>;
}

class Demuxer {
    libav: LibAV;
    streams: Stream[];
    fmt_context: number;
    pkt: number;
    codecParameters: CodecParameters[];
    constructor(libav: LibAV, fmt_context: number, streams: Stream[], pkt: number, codecParameters: CodecParameters[]) {
        this.libav = libav;
        this.streams = streams;
        this.fmt_context = fmt_context;
        this.pkt = pkt;
        this.codecParameters = codecParameters;
    }

    async seek({ stream_index, timestamp, any }: {
        stream_index: 0; // even though we specify the stream index, it still seeks all streams
        timestamp: number;
        any: boolean;
    }): Promise<void> {
        await this.libav.avformat_seek_file_max(this.fmt_context, stream_index, timestamp, 0, 0);
    }

    async read(): Promise<Packet> {
        const n = await this.libav.av_read_frame(this.fmt_context, this.pkt);
        if (n === this.libav.AVERROR_EOF) {
            return null;
        }
        // console.log('read', n, 'packet');
        const packet = await this.libav.ff_copyout_packet(this.pkt);
        return packet;
    }

    forceClose() {
        console.log('forceClose');
    }
}

async function createDemuxer(libav: LibAV, file: ArrayBuffer): Promise<Demuxer> {
    await libav.mkreadaheadfile('input', new Blob([file]));
    const [fmt_ctx, istreams] =
        await libav.ff_init_demuxer_file('input');

    const pkt = await libav.av_packet_alloc();
    const codecParameters = await Promise.all(istreams.map((stream) => {
        return libav.ff_copyout_codecpar(stream.codecpar);
    }));

    return new Demuxer(libav, fmt_ctx, istreams, pkt, codecParameters);
}

const createDecoder = async({
    libav,
    demuxer,
    streamIndex,
    threadCount,
}: {
    libav: LibAV;
    demuxer: Demuxer;
    streamIndex: number;
    threadCount: number;
}) => {
    const istream = demuxer.streams[streamIndex];
    let streamToConfig;
    let Decoder: any;
    let packetToChunk: Function;
    if (istream.codec_type === libav.AVMEDIA_TYPE_VIDEO) {
        streamToConfig = window.LibAVWebCodecsBridge.videoStreamToConfig;
        Decoder = VideoDecoder;
        packetToChunk = window.LibAVWebCodecsBridge.packetToEncodedVideoChunk;
    }
    else if (istream.codec_type === libav.AVMEDIA_TYPE_AUDIO) {
        streamToConfig = window.LibAVWebCodecsBridge.audioStreamToConfig;
        Decoder = AudioDecoder;
        packetToChunk = window.LibAVWebCodecsBridge.packetToEncodedAudioChunk;
    }
    else {
        throw new Error('Unsupported stream type: ' + istream.codec_type);
    }

    // Convert the config
    const config = await streamToConfig(libav, istream);
    let supported;
    try {
        supported = await Decoder.isConfigSupported(config);
    }
    catch (ex) {}
    if (!supported || !supported.supported) {
        throw new Error('Codec not supported: ' + JSON.stringify(config));
    }

    let currFrames = [];

    // Make the decoder
    const decoder = new Decoder({
        output: frame => {
            // debugger;
            console.count('produced frame');
            currFrames.push(frame);
        },
        error: (error) => {
            alert('Decoder ' + JSON.stringify(config) + ':\n' + error);
        },
    });
    decoder.configure(config);
    return {
        flush: async() => {
            await decoder.flush();
            const result = { frames: currFrames };
            currFrames = [];
            return result;
        },
        decode: async(packet: Packet) => {
            if (packet.duration === 0) {
                await decoder.flush();
                console.log('Stream duration is unknown');
                // hrow new Error('Stream duration is unknown');
                return { frames: currFrames };
            }
            console.log('decode', {
                pts: packet.pts,
                dts: packet.dts,
                duration: packet.duration,
                stream_index: packet.stream_index,
                flags: packet.flags,
                stream: {
                    duration: istream.duration,
                    time_base_den: istream.time_base_den,
                    time_base_num: istream.time_base_num,
                },
            });
            const chunk = await packetToChunk(packet, istream);
            /// await decoder.flush();

            // if (chunk.type === 'key') {
            //     await decoder.flush();
            // }
            while (decoder.decodeQueueSize) {
                await new Promise(resolve => {
                    decoder.addEventListener('dequeue', resolve, { once: true });
                });
            }
            decoder.decode(chunk);
            const result = { frames: currFrames };
            currFrames = [];

            return result;
        },
    };
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
    }: ExtractorArgs): Promise<void> {
        const libav = await LibAVJs.LibAV({ noworker: true });
        this.#threadCount = threadCount;

        VERBOSE && console.log('downloading url', inputFileOrUrl);
        const buffer = await fetch(inputFileOrUrl).then((response) => response.arrayBuffer());
        VERBOSE && console.log('finished downloading');
        this.#demuxer = await createDemuxer(libav, buffer);
        this.#streamIndex = this.#demuxer.streams.findIndex(stream => stream.codec_type === libav.AVMEDIA_TYPE_VIDEO);

        if (this.#streamIndex === -1) {
            throw new Error(`File has no ${STREAM_TYPE_VIDEO} stream!`);
        }
    }

    async #createDecoder() {
        // It's possible that we need to create decoder multiple times during the lifecycle of this extractor so we
        // need to make sure we destroy the old one first if it exists
        if (this.#decoder) {
            await this.#decoder.flush();
            this.#decoder = null;
        }
        this.#decoder = await createDecoder({
            libav: this.#demuxer.libav,
            demuxer: this.#demuxer as Demuxer,
            streamIndex: this.#streamIndex,
            threadCount: this.#threadCount,
        });
    }

    /**
     * This is the duration of the first video stream in the file expressed in seconds.
     */
    get duration(): number {
        return this.ptsToTime(this.#demuxer.streams[this.#streamIndex].duration);
    }

    /**
     * Width in pixels
     */
    get width(): number {
        return this.#demuxer.codecParameters[this.#streamIndex].width;
    }

    /**
     * Height in pixels
     */
    get height(): number {
        return this.#demuxer.codecParameters[this.#streamIndex].height;
    }

    /**
     * Get the beamcoder Frame for a given time in seconds
     * @param targetTime
     */
    async getFrameAtTime(targetTime: number): Promise<any> {
        VERBOSE && console.log(`getFrameAtTime time(s)=${targetTime}`);
        const targetPts = Math.round(this._timeToPTS(targetTime));
        return this._getFrameAtPts(targetPts);
    }

    /**
     * Get imageData for a given time in seconds
     * @param targetTime
     */
    async getImageDataAtTime(targetTime: number, target?: Uint8ClampedArray): Promise<ImageData> {
        const targetPts = Math.round(this._timeToPTS(targetTime));
        VERBOSE && console.log('targetTime', targetTime, '-> targetPts', targetPts);
        const frame = await this._getFrameAtPts(targetPts);
        if (!frame) {
            VERBOSE && console.log('no frame found');
            return null;
        }

        let rawData = target;

        if (!target) {
            rawData = new Uint8ClampedArray(frame.width * frame.height * RGBA_PIXEL_SIZE);
        }

        this._setFrameDataToImageData(frame, rawData);

        return {
            data: rawData,
            width: frame.width,
            height: frame.height,
        };
    }

    /**
     * Get the presentation timestamp (PTS) for a given time in seconds
     */
    _timeToPTS(time: number) {
        const stream = this.#demuxer.streams[this.#streamIndex];
        return time * stream.time_base_den / stream.time_base_num;
    }

    /**
     * Get the time in seconds from a given presentation timestamp (PTS)
     */
    ptsToTime(pts: number) {
        const stream = this.#demuxer.streams[this.#streamIndex];
        return pts * stream.time_base_den / stream.time_base_num;
    }

    get packetReadCount() {
        return this.#packetReadCount;
    }

    timestampToPTS(timestamp: number) {
        return Math.round(this._timeToPTS(timestamp / 1000000));
    }

    /**
     * Get the frame at the given presentation timestamp (PTS)
     * @param targetPTS - the target presentation timestamp (PTS) we want to retrieve
     * @param SeekPTSOffset - the offset to use when seeking to the targetPTS. This is used when we have trouble finding
     * the targetPTS. We use it to further move away from the requested PTS to find a frame. The allows use to read
     * additional packets and find a frame that is closer to the targetPTS.
     */
    async _getFrameAtPts(targetPTS: number, SeekPTSOffset = 0): Promise<Frame> {
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
            return this.ptsToTime(Math.abs(targetPTS - this.timestampToPTS((frame as VideoFrame).timestamp))) < RE_SEEK_THRESHOLD;
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
                .find(f => this.timestampToPTS((f as VideoFrame).timestamp) <= targetPTS) as VideoFrame;

            if (closestFrame) {
                const nextFrame = this.#filteredFramesPacket
                    .flat()
                    .find(f => this.timestampToPTS((f as VideoFrame).timestamp) > this.timestampToPTS((closestFrame as VideoFrame).timestamp)) as VideoFrame;

                // VERBOSE && console.log('returning previously filtered frame with pts', (closestFrame as Frame).pts);
                closestFramePTS = this.timestampToPTS((closestFrame as VideoFrame).timestamp);
                outputFrame = closestFrame;

                if ((nextFrame && this.timestampToPTS((nextFrame as VideoFrame).timestamp) > targetPTS) || (closestFramePTS === targetPTS)) {
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
                filteredFrames = this.#frames;
                VERBOSE && console.log('filteredFrames', filteredFrames.length, 'filteredFrames.pts:', JSON.stringify(filteredFrames.map(f => f.pts)), '-> target.pts:', targetPTS);

                // get the closest frame to our target presentation timestamp (PTS)
                // Beamcoder returns decoded packet frames as follows: [1000, 2000, 3000, 4000]
                // If we're looking for a frame at 0, we want to return the frame at 1000
                // If we're looking for a frame at 2500, we want to return the frame at 2000
                const closestFrame = (this.#packetReadCount === 1 && this.timestampToPTS(filteredFrames[0].timestamp) > targetPTS)
                    ? filteredFrames[0]
                    : filteredFrames.reverse().find(f => this.timestampToPTS(f.timestamp) <= targetPTS);

                // The packet contains frames, but all of them have PTS larger than our a targetPTS (we looked too far)
                if (!closestFrame) {
                    return outputFrame;
                }

                // store the filtered packet frames for later reuse
                this.#filteredFramesPacket.unshift(filteredFrames);
                if (this.#filteredFramesPacket.length > 2) {
                    this.#filteredFramesPacket.pop();
                }

                closestFramePTS = this.timestampToPTS(closestFrame?.timestamp);
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

    _setFrameDataToImageData(frame: Frame, target: Uint8ClampedArray) {
        // do smth
    }

    async dispose() {
        if (this.#decoder) {
            await this.#decoder.flush();
            this.#decoder = null;
        }
        this.#demuxer.forceClose();
        this.#filteredFramesPacket = undefined;
        this.#frames = [];
        this.#packet = null;
        this.#previousTargetPTS = null;
        this.#streamIndex = 0;
    }
}
