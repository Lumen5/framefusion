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

const LOG = false;

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

    filterSpec = [...filterSpec];

    const filterSpecStr = filterSpec.join(', ') + '[out0:v]';

    LOG && console.log(`filterSpec: ${filterSpecStr}`);

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

const MAX_PACKET_READS = 1000;
const STREAM_TYPE_VIDEO = 'video';

/**
 * A simple extractor that uses beamcoder to extract frames from a video file.
 */
export class SimpleExtractor extends BaseExtractor implements Extractor {
    /**
     * The demuxer reads the file and outputs packet streams
     */
    demuxer: Demuxer = null;

    /**
     * The decoder reads packets and can output raw frame data
     */
    decoder: Decoder = null;

    /**
     * Packets can be filtered to change colorspace, fps and add various effects. If there are no color space changes or
     * filters, filter might not be necessary.
     */
    filterer: Filterer = null;

    /**
     * This is where we store our filtered frames closest to the target time. We hang on to them for two reasons:
     * 1. so we can return them if we get a request for the same time again
     * 2. so we can return frames close the end of the stream. When such a frame is requested we have to flush (destroy)
     * the encoder to get the last few frames. This avoids having to re-create an encoder.
     */
    filteredFrames: undefined[] | DecodedFrames = [];

    /**
     * This contains the last raw frames we read from the demuxer. We use it as a starting point for each new query. We
     * do this ensure we don't skip any frames.
     */
    frames = [];

    /**
     * This contains the last packet we read from the demuxer. We use it as a starting point for each new query. We do
     * this ensure we don't skip any frames.
     */
    packet: Packet = null;

    /**
     * The last target presentation timestamp (PTS) we requested. If we never requested a time(stamp) then this
     * value is null
     */
    previousTargetPTS: null | number = null;

    /**
     * The number of threads to use for decoding
     */
    threadCount = 8;

    /**
     * The index of the video stream in the demuxer
     * @param args
     */
    streamIndex = 0;

    static async create(args: ExtractorArgs): Promise<Extractor> {
        const extractor = new SimpleExtractor();
        await extractor.init(args);
        return extractor as unknown as Extractor;
    }

    async init({
        inputFileOrUrl,
        threadCount = 8,
    }: ExtractorArgs): Promise<void> {
        this.threadCount = threadCount;
        if (inputFileOrUrl.startsWith('http')) {
            LOG && console.log('downloading url', inputFileOrUrl);
            const downloadUrl = new DownloadVideoURL(inputFileOrUrl);
            await downloadUrl.download();
            inputFileOrUrl = downloadUrl.filepath;
            LOG && console.log('finished downloading');
        }
        LOG && console.log('loading', inputFileOrUrl);
        this.demuxer = await beamcoder.demuxer('file:' + inputFileOrUrl);
        LOG && console.log('streams', this.demuxer.streams.map(stream => stream.codecpar.codec_type));
        this.streamIndex = this.demuxer.streams.findIndex(stream => stream.codecpar.codec_type === STREAM_TYPE_VIDEO);
        LOG && console.log('streamIndex', this.streamIndex);
        if (this.streamIndex === -1) {
            throw new Error(`File has no ${STREAM_TYPE_VIDEO} stream!`);
        }
        LOG && console.log('stream type', this.demuxer.streams[this.streamIndex].codecpar.codec_type);
        this.filterer = await createFilter({
            stream: this.demuxer.streams[this.streamIndex],
            outputPixelFormat: 'rgba',
        });
    }

    _createDecoder() {
        if (this.decoder) {
            this.decoder.flush();
            this.decoder = null;
        }
        this.decoder = createDecoder({
            demuxer: this.demuxer as Demuxer,
            streamIndex: this.streamIndex,
            threadCount: this.threadCount,
        });
    }

    /**
     * Duration in seconds
     */
    get duration(): number {
        const time_base = this.demuxer.streams[this.streamIndex].time_base;
        const durations = this.demuxer.streams.map(
            stream => stream.duration * time_base[0] / time_base[1]
        );

        return Math.max(...durations);
    }

