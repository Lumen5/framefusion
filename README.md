# Framefusion

Dump mp4 frames at specific times in node.

Framefusion is an experimental mp4 frame extraction library based on [beamcoder](https://github.com/Streampunk/beamcoder).


## Installation

## Mac

First, make sure you don't have ffmpeg other than 5

```
brew uninstall ffmpeg
```

```
brew uninstall ffmpeg@6
```

Then `yarn install` should install any required dependencies:

```
yarn install
```

## Linux

You need to install ffmpeg libraries before running installing. You can refer to [install_beamcoder_dependencies.sh](https://github.com/Lumen5/framefusion/blob/main/scripts/install_beamcoder_dependencies.sh).

When installing, provide the path to ffmpeg (Unless it's already in system path).

```
export CPATH="/PATH_TO_FFMPEG/include/"
export PKG_CONFIG_PATH="/PATH_TO_FFMPEG/lib/pkgconfig/"
yarn install
```

# Installing in a project

```bash
yarn add @lumen5/framefusion
```

# Example usage

```typescript
import { BeamcoderExtractor } from '@lumen5/framefusion';

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

Make sure you run node 18 or higher.

```bash
nvm use 18
yarn install && yarn run test-ui
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
