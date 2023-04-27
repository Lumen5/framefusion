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

Then install:

```
yarn install
```

## Linux

You should set a few variables whenever you are about to run `yarn install` to let beamcoder know where we'll install
ffmpeg's libraries. This is temporary until beamcoder's install script is fixed (See beamcoder issue [103](https://github.com/Streampunk/beamcoder/issues/103)).

```
export CPATH="/YOUR_APP_PATH/.framefusion-ffmpeg/ffmpeg/include/"
export PKG_CONFIG_PATH="/YOUR_APP_PATH/.framefusion-ffmpeg/ffmpeg/lib/pkgconfig/"
yarn install
```

In docker:

```
ENV CPATH="/YOUR_APP_PATH/.framefusion-ffmpeg/ffmpeg/include/"
ENV PKG_CONFIG_PATH="/YOUR_APP_PATH/.framefusion-ffmpeg/ffmpeg/lib/pkgconfig/"
RUN yarn install
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
