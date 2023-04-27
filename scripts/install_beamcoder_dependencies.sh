#!/bin/bash

# # Stop this script if any part fails
# set -e
#
# export DEBIAN_FRONTEND=noninteractive
#
# # Building beamcoder requires python and utils in build-essential. The archive is in xz format, so we need xz-utils.
# apt-get update
# apt-get -y install python3 build-essential wget xz-utils
#
# # We'll work in this temporary folder
# mkdir /tmp/ffmpeg-temp
# cd /tmp/ffmpeg-temp
#
# # Download ffmpeg from BtbN
# wget https://github.com/BtbN/FFmpeg-Builds/releases/download/autobuild-2023-04-19-14-14/ffmpeg-n5.1.3-6-g1e413487bf-linux64-gpl-shared-5.1.tar.xz -O ffmpeg.tar.xz
#
# # Extract, remove archive, then move to a known name
# tar -xf ffmpeg.tar.xz
# rm ffmpeg.tar.xz
# mv $(ls -1) ffmpeg
#
# # Install libs and headers in directories that can easily be cached
# mkdir /usr/local/include/libav/
# mkdir /usr/local/lib/libav/
# mv ffmpeg/include/* /usr/local/include/libav/
# mv ffmpeg/lib/* /usr/local/lib/libav/
#
# # Update ldconfig database
# ldconfig /usr/local/lib/libav/
#
# # Note that these might have to be set again
# export LIBRARY_PATH="/usr/local/lib/libav/"
# export CPATH="/usr/local/include/libav/"
