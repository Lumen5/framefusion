#!/bin/bash

if [[ "$OSTYPE" == "linux-gnu"* ]]; then
    ARCH=$(uname -m)
    echo "Detected OS: GNU/Linux"

    if [[ "$ARCH" == "x86_64" ]]; then
        echo "Detected 64 bit intel"
        BINARIES_URL="https://github.com/BtbN/FFmpeg-Builds/releases/download/autobuild-2023-04-19-14-14/ffmpeg-n5.1.3-6-g1e413487bf-linux64-gpl-shared-5.1.tar.xz -O ffmpeg.tar.xz"
    elif [[ "$ARCH" == "aarch64" ]]; then
        # ARM linux setup
        echo "Detected ARM"
        BINARIES_URL="https://github.com/BtbN/FFmpeg-Builds/releases/download/autobuild-2023-04-19-14-14/ffmpeg-n5.1.3-6-g1e413487bf-linuxarm64-gpl-shared-5.1.tar.xz"
    else
        echo "\n\n\UNSUPPORTED ARCH $ARCH\n\n\n"
        exit -1;
    fi

    rm -rf /tmp/framefusion-ffmpeg
    mkdir /tmp/framefusion-ffmpeg
    cd /tmp/framefusion-ffmpeg
    wget $BINARIES_URL
    tar -xf ffmpeg.tar.xz
    rm ffmpeg.tar.xz
    mv $(ls -1) ffmpeg

    ldconfig /tmp/framefusion-ffmpeg/ffmpeg/lib/
elif [[ "$OSTYPE" == "darwin"* ]]; then
    echo "Detected OS: Mac"
    ARCH=$(uname -m)

    BINARIES_URL="https://github.com/antoineMoPa/libav-static/releases/download/0.0.1/libav_5_1_3_mac_build_x86_64.tar.xz -O ffmpeg.tar.xz"

    if [[ "$ARCH" == "x86_64" ]]; then
        echo "Detected 64 bit intel"

    elif [[ "$ARCH" == "arm64" ]]; then
        # ARM linux setup
        echo "Detected ARM - using intel image regardless for now"
    else
        echo "\n\n\UNSUPPORTED ARCH $ARCH\n\n\n"
        exit -1;
    fi

    rm -rf /tmp/framefusion-ffmpeg
    mkdir /tmp/framefusion-ffmpeg
    cd /tmp/framefusion-ffmpeg
    wget $BINARIES_URL
    tar -xf ffmpeg.tar.xz
    rm ffmpeg.tar.xz
    mv $(ls -1) ffmpeg
elif [[ "$OSTYPE" == "cygwin" ]]; then
    echo "Detected OS: Windows"
else
    echo "\n\n\UNSUPPORTED OS $OSTYPE!\n\n\n"
fi
