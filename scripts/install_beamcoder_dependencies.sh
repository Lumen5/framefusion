#!/bin/bash

ARCH=$(uname -m)

if [[ "$ARCH" == "x86_64" ]]; then
    echo "Detected 64 bit intel"
    BINARIES_URL="https://github.com/BtbN/FFmpeg-Builds/releases/download/autobuild-2025-11-10-13-05/ffmpeg-n8.0-32-g44bfe0da61-linux64-gpl-shared-8.0.tar.xz"
elif [[ "$ARCH" == "aarch64" ]]; then
    # ARM linux setup
    echo "Detected ARM"
    BINARIES_URL="https://github.com/BtbN/FFmpeg-Builds/releases/download/autobuild-2025-11-10-13-05/ffmpeg-n8.0-32-g44bfe0da61-linuxarm64-gpl-shared-8.0.tar.xz"
else
    echo "\n\n\UNSUPPORTED ARCH $ARCH\n\n\n"
    exit 1
fi

rm -rf ./.framefusion-ffmpeg
mkdir ./.framefusion-ffmpeg
cd ./.framefusion-ffmpeg
wget $BINARIES_URL -O ffmpeg.tar.xz
tar -xf ffmpeg.tar.xz
rm ffmpeg.tar.xz
mv $(ls -1) ffmpeg

ldconfig $(realpath .)/ffmpeg/lib/
