#!/usr/bin/env node
const { probeFile } = require('./parser');
const { extractByType, extractByTypeAndIndex } = require('./demuxer');
const TrackManager = require('./trackManager');
const CustomRenderer = require('./customRenderer');

function printUsage() {
  console.log(`Demuxer Engine CLI

Usage:
  node cli.js list <input>
  node cli.js extract <input> <type> <streamIndex|all|1,2,3> [output]
  node cli.js select <input> <type> <streamIndex>
  node cli.js render-info <input>
  node cli.js render-run <input> [seconds]

Commands:
  list                     Probe a media file with ffprobe and print structured JSON
  extract                  Extract one or more streams with ffmpeg stream copy
  select                   Simulate switching the current track in TrackManager
  render-info              Print custom renderer pipeline state and ffmpeg decode commands
  render-run               Run the custom renderer briefly and print decoded frame/audio/subtitle events

Examples:
  node cli.js list ./movie.mkv
  node cli.js extract ./movie.mkv audio 1 ./audio_1.aac
  node cli.js extract ./movie.mkv audio 1,2
  node cli.js extract ./movie.mkv subtitle all
  node cli.js extract ./movie.mkv subtitle 2 ./sub_2.ass
  node cli.js select ./movie.mkv audio 1
  node cli.js render-info ./movie.mkv
  node cli.js render-run ./movie.mkv 8

Binary lookup order:
  1. FFMPEG_PATH / FFPROBE_PATH environment variables
  2. ./bin/ffmpeg and ./bin/ffprobe (or .exe on Windows)
  3. system PATH

Underlying commands:
  ffprobe -v error -print_format json -show_format -show_streams <input>
  ffmpeg -y -i <input> -map 0:<streamIndex> -c copy <output>
  ffmpeg -i <input> -map 0:<videoIndex> -pix_fmt rgba -f rawvideo pipe:1
  ffmpeg -i <input> -map 0:<audioIndex> -acodec pcm_s16le -f s16le pipe:1
  ffmpeg -i <input> -map 0:<subtitleIndex> -f webvtt pipe:1
`);
}

function validateType(type) {
  if (!['video', 'audio', 'subtitle'].includes(type)) {
    throw new Error(`Invalid type: ${type}. Expected video, audio, or subtitle.`);
  }
}

async function handleList(input) {
  const result = await probeFile(input);
  console.log(JSON.stringify(result, null, 2));
}

async function handleExtract(input, type, streamIndex, output) {
  validateType(type);
  const rawIndex = String(streamIndex || '').trim();
  const isBatchRequest = rawIndex.toLowerCase() === 'all' || rawIndex.includes(',');

  const result = isBatchRequest
    ? await extractByType({
        inputPath: input,
        type,
        streamIndex: rawIndex,
        outputPath: output
      })
    : await extractByTypeAndIndex({
        inputPath: input,
        type,
        streamIndex: Number(streamIndex),
        outputPath: output
      });

  console.log(JSON.stringify(result, null, 2));
}

async function handleSelect(input, type, streamIndex) {
  validateType(type);
  const probe = await probeFile(input);
  const manager = new TrackManager(probe.allStreams);
  const result = manager.selectTrack(type, Number(streamIndex));

  console.log(JSON.stringify({
    selection: result,
    current: manager.getCurrentSelection()
  }, null, 2));
}

async function handleRenderInfo(input) {
  const renderer = new CustomRenderer(input);
  await renderer.initialize();
  console.log(JSON.stringify(renderer.getState(), null, 2));
}

async function handleRenderRun(input, seconds) {
  const renderer = new CustomRenderer(input);
  await renderer.initialize();

  let subtitleEvents = 0;

  renderer.on('pipeline-start', (event) => {
    console.error(`[pipeline-start] ${event.type}: ${event.command}`);
  });

  renderer.on('pipeline-close', (event) => {
    console.error(`[pipeline-close] ${event.type}: code=${event.code} signal=${event.signal}`);
  });

  renderer.on('ffmpeg-log', (event) => {
    console.error(`[ffmpeg-log:${event.type}] ${event.message}`);
  });

  renderer.on('video-frame', (event) => {
    if (event.index <= 5 || event.index % 100 === 0) {
      console.error(`[video-frame] #${event.index} ${event.width}x${event.height} ${event.pixelFormat} bytes=${event.data.length}`);
    }
  });

  renderer.on('audio-chunk', (event) => {
    if (event.index <= 5 || event.index % 200 === 0) {
      console.error(`[audio-chunk] #${event.index} rate=${event.sampleRate} ch=${event.channels} bytes=${event.data.length}`);
    }
  });

  renderer.on('subtitle-data', (event) => {
    subtitleEvents += 1;
    if (subtitleEvents <= 5) {
      const preview = event.text.replace(/\s+/g, ' ').trim().slice(0, 120);
      console.error(`[subtitle-data] #${subtitleEvents} format=${event.format} bytes=${event.bytes} preview=${preview}`);
    }
  });

  await renderer.start();

  const durationMs = Math.max(1, Number(seconds || 5)) * 1000;
  await new Promise((resolve) => setTimeout(resolve, durationMs));
  await renderer.stop();

  console.log(JSON.stringify(renderer.getState(), null, 2));
}

async function main() {
  const [, , command, ...args] = process.argv;

  if (!command || ['-h', '--help', 'help'].includes(command)) {
    printUsage();
    return;
  }

  try {
    if (command === 'list') {
      const [input] = args;
      if (!input) throw new Error('Missing input path');
      await handleList(input);
      return;
    }

    if (command === 'extract') {
      const [input, type, streamIndex, output] = args;
      if (!input || !type || streamIndex === undefined) {
        throw new Error('Usage: node cli.js extract <input> <type> <streamIndex> [output]');
      }
      await handleExtract(input, type, streamIndex, output);
      return;
    }

    if (command === 'select') {
      const [input, type, streamIndex] = args;
      if (!input || !type || streamIndex === undefined) {
        throw new Error('Usage: node cli.js select <input> <type> <streamIndex>');
      }
      await handleSelect(input, type, streamIndex);
      return;
    }

    if (command === 'render-info') {
      const [input] = args;
      if (!input) throw new Error('Usage: node cli.js render-info <input>');
      await handleRenderInfo(input);
      return;
    }

    if (command === 'render-run') {
      const [input, seconds] = args;
      if (!input) throw new Error('Usage: node cli.js render-run <input> [seconds]');
      await handleRenderRun(input, seconds);
      return;
    }

    throw new Error(`Unknown command: ${command}`);
  } catch (error) {
    console.error(JSON.stringify({ error: error.message }, null, 2));
    process.exitCode = 1;
  }
}

main();
