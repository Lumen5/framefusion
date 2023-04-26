FROM ubuntu:focal

WORKDIR /ffmpeg-temp

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get -y install wget xz-utils python3 build-essential
# When host is ARM (M1), the ubuntu image needs a few more dependencies
# RUN apt-get update && apt-get -y install wget xz-utils python3 build-essential pkg-config libcairo2-dev libpango1.0-dev libjpeg-dev libgif-dev librsvg2-dev

#
# Install ffmpeg libraries
#
WORKDIR /ffmpeg-temp
RUN wget https://github.com/BtbN/FFmpeg-Builds/releases/download/autobuild-2023-04-19-14-14/ffmpeg-n5.1.3-6-g1e413487bf-linux64-gpl-shared-5.1.tar.xz && mv $(ls -1) ffmpeg.tar.xz
# When host is ARM (M1), the ubuntu image needs an arm64 ffmpeg build
# RUN wget https://github.com/BtbN/FFmpeg-Builds/releases/download/autobuild-2023-04-19-14-14/ffmpeg-n5.1.3-6-g1e413487bf-linuxarm64-gpl-shared-5.1.tar.xz && mv $(ls -1) ffmpeg.tar.xz

RUN tar -xf ffmpeg.tar.xz && rm ffmpeg.tar.xz && mv $(ls -1) ffmpeg
RUN mv ffmpeg/include/* /usr/local/include/
RUN mv ffmpeg/lib/* /usr/local/lib/
RUN ldconfig /usr/local/lib/
ENV CXX_FLAGS="-I/usr/local/include/"

#
# Install node
#
WORKDIR /node-temp

RUN wget -qO- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.3/install.sh | bash

RUN . "$HOME/.nvm/nvm.sh"\
    && nvm install 18\
    && nvm use 18\
    && npm install --global yarn

ADD . /framefusion
WORKDIR /framefusion

ENTRYPOINT . "$HOME/.nvm/nvm.sh" && yarn install --frozen-lockfile && yarn run test run && yarn run lint
