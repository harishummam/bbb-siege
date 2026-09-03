import { execFile } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

export interface FakeMedia {
  videoPath: string;
  audioPath: string;
}

export interface FakeMediaOptions {
  dir?: string;
  ffmpegPath?: string;
}

/**
 * Generates non-trivial motion+noise fake media (Y4M video, WAV audio) with ffmpeg so a browser
 * probe pushes realistic bandwidth instead of a near-empty test pattern. Files are cached in a
 * temp dir and reused. Returns null if ffmpeg is unavailable (caller falls back to the built-in
 * fake device). Chromium loops these via --use-file-for-fake-{video,audio}-capture.
 */
export async function ensureFakeMedia(options: FakeMediaOptions = {}): Promise<FakeMedia | null> {
  const ffmpeg = options.ffmpegPath ?? 'ffmpeg';
  const dir = options.dir ?? path.join(tmpdir(), 'bbb-siege-fake-media');
  const videoPath = path.join(dir, 'fake-video.y4m');
  const audioPath = path.join(dir, 'fake-audio.wav');

  if (existsSync(videoPath) && existsSync(audioPath)) return { videoPath, audioPath };

  try {
    mkdirSync(dir, { recursive: true });
    await run(
      ffmpeg,
      [
        '-y', '-f', 'lavfi', '-i', 'testsrc2=size=640x480:rate=15', '-t', '5',
        '-vf', 'noise=alls=20:allf=t', '-pix_fmt', 'yuv420p', videoPath,
      ],
      { timeout: 60_000 }
    );
    await run(
      ffmpeg,
      ['-y', '-f', 'lavfi', '-i', 'anoisesrc=d=5:c=pink:r=48000:a=0.15', audioPath],
      { timeout: 60_000 }
    );
    return { videoPath, audioPath };
  } catch {
    return null;
  }
}
