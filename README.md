# Framefusion

Dump mp4 frames at specific times in node.

Framefusion is an experimental mp4 frame extraction library based on [beamcoder](https://github.com/Streampunk/beamcoder).

# Installing in a project

```bash
yarn add git+ssh://git@github.com:Lumen5/framefusion.git
```

# Example usage

```typescript
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
```

For a complete working project (with package.json, vite config, typescript config), see here: https://github.com/Lumen5/framefusion/tree/main/examples/mini-framefusion-example

# Running test

```bash
npm install && npm run test-ui
```
