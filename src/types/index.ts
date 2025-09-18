export type ImageData = {
    data: Uint8ClampedArray;
    width: number;
    height: number;
    frame: Frame;
};

export type Frame = {
    data: Array<Buffer>;
    linesize: number[];
    width: number;
    height: number;
    format: string;
    best_effort_timestamp?: number | bigint;
    color_primaries?: string;
    color_trc?: string;
    colorspace?: string;
    color_range?: string;
};
