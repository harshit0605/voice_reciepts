#!/bin/sh
# Draws the Counterwell app icons (Register & Stamp mark: three ruled lines and the red margin).
# Re-run after changing the mark: sh assets/make-icons.sh (needs ImageMagick 7).
set -e
cd "$(dirname "$0")"
BLUE='#1F3FAA'; RED='#E0564A'; WHITE='#FFFFFF'
# iOS / store icon: full-bleed square (the OS rounds the corners).
magick -size 1024x1024 xc:"$BLUE" \
  -fill "$RED" -draw "rectangle 292,0 352,1024" \
  -fill "$WHITE" \
  -draw "roundrectangle 420,362 800,422 30,30" \
  -draw "roundrectangle 420,482 800,542 30,30" \
  -draw "roundrectangle 420,602 656,662 30,30" \
  icon.png
# Android adaptive foreground: transparent, artwork inside the central safe zone; background colour in app.json.
magick -size 1024x1024 xc:none \
  -fill "$RED" -draw "rectangle 352,0 396,1024" \
  -fill "$WHITE" \
  -draw "roundrectangle 448,420 712,464 22,22" \
  -draw "roundrectangle 448,490 712,534 22,22" \
  -draw "roundrectangle 448,560 612,604 22,22" \
  adaptive-icon.png
# Android notification icon: white silhouette on transparent.
magick -size 96x96 xc:none -fill "$WHITE" \
  -draw "rectangle 22,8 28,88" \
  -draw "roundrectangle 38,30 78,38 4,4" \
  -draw "roundrectangle 38,44 78,52 4,4" \
  -draw "roundrectangle 38,58 63,66 4,4" \
  notification-icon.png
