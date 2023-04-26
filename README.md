# Framefusion

Dump mp4 frames at specific times in node.

Framefusion is an experimental mp4 frame extraction library based on [beamcoder](https://github.com/Streampunk/beamcoder).

# Pre-installation setup

## Mac (M1)

```
brew uninstall ffmpeg
brew install ffmpeg@5
export CXXFLAGS="-I/opt/homebrew/Cellar/ffmpeg/5.1.2_6/include/"
ln -s /opt/homebrew/Cellar/ffmpeg/5.1.2_6/ /opt/homebrew/Cellar/ffmpeg/5.0
```

## Mac (Intel)

TODO

## Linux

TODO

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
    });

    // Get frame at a specific time (in seconds)
    const imageData = await extractor.getImageDataAtTime(2.0);

    // Do something with frame data
    console.log(imageData);
}

run();
```

For a complete working project (with package.json, vite config, typescript config), see here: https://github.com/Lumen5/framefusion/tree/main/examples/mini-framefusion-example

# Running test

```bash
npm install && npm run test-ui
```

# Philosophy

We want to limit framefusion to 2 simple roles:

 1. Extracting frames from videos
 2. Combining frames into a video

We want to design the API to be as minimal as possible to achieve these two goals.

We also want to build the library in a way that we can provide different backends to acheive these goals, but still keep a similar interface.

# Where we are with the philosophy currently

Only point 1 is implemented so far (Extracting frames from videos).

We also only provide a beamcoder backend and we still have to figure out how we can swap backends and skip compiling beamcoder. This could be through different npm packages.