    /**
     * Width in pixels
     */
    get width(): number {
        return this.demuxer.streams[this.streamIndex].codecpar.width;
    }

    /**
     * Height in pixels
     */
    get height(): number {
        return this.demuxer.streams[this.streamIndex].codecpar.height;
    }

    /**
     * Get the frame for a given time in seconds
     * @param targetTime
     */
    async getFrameAtTime(targetTime: number): Promise<beamcoder.Frame> {
        LOG && console.log(`getFrameAtTime time(s)=${targetTime}`);
        const targetPts = Math.floor(this._timeToPTS(targetTime));
        return this._getFrameAtPts(targetPts);
    }

    /**
     * Get imageData for a given time in seconds
     * @param targetTime
     */
    async getImageDataAtTime(targetTime: number): Promise<ImageData> {
        const targetPts = Math.floor(this._timeToPTS(targetTime));
        LOG && console.log('targetTime', targetTime, '-> targetPts', targetPts);
        const frame = await this._getFrameAtPts(targetPts);
        if (!frame) {
            LOG && console.log('no frame found');
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
     * @param time
     */
    _timeToPTS(time: number) {
        const time_base = this.demuxer.streams[this.streamIndex].time_base;
        return time * time_base[1] / time_base[0];
    }

    /**
     * Get the time in seconds from a given presentation timestamp (PTS)
     */
    ptsToTime(pts: number) {
        const time_base = this.demuxer.streams[this.streamIndex].time_base;
        return pts * time_base[0] / time_base[1];
    }

    /**
     * Get the frame at the given presentation timestamp (PTS)
     * @param targetPTS
     */
    async _getFrameAtPts(targetPTS: number) {
        LOG && console.log('_getFrameAtPts', targetPTS, '-> duration', this.duration);
        let packetReadCount = 0;

        // seek and create a decoder when retrieving a frame for the first time or when seeking backwards
        // we have to create a new decoder when seeking backwards as the decoder currently doesn't support seeking
        // (it doesn't properly release frames when seeking backwards)
        if (!this.previousTargetPTS || this.previousTargetPTS > targetPTS) {
            await this.demuxer.seek({
                stream_index: 0, // even though we specify the stream index, it still seeks all streams
                timestamp: targetPTS,
                any: false,
            });
            this._createDecoder();
            this.packet = null;
            this.frames = [];
        }

        // the decoder has been previously flushed while retrieving frames at the end of the stream and has thus been
        // destroyed. See if the requested targetPTS is part of the last few frames we decoded. If so, return it.
        if (!this.decoder) {
            LOG && console.log('no decoder');
            if ((this.filteredFrames as any).length > 0) {
                const closestFrame = (this.filteredFrames as any).find(f => f.pts <= targetPTS);
                // we should probably check the delta between the targetPTS and the closestFrame. If it's too big, we
                // should return null or something.
                LOG && console.log('returning closest frame with pts', closestFrame.pts);
                LOG && console.log('read', packetReadCount, 'packets');
                this.previousTargetPTS = targetPTS;
                return closestFrame;
            }
            throw Error('Unexpected condition: no decoder and no frames');
        }

        // Read packets until we have a frame which is closest to targetPTS
        let filteredFrames = null;
        let closestFramePTS = -1;
        let outputFrame = null;

        // This is the first time we're decoding frames. Get the first packet and decode it.
        if (!this.packet && this.frames.length === 0) {
            // LOG && console.log('getting initial packet and frames');
            ({ packet: this.packet, frames: this.frames } = await this._getNextPacketAndDecodeFrames());
            packetReadCount++;
        }
        // LOG && console.log('packet', !!this.packet, 'frames', this.frames.length, 'pts', this.packet.pts);

        while ((this.packet || this.frames.length !== 0) && closestFramePTS < targetPTS && packetReadCount < MAX_PACKET_READS) {
            LOG && console.log('packet si:', this.packet?.stream_index, 'pts:', this.packet?.pts, 'frames:', this.frames?.length);
            LOG && console.log('frames', this.frames?.length, 'frames.pts:', this.frames?.map(f => f.pts), '-> target.pts:', targetPTS);

            // packet contains frames
            if (this.frames.length !== 0) {
                // filter the frames
                const filteredResult = await this.filterer.filter([{ name: 'in0:v', frames: this.frames }]);
                filteredFrames = filteredResult.flatMap(r => r.frames);
                LOG && console.log('filteredFrames', filteredFrames.length, 'filteredFrames.pts:', filteredFrames.map(f => f.pts), '-> target.pts:', targetPTS);
                this.filteredFrames = filteredFrames as beamcoder.DecodedFrames;

                // get closest frame
                const closestFrame = filteredFrames.reverse().find(f => f.pts <= targetPTS);
                closestFramePTS = closestFrame?.pts;
                LOG && console.log('closestFramePTS', closestFramePTS, 'targetPTS', targetPTS);
                if (!outputFrame || closestFramePTS < targetPTS) {
                    LOG && console.log('|--> assigning outputFrame', closestFrame?.pts);
                    outputFrame = closestFrame;
                }
                else {
                    // break out of the loop if we've found the closest frame (and ensure we don't move to the next
                    // packet by calling _getNextPacketAndDecodeFrames again) as this risks us getting a frame that is
                    // after our targetPTS
                    LOG && console.log('breaking');
                    break;
                }
            }
            // get the next packet and frames
            ({ packet: this.packet, frames: this.frames } = await this._getNextPacketAndDecodeFrames());

            // keep track of how many packets we've read
            if (packetReadCount >= MAX_PACKET_READS) {
                throw Error('Reached max packet reads');
            }
            packetReadCount++;
        }

        if (!outputFrame) {
            throw Error('No matching frame found');
        }
        LOG && console.log('read', packetReadCount, 'packets');

        this.previousTargetPTS = targetPTS;
        return outputFrame;
    }

    /**
     * Get the next packet from the video stream and decode it into frames. Each frame has a presentation time stamp.
     * If we've reached the end of the stream and no more packets are available, we'll extract the last frames from
     * the decoder and destroy it.
     */
    async _getNextPacketAndDecodeFrames() {
        const packet = await this._getNextVideoStreamPacket();
        LOG && console.log('packet pts:', packet?.pts);

        // NOTE: maybe we should only decode frames when we're relatively close to our targetPTS?
        // extract frames from the packet
        let decodedFrames = null;
        if (packet !== null && this.decoder) {
            decodedFrames = await this.decoder.decode(packet as Packet);
            LOG && console.log('decodedFrames', decodedFrames.frames.length, decodedFrames.frames.map(f => f.pts));
        }
        // we've reached the end of the stream
        else {
            if (this.decoder) {
                LOG && console.log('getting the last frames from the decoder');
                // flush the decoder -- this will return the last frames and destroy the decoder
                decodedFrames = await this.decoder.flush();
                this.decoder = null;
            }
            else {
                LOG && console.log('no more frames to decode');
            }
        }

        let frames = [];
        if (decodedFrames && decodedFrames.frames.length !== 0) {
            frames = decodedFrames.frames;
        }

        return { packet, frames };
    }

    async _getNextVideoStreamPacket(): Promise<null | Packet> {
        LOG && console.log('_getNextVideoStreamPacket');

        let packet = await this.demuxer.read();
        // LOG && console.log('packet pts', packet.pts, 'stream_index', packet.stream_index);
        while (packet && packet.stream_index !== this.streamIndex) {
            packet = await this.demuxer.read();
            // LOG && console.log('packet pts', packet.pts, 'stream_index', packet.stream_index);
            if (packet === null) {
                LOG && console.log('no more packets');
                return null;
            }
        }
        LOG && console.log('returning packet', !!packet, 'pts', packet?.pts, 'si', packet?.stream_index);
        return packet as Packet;
    }

    _resizeFrameData(frame): Uint8ClampedArray {
        const components = 4; // 4 components: r, g, b and a
        const size = frame.width * frame.height * components;
        const rawData = new Uint8ClampedArray(size); // we should probaby reuse this buffer
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
        return rawData;
    }
}
