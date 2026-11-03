# Editor MP4 fixture

`editor-fragmented-h264.mp4` is a synthetic 256 × 192 color/rectangle animation generated locally with canvas and MediaRecorder for the editor tests. It contains H.264 video and a silent AAC track. No personal or third-party media is included. The original recording is fragmented with zero metadata duration; tests verify conversion to an indexed MP4 while preserving every encoded audio/video packet.
