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

    static async create(args: ExtractorArgs): Promise<Extractor> {
        const extractor = new SimpleExtractor();
        await extractor.init(args);
        return extractor as unknown as Extractor;
    }

    async init({
        inputFileOrUrl,
        threadCount = 8,
    }: ExtractorArgs): Promise<void> {
        if (inputFileOrUrl.startsWith('http')) {
            console.log('downloading url');
            const downloadUrl = new DownloadVideoURL(inputFileOrUrl);
            await downloadUrl.download();
            inputFileOrUrl = downloadUrl.filepath;
            console.log('finished downloading');
        }
        this.demuxer = await beamcoder.demuxer('file:' + inputFileOrUrl);
        this.decoder = beamcoder.decoder({
            demuxer: this.demuxer,
            width: this.demuxer.streams[0].codecpar.width,
            height: this.demuxer.streams[0].codecpar.height,
            stream_index: 0, // we initialize the decoder with the first video stream but we still need to specify it further down the line?
            pix_fmt: this.demuxer.streams[0].codecpar.format,
            thread_count: threadCount,
        });
        this.filterer = await getFilter({
            stream: this.demuxer.streams[0],
            outputPixelFormat: 'rgba',
        });
    }

    /**
     * Duration in seconds
     */
    get duration(): number {
        const time_base = this.demuxer.streams[0].time_base;
        const durations = this.demuxer.streams.map(
            stream => stream.duration * time_base[0] / time_base[1]
        );

        return Math.max(...durations);
    }

    /**
     * Width in pixels
     */
    get width(): number {
        return this.demuxer.streams[0].codecpar.width;
    }

    /**
     * Height in pixels
     */
    get height(): number {
        return this.demuxer.streams[0].codecpar.height;
    }

    /**
     * Get the image data for a given time in seconds
     * @param targetTime
     */
    async getImageDataAtTime(targetTime: number): Promise<ImageData> {
        const targetPts = Math.floor(this._timeToPTS(targetTime));
        console.log('targetTime', targetTime, '-> targetPts', targetPts);
        const frame = await this._getFrameAtPts(targetTime, targetPts);
        if (!frame) {
            console.log('no frame found');
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

    _timeToPTS(time: number) {
        const time_base = this.demuxer.streams[0].time_base;
        return time * time_base[1] / time_base[0];
    }

    async _getFrameAtPts(targetTime, targetPTS: number) {
        console.log('_getFrameAtPts', targetTime, targetPTS, '-> duration', this.duration);
        let packetReadCount = 0;

        // console.log('seek', 'timestamp', targetTime, 'targetPTS', targetPTS);
        // get the iframe before the targetPTS
        // await this.demuxer.seek({
        //     // stream_index: 0, // even though we specify the stream index, it still seeks all streams
        //     time: targetTime,
        //     // backward: true,
        //     // any: false,
        // });
        // console.log('done seeking to', targetTime);

        // the decoder has been previously flushed while retrieving frames at the end of the stream and has thus been
        // destroyed. See if the requested targetPTS is part of the last few frames we decoded. If so, return it.
        if (!this.decoder) {
            // console.log('no decoder');
            if ((this.filteredFrames as any).length > 0) {
                const closestFrame = (this.filteredFrames as any).find(f => f.pts <= targetPTS);
                // we should probably check the delta between the targetPTS and the closestFrame. If it's too big, we
                // should return null or something.
                console.log('returning closest frame with pts', closestFrame.pts);
                console.log('read', packetReadCount, 'packets');
                return closestFrame;
            }
            throw Error('Unexpected condition: no decoder and no frames');
        }

        // Read packets until we have a frame which is closest to targetPTS
        let filteredFrames = null;
        let closestFramePTS = 0;
        let outputFrame = null;

        // This is the first time we're decoding frames. Get the first packet and decode it.
        if (!this.packet && this.frames.length === 0) {
            // console.log('getting initial packet and frames');
            ({ packet: this.packet, frames: this.frames } = await this._getNextPacketAndDecodeFrames());
            packetReadCount++;
        }
        // console.log('packet', !!this.packet, 'frames', this.frames.length, 'pts', this.packet.pts);

        while ((this.packet || this.frames.length !== 0) && closestFramePTS < targetPTS && packetReadCount < 20) {
            // console.log('packet si:', this.packet?.stream_index, 'pts:', this.packet?.pts, 'frames:', this.frames?.length);
            // console.log('frames', this.frames?.length, 'frames.pts:', this.frames?.map(f => f.pts), '-> target.pts:', targetPTS);

            // packet contains frames
            if (this.frames.length !== 0) {
                // filter the frames
                const filteredResult = await this.filterer.filter([{ name: 'in0:v', frames: this.frames }]);
                filteredFrames = filteredResult.flatMap(r => r.frames);
                // console.log('filteredFrames', filteredFrames.length, 'filteredFrames.pts:', filteredFrames.map(f => f.pts), '-> target.pts:', targetPTS);
                this.filteredFrames = filteredFrames as beamcoder.DecodedFrames;

                // get the closest frame
                const closestFrame = filteredFrames.reverse().find(f => f.pts <= targetPTS);
                closestFramePTS = closestFrame?.pts;
                // console.log('closestFramePTS', closestFramePTS, 'targetPTS', targetPTS);
                if (!outputFrame || closestFramePTS < targetPTS) {
                    // console.log('|--> assigning outputFrame', closestFrame?.pts);
                    outputFrame = closestFrame;
                }
                else {
                    // break out of the loop if we've found the closest frame (and ensure we don't move to the next
                    // packet by calling _getNextPacketAndDecodeFrames again) as this risks us getting a frame that is
                    // after our targetPTS
                    // console.log('breaking');
                    break;
                }
            }

            // get the next packet and frames
            ({ packet: this.packet, frames: this.frames } = await this._getNextPacketAndDecodeFrames());

            // keep track of how many packets we've read
            packetReadCount++;
        }

        if (!outputFrame) {
            throw Error('No matching frame found');
        }
        console.log('read', packetReadCount, 'packets');

        return outputFrame;
    }

    /**
     * Get the next packet from the video stream and decode it into frames. Each frame has a presentation time stamp.
     * If we've reached the end of the stream and no more packets are available, we'll extract the last frames from
     * the decoder and destroy it.
     */
    async _getNextPacketAndDecodeFrames() {
        const packet = await this._getNextVideoStreamPacket();

        // NOTE: maybe we should only decode frames when we're relatively close to our targetPTS?
        // extract frames from the packet
        let decodedFrames = null;
        if (packet !== null && this.decoder) {
            decodedFrames = await this.decoder.decode(packet as Packet);
        }
        // we've reached the end of the stream
        else {
            if (this.decoder) {
                console.log('getting the last frames from the decoder');
                // flush the decoder -- this will return the last frames and destroy the decoder
                decodedFrames = await this.decoder.flush();
                this.decoder = null;
            }
            else {
                console.log('no more frames to decode');
            }
        }

        let frames = [];
        if (decodedFrames && decodedFrames.frames.length !== 0) {
            frames = decodedFrames.frames;
        }

        return { packet, frames };
    }

    async _getNextVideoStreamPacket(): Promise<null | Packet> {
        console.log('_getNextVideoStreamPacket');

        let packet = await this.demuxer.read();
        // console.log('packet pts', packet.pts, 'stream_index', packet.stream_index);
        while (packet && packet.stream_index !== 0) {
            packet = await this.demuxer.read();
            // console.log('packet pts', packet.pts, 'stream_index', packet.stream_index);
            if (packet === null) {
                console.log('no more packets');
                return null;
            }
        }
        console.log('returning packet', !!packet, 'pts', packet?.pts);
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
