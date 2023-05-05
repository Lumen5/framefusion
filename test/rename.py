import os
import shutil

path = "/Users/emmanuelseynaeve/Code/framefusion/test/__image_snapshots__"  # replace with the path to your PNG files
pattern = "image%02d.jpg"

files = sorted(os.listdir(path))  # list all files in the directory and sort them
count = 1  # initialize the sequence number

files = os.listdir(path)
png_files = [file for file in files if file.endswith(".png")]
print(len(png_files))

for i in range(len(png_files)):
    filename = f'framefusion-test-ts-test-framefusion-test-ts-frame-fusion-can-get-all-frames-low-playback-rate-{i+1}-snap.png'
    new_filename = f'framefusion{i:03d}.png'
    src = os.path.join(path, filename)
    dst = os.path.join(path, new_filename)
    shutil.move(src, dst)  # rename the file