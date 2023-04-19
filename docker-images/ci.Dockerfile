FROM ubuntu:focal

WORKDIR /ffmpeg-temp

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get -y install wget xz-utils python3 build-essential

#
# Install ffmpeg libraries
#
WORKDIR /ffmpeg-temp
RUN wget https://github.com/BtbN/FFmpeg-Builds/releases/download/autobuild-2023-04-19-14-14/ffmpeg-n5.1.3-6-g1e413487bf-linux64-gpl-shared-5.1.tar.xz && mv $(ls -1) ffmpeg.tar.xz

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

ADD . /framefusion
WORKDIR /framefusion

RUN . "$HOME/.nvm/nvm.sh"\
    && nvm install 14.18\
    && nvm use 14.18


ENTRYPOINT . "$HOME/.nvm/nvm.sh" && npm ci --also=dev && npm run test run
