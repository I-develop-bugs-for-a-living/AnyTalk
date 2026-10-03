#!/usr/bin/env bash
# Generates the app sounds in scripts/assets_fallback/sounds with ffmpeg:
# soft sine tones (with a quiet octave on top) that fade in quickly and
# decay, so they never click. Matching sounds use the same notes in
# opposite directions.
#
# Usage: scripts/generate-sounds.sh [output directory]
set -euo pipefail

OUT="${1:-$(dirname "$0")/assets_fallback/sounds}"

# Note frequencies (Hz)
A3=220.00 D4=293.66 E4=329.63 A4=440.00 C5=523.25 D5=587.33 E5=659.25
G5=783.99 GS5=830.61 A5=880.00 B5=987.77 E6=1318.51 G6=1567.98

# note FREQ START [DECAY]: a plucked note starting at START seconds
note() {
  local decay="${3:-9}"
  echo "if(gte(t,$2),(sin(2*PI*$1*(t-$2))+0.25*sin(4*PI*$1*(t-$2)))*min(1,(t-$2)/0.006)*exp(-(t-$2)*$decay),0)"
}

# bell FREQ START DECAY: a glassy note, its inharmonic partials fade first
bell() {
  echo "if(gte(t,$2),(sin(2*PI*$1*(t-$2))+0.35*sin(2*PI*$1*2.76*(t-$2))*exp(-(t-$2)*8)+0.15*sin(2*PI*$1*5.4*(t-$2))*exp(-(t-$2)*16))*min(1,(t-$2)/0.003)*exp(-(t-$2)*$3),0)"
}

# tone FREQ START END: a held note, faded in and out over 30 ms
tone() {
  echo "if(between(t,$2,$3),sin(2*PI*$1*t)*min(1,min(t-$2,$3-t)/0.03),0)"
}

# render NAME DURATION GAIN_DB EXPRESSION
render() {
  local fade_start
  fade_start=$(awk "BEGIN { printf \"%.2f\", $2 - 0.1 }")
  ffmpeg -hide_banner -loglevel error -y -f lavfi \
    -i "aevalsrc=exprs='$4':s=48000:d=$2" \
    -af "afade=t=out:st=$fade_start:d=0.1,volume=$3dB" \
    -ac 1 -c:a libvorbis -q:a 6 "$OUT/$1.ogg"
  echo "$1.ogg"
}

# a new message: a single high bell
render message_sound 0.6 -19 "$(bell $G6 0 7)"

# someone joins / leaves the call: two notes stepping up / down
render user_join_voice 0.55 -14 "0.5*($(note $E5 0)+$(note $A5 0.11))"
render user_leave_voice 0.55 -14 "0.5*($(note $A5 0)+$(note $E5 0.11))"

# someone moves into or out of the call: the same note twice
render user_moved 0.5 -14 "0.5*($(note $D5 0 12)+$(note $D5 0.13 10))"

# microphone: low and quick
render unmute 0.35 -13 "0.5*($(note $E4 0 14)+$(note $A4 0.07 14))"
render mute 0.35 -13 "0.5*($(note $A4 0 14)+$(note $E4 0.07 14))"

# headphones: lower and a little longer
render undeafen 0.5 -12 "0.5*($(note $A3 0 9)+$(note $D4 0.1 9))"
render deafen 0.5 -12 "0.5*($(note $D4 0 9)+$(note $A3 0.1 9))"

# streams start / end: three notes up / down
render stream_start 0.6 -15 \
  "0.45*($(note $C5 0)+$(note $E5 0.09)+$(note $G5 0.18))"
render stream_end 0.6 -15 \
  "0.45*($(note $G5 0)+$(note $E5 0.09)+$(note $C5 0.18))"

# someone starts / stops watching your stream: quick and high
render stream_viewer_join 0.35 -17 "0.5*($(note $B5 0 16)+$(note $E6 0.06 16))"
render stream_viewer_leave 0.35 -17 "0.5*($(note $E6 0 16)+$(note $B5 0.06 16))"

# ringtones loop: a phrase, then a pause
render ringtone_incoming 2.4 -14 \
  "0.4*($(note $E5 0 6)+$(note $GS5 0.15 6)+$(note $B5 0.3 6)+$(note $GS5 0.45 6)+$(note $E5 0.75 6)+$(note $GS5 0.9 6)+$(note $B5 1.05 5))"
render ringtone_outgoing 3 -20 \
  "0.5*($(tone 440 0.05 1.05)+$(tone 480 0.05 1.05))"
