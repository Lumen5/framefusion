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
        exit 1
    fi

    rm -rf ./.framefusion-ffmpeg
    mkdir ./.framefusion-ffmpeg
    cd ./.framefusion-ffmpeg
    wget $BINARIES_URL
    tar -xf ffmpeg.tar.xz
    rm ffmpeg.tar.xz
    mv $(ls -1) ffmpeg

    ldconfig $(realpath .)/ffmpeg/lib/
elif [[ "$OSTYPE" == "darwin"* ]]; then
    echo "Detected OS: Mac - leaving the rest to beamcoder setup"
elif [[ "$OSTYPE" == "cygwin" ]]; then
    echo "Detected OS: Windows - leaving the rest to beamcoder setup"
else
    echo "\n\n\UNSUPPORTED OS $OSTYPE!\n\n\n"
    exit 1
fi
