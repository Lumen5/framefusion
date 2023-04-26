import { BeamcoderExtractor } from 'framefusion';

const inputFileOrUrl = './video.mp4';

async function run() {
    const extractor = await BeamcoderExtractor.create({
        inputFileOrUrl,
        // outputFile: 'image-%04d.png', // Uncomment to ouput files to disk
    });

    // Get frame at a specific time (in seconds)
    const frame = await extractor.getImageDataAtTime(2.0);

    // Do something with frame data
    console.log(frame.data);
}

run();
