import { BeamcoderExtractor } from 'framefusion';

const inputFile = './video.mp4';

async function run() {
    const extractor = await BeamcoderExtractor.create({
        inputFile,
        //outputFile: 'image-%04d.png', // Uncomment to ouput files to disk
        outputPixelFormat: 'rgba',
    });

    // Get frame at a specific time (in seconds)
    const frame = await extractor.getFrameAtTime(2.0);

    // Do something with frame data
    console.log(frame.data);
}

run();
