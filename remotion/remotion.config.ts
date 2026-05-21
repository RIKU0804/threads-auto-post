import { Config } from "@remotion/cli/config";

// TikTok vertical short-video pipeline.
// h264 + jpeg image format is the standard combination for MP4 delivery.
Config.setVideoImageFormat("jpeg");
Config.setOverwriteOutput(true);
Config.setConcurrency(1);
Config.setCodec("h264");
// Higher bitrate keeps caption edges crisp on TikTok's recompression pipeline.
Config.setVideoBitrate("8M");
