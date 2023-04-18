FROM ubuntu:focal

WORKDIR /ffmpeg-temp

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update\
    && apt-get -y install\
        wget\
        make\
        autoconf \
        automake \
        build-essential \
        cmake \
        git-core \
        libass-dev \
        libfreetype6-dev \
        libgnutls28-dev \
        libmp3lame-dev \
        libsdl2-dev \
        libtool \
        libva-dev \
        libvdpau-dev \
        libvorbis-dev \
        libxcb1-dev \
        libxcb-shm0-dev \
        libxcb-xfixes0-dev \
        meson \
        ninja-build \
        pkg-config \
        texinfo \
        wget \
        yasm \
        zlib1g-dev\
    && wget https://ffmpeg.org/releases/ffmpeg-5.1.3.tar.xz\
    && tar -xf ffmpeg-*.tar.xz\
    && rm ffmpeg-*.tar.xz\
    && mv ffmpeg-* /ffmpeg-current

WORKDIR /ffmpeg-current

RUN ./configure --enable-pic --enable-shared --enable-gpl\
    && make -j$(nproc)\
    && make install\
    && ldconfig /usr/local/lib


WORKDIR /node-temp

RUN wget -qO- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.3/install.sh | bash

RUN [ -s "$HOME/.nvm/nvm.sh" ] && \. "$HOME/.nvm/nvm.sh" \
    && nvm install 14.18\
    && nvm use 14.18

WORKDIR /framefusion

ADD . /framefusion


ENTRYPOINT [ -s "$HOME/.nvm/nvm.sh" ] && \. "$HOME/.nvm/nvm.sh"\
    && npm ci\
    && npm run test run
