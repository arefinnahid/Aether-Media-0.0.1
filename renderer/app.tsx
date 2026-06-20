import React, { useState, useRef, useEffect, useCallback, useMemo, forwardRef, useImperativeHandle } from "react";
import type { HTMLAttributes } from "react";
import type { Transition, Variants } from "motion/react";
import { motion, useAnimation, AnimatePresence } from "motion/react";
import Hls from "hls.js";
import * as dashjs from 'dashjs';
import {
  Volume2,
  Volume1,
  VolumeX,
  Settings,
  RectangleHorizontal,
  Monitor,
  Gauge,
  Music,
  ChevronRight,
  ChevronLeft,
  ArrowLeft,
  Check,
  X,
  Minus,
  Maximize2,
  Plus,
  Folder,
  Download,
  Trash2,
  ArrowDownToLine,
  CircleStop,
  CirclePause,
  CirclePlay,
  CheckCircle2,
  AlertCircle,
  RotateCcw,
  Tv,
  PictureInPicture,
  Info,
  Radio,
  Search,
  Loader2,
  FilePlus2,
  ListVideo,
  CaptionsIcon,
  CaptionsEnabledIcon,
  Globe,
  SquareArrowOutUpRight,
  ArrowRight,
  Star,
  StarFilled,
  FileDown,
  GripVertical,
  Edit3,
  RefreshCw,
  ListMusic,
  SortAsc,
} from "./icons";
// @ts-ignore
import playIconUrl from '../icons/play.svg';

const RoundedPlay = ({ className }: { className?: string }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
  >
    <path d="M6 5.653c0-1.426 1.529-2.33 2.779-1.643l10.54 6.348c1.295.712 1.295 2.573 0 3.285L9.32 19.991c-1.25.687-2.779-.217-2.779-1.643V5.653z" />
  </svg>
);

const RoundedPause = ({ className }: { className?: string }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
  >
    <rect x="6" y="4" width="4" height="16" rx="1.5" />
    <rect x="14" y="4" width="4" height="16" rx="1.5" />
  </svg>
);

const CustomPictureInPicture = ({ className }: { className?: string }) => (
  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <path d="M2 10h6V4M2 4l5.2 5.2" />
    <path d="M21 10V7a2 2 0 0 0-2-2h-7" />
    <path d="M3 14v2a2 2 0 0 0 2 2h3" />
    <rect x="12" y="14" width="10" height="7" rx="1" />
  </svg>
);

export interface LoaderCircleIconHandle {
  startAnimation: () => void;
  stopAnimation: () => void;
}

interface LoaderCircleIconProps extends HTMLAttributes<HTMLDivElement> {
  size?: number;
}

const G_VARIANTS: Variants = {
  normal: { rotate: 0 },
  animate: {
    rotate: 360,
    transition: {
      repeat: Number.POSITIVE_INFINITY,
      duration: 0.8,
      ease: "linear",
    },
  },
};

const DEFAULT_TRANSITION: Transition = {
  type: "spring",
  stiffness: 50,
  damping: 10,
};

const LoaderCircleIcon = forwardRef<
  LoaderCircleIconHandle,
  LoaderCircleIconProps
>(({ onMouseEnter, onMouseLeave, className, size = 16, ...props }, ref) => {
  const controls = useAnimation();
  const isControlledRef = useRef(false);

  useImperativeHandle(ref, () => {
    isControlledRef.current = true;

    return {
      startAnimation: () => controls.start("animate"),
      stopAnimation: () => controls.start("normal"),
    };
  });

  // Auto-start animation and keep it running
  useEffect(() => {
    controls.start("animate");
  }, [controls]);

  return (
    <div
      className={className || ""}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      style={{ display: "flex", alignItems: "center", justifyContent: "center", width: size, height: size }}
      {...props}
    >
      <svg
        fill="none"
        height="100%"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
        viewBox="0 0 24 24"
        width="100%"
        xmlns="http://www.w3.org/2000/svg"
      >
        <motion.path
          animate={controls}
          d="M21 12a9 9 0 1 1-6.219-8.56"
          style={{ transformOrigin: "12px 12px" }}
          transition={DEFAULT_TRANSITION}
          variants={G_VARIANTS}
        />
      </svg>
    </div>
  );
});

LoaderCircleIcon.displayName = "LoaderCircleIcon";

const ShimmerTitle = ({ text, isShimmering, isLive, onOverflowChange, onInfoClick }: { text: string, isShimmering: boolean, isLive?: boolean, onOverflowChange?: (overflowing: boolean) => void, onInfoClick?: () => void }) => {
  const [displayText, setDisplayText] = useState(text);
  const [displayLive, setDisplayLive] = useState(!!isLive);
  const [displayShimmering, setDisplayShimmering] = useState(isShimmering);
  const [animState, setAnimState] = useState<"idle" | "entering" | "exiting">("idle");
  const [iconAnimState, setIconAnimState] = useState<"idle" | "entering" | "exiting">("idle");
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const iconTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const animStateRef = useRef(animState);
  animStateRef.current = animState;
  const iconAnimStateRef = useRef(iconAnimState);
  iconAnimStateRef.current = iconAnimState;
  const textRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLSpanElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isOverflowing, setIsOverflowing] = useState(false);
  const [scrollDistance, setScrollDistance] = useState(0);

  useEffect(() => {
    if (text === displayText && !!isLive === displayLive) {
      if (animStateRef.current === "idle") return;
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      setAnimState("entering");
      timeoutRef.current = setTimeout(() => {
        setAnimState("idle");
      }, 350);
      return;
    }

    // Clear any pending transition
    if (timeoutRef.current) clearTimeout(timeoutRef.current);

    // Start exit animation
    setAnimState("exiting");

    // After exit completes (250ms), swap text and enter
    timeoutRef.current = setTimeout(() => {
      setDisplayText(text);
      setDisplayLive(!!isLive);
      setAnimState("entering");

      // After enter completes (350ms), go idle
      timeoutRef.current = setTimeout(() => {
        setAnimState("idle");
      }, 350);
    }, 250);

    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [text, isLive]);

  // Handle independent icon animation state based on shimmering
  useEffect(() => {
    if (isShimmering === displayShimmering) {
      if (iconAnimStateRef.current === "idle") return;
      if (iconTimeoutRef.current) clearTimeout(iconTimeoutRef.current);
      setIconAnimState("entering");
      iconTimeoutRef.current = setTimeout(() => {
        setIconAnimState("idle");
      }, 350);
      return;
    }

    if (iconTimeoutRef.current) clearTimeout(iconTimeoutRef.current);
    setIconAnimState("exiting");

    iconTimeoutRef.current = setTimeout(() => {
      setDisplayShimmering(isShimmering);
      setIconAnimState("entering");

      iconTimeoutRef.current = setTimeout(() => {
        setIconAnimState("idle");
      }, 350);
    }, 250);

    return () => {
      if (iconTimeoutRef.current) clearTimeout(iconTimeoutRef.current);
    };
  }, [isShimmering, displayShimmering]);

  // Check if text overflows and calculate scroll distance
  useEffect(() => {
    const checkOverflow = () => {
      const textEl = measureRef.current;
      const containerEl = containerRef.current;
      if (textEl && containerEl) {
        const textWidth = textEl.scrollWidth;
        const containerWidth = containerEl.clientWidth;
        const overflows = textWidth > containerWidth + 2;
        if (isOverflowing !== overflows) {
          setIsOverflowing(overflows);
          onOverflowChange?.(overflows);
        }
      }
    };
    checkOverflow();
    const raf = requestAnimationFrame(checkOverflow);
    return () => cancelAnimationFrame(raf);
  }, [displayText, onOverflowChange, isOverflowing]);

  let IconComponent: any = FilePlus2;
  const lowerText = displayText.toLowerCase();

  if (lowerText.includes("connecting")) IconComponent = LoaderCircleIcon;
  else if (lowerText.includes("resolving") || lowerText.includes("detecting") || lowerText.includes("analyzing") || lowerText.includes("seeking")) IconComponent = Search;
  else if (lowerText.includes("loading") || lowerText.includes("preparing") || lowerText.includes("buffering") || lowerText.includes("transcoding")) IconComponent = Loader2;
  else if (displayShimmering) IconComponent = LoaderCircleIcon;
  else if (!displayShimmering && lowerText !== "awaiting media source") IconComponent = Info;
  else IconComponent = FilePlus2;

  return (
    <div className={`title-status-wrapper w-full ${animState}`}>
      <div className={`icon-anim-wrapper flex shrink-0 ${iconAnimState}`}>
        {IconComponent === Info && onInfoClick ? (
          <IconComponent
            onClick={onInfoClick}
            className="h-4 w-4 shrink-0 text-white/80 hover:text-white transition-colors cursor-pointer"
            title="Media Details"
          />
        ) : (
          <IconComponent className={`h-4 w-4 shrink-0 text-white/80 ${IconComponent === Loader2 ? 'animate-spin' : ''}`} />
        )}
      </div>
      <div ref={containerRef} className="title-marquee-container">
        <div
          ref={textRef}
          className={`title-marquee-wrapper ${isOverflowing ? 'overflowing' : ''}`}
        >
          <span ref={measureRef} className={`title-status-text ${isShimmering ? 'is-shimmering' : ''}`}>
            {displayText}
          </span>
          {isOverflowing && (
            <span className={`title-status-text ${isShimmering ? 'is-shimmering' : ''}`} style={{ paddingLeft: '48px' }}>
              {displayText}
            </span>
          )}
        </div>
      </div>
    </div>
  );
};

// ── Frame Rate Row for Media Info modal ──
// Uses ffprobe's streamFps when available, otherwise measures FPS from the video element.
const FrameRateRow = ({ videoRef, streamFps }: { videoRef: React.RefObject<HTMLVideoElement | null>; streamFps: number | null }) => {
  const [measuredFps, setMeasuredFps] = useState<number | null>(null);

  useEffect(() => {
    if (streamFps) return; // ffprobe already provided fps
    const video = videoRef.current;
    if (!video || !('requestVideoFrameCallback' in video)) return;

    let prevTime = 0;
    let frameCount = 0;
    let rafId: number | null = null;

    const onFrame = (_now: number, metadata: { mediaTime: number }) => {
      if (prevTime > 0) {
        const delta = metadata.mediaTime - prevTime;
        if (delta > 0) {
          frameCount++;
          if (frameCount >= 15) {
            // We've seen enough frames — calculate average
            const totalDelta = metadata.mediaTime - prevTime + (delta * (frameCount - 1) / frameCount);
            // simpler: just use 1/delta for instantaneous fps, averaged over the last frame
            const instantFps = Math.round(1 / delta);
            // Snap to common frame rates
            const common = [24, 25, 30, 50, 60];
            const snapped = common.find(c => Math.abs(instantFps - c) <= 2) || instantFps;
            setMeasuredFps(snapped);
            return; // Stop measuring
          }
        }
      }
      prevTime = metadata.mediaTime;
      rafId = (video as any).requestVideoFrameCallback(onFrame);
    };

    rafId = (video as any).requestVideoFrameCallback(onFrame);
    return () => {
      if (rafId !== null) {
        try { (video as any).cancelVideoFrameCallback(rafId); } catch { }
      }
    };
  }, [streamFps, videoRef]);

  const fps = streamFps || measuredFps;

  return (
    <div className="flex justify-between items-center">
      <span className="text-sm text-white">Frame Rate</span>
      <span className="text-sm text-white/50">
        {fps ? `${fps} fps` : 'Measuring...'}
      </span>
    </div>
  );
};

const ModalMarqueeTitle = ({ text }: { text: string }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLSpanElement>(null);
  const [isOverflowing, setIsOverflowing] = useState(false);

  useEffect(() => {
    const checkOverflow = () => {
      if (containerRef.current && measureRef.current) {
        const containerWidth = containerRef.current.offsetWidth;
        const textWidth = measureRef.current.offsetWidth;
        setIsOverflowing(textWidth > containerWidth);
      }
    };
    checkOverflow();
    const raf = requestAnimationFrame(checkOverflow);
    return () => cancelAnimationFrame(raf);
  }, [text]);

  return (
    <div ref={containerRef} className={`title-marquee-container flex max-w-[60%] ${isOverflowing ? 'justify-start' : 'justify-end'}`}>
      <div className={`title-marquee-wrapper ${isOverflowing ? 'overflowing' : ''}`}>
        <span ref={measureRef} className="text-sm text-white/50 font-medium whitespace-nowrap">
          {text}
        </span>
        {isOverflowing && (
          <span className="text-sm text-white/50 font-medium whitespace-nowrap" style={{ paddingLeft: '48px' }}>
            {text}
          </span>
        )}
      </div>
    </div>
  );
};


const formatTime = (time: number) => {
  if (isNaN(time)) return "0:00";
  const s = Math.floor(time % 60);
  const m = Math.floor(time / 60) % 60;
  const h = Math.floor(time / 3600);
  const ss = s < 10 ? `0${s}` : s;
  const mm = m < 10 ? `0${m}` : m;
  return h === 0 ? `${mm}:${ss}` : `${h}:${mm}:${ss}`;
};

const getRuntimeAssetUrl = (assetPath: string) => {
  const cleanPath = String(assetPath || "").replace(/^\/+/, "");
  if (!cleanPath) return "";

  try {
    return new URL(cleanPath, window.location.href).toString();
  } catch {
    return `./${cleanPath}`;
  }
};

// ── Unified Pixeldrain URL parser ──
// Replaces getPixelDrainFileId, getPixeldrainAlbumOrFolderId, getPixeldrainFolderId, getPixeldrainFolderFileTarget
type PixeldrainParsed =
  | { type: 'file'; id: string }
  | { type: 'album'; id: string }
  | { type: 'd_unknown'; id: string }
  | { type: 'folder_file'; folderId: string; filePath: string; fileName: string }
  | null;

const parsePixeldrainUrl = (rawUrl: string): PixeldrainParsed => {
  try {
    const parsed = new URL(rawUrl);
    const host = parsed.hostname.toLowerCase();
    if (host !== 'pixeldrain.com' && host !== 'www.pixeldrain.com') return null;

    const parts = parsed.pathname.split('/').filter(Boolean);
    if (!parts[0] || !parts[1]) return null;

    // /u/{id} → direct file
    if (parts[0] === 'u' && parts.length === 2) {
      return { type: 'file', id: parts[1] };
    }
    // /api/file/{id} → direct file
    if (parts[0] === 'api' && parts[1] === 'file' && parts[2]) {
      return { type: 'file', id: parts[2] };
    }
    // /api/filesystem/{id}/{path...} → folder file
    if (parts[0] === 'api' && parts[1] === 'filesystem' && parts[2] && parts.length > 3) {
      const filePath = parts.slice(3).join('/');
      return { type: 'folder_file', folderId: parts[2], filePath, fileName: decodeURIComponent(parts[parts.length - 1] || filePath) };
    }
    // /l/{id} or /i/{id} → album
    if ((parts[0] === 'l' || parts[0] === 'i') && parts[1] && parts.length === 2) {
      return { type: 'album', id: parts[1] };
    }
    // /d/{id}/{path...} → folder file
    if (parts[0] === 'd' && parts[1] && parts.length > 2) {
      const filePath = parts.slice(2).join('/');
      return { type: 'folder_file', folderId: parts[1], filePath, fileName: decodeURIComponent(parts[parts.length - 1] || filePath) };
    }
    // /d/{id} → ambiguous (could be folder or direct stream)
    if (parts[0] === 'd' && parts[1] && parts.length === 2) {
      return { type: 'd_unknown', id: parts[1] };
    }

    return null;
  } catch {
    return null;
  }
};

// Backwards-compat shims so existing code doesn't break during migration
const getPixelDrainFileId = (rawUrl: string): string | null => {
  const p = parsePixeldrainUrl(rawUrl);
  if (!p) return null;
  if (p.type === 'file') return p.id;
  if (p.type === 'd_unknown') return p.id;
  return null;
};
const getPixeldrainAlbumOrFolderId = (rawUrl: string): { type: 'album' | 'folder'; id: string } | null => {
  const p = parsePixeldrainUrl(rawUrl);
  if (!p) return null;
  if (p.type === 'album') return { type: 'album', id: p.id };
  if (p.type === 'd_unknown') return { type: 'folder', id: p.id };
  return null;
};
const getPixeldrainFolderFileTarget = (rawUrl: string): { folderId: string; filePath: string; fileName: string } | null => {
  const p = parsePixeldrainUrl(rawUrl);
  if (!p || p.type !== 'folder_file') return null;
  return { folderId: p.folderId, filePath: p.filePath, fileName: p.fileName };
};

const resolveDirectVideoUrl = (rawUrl: string) => {
  try {
    const parsed = new URL(rawUrl);
    const host = parsed.hostname.toLowerCase();
    const pathParts = parsed.pathname.split("/").filter(Boolean);
    const mimeType = String(parsed.searchParams.get("mime") || "").toLowerCase();

    const isGofileHost = host.includes("gofile.io");

    if (isGofileHost) {
      return null;
    }

    if (host === "pixeldrain.com" || host === "www.pixeldrain.com") {
      const p = parsePixeldrainUrl(rawUrl);
      if (p) {
        if (p.type === 'folder_file') {
          return {
            url: `https://pixeldrain.com/api/filesystem/${p.folderId}/${p.filePath.split('/').map((part) => encodeURIComponent(decodeURIComponent(part))).join('/')}`,
            title: p.fileName || `pixeldrain-${p.folderId}`
          };
        }
        if (p.type === 'file') {
          return {
            url: `https://pixeldrain.com/api/file/${p.id}`,
            title: `pixeldrain-${p.id}`,
            retryUrls: [`https://pixeldrain.com/api/file/${p.id}?download`]
          };
        }
      }
      return null;
    }

    const looksLikeDirectFile = /\.(mp4|webm|ogg|mkv|mov|avi|m3u8)$/i.test(parsed.pathname);
    const isDriveVideoPlayback =
      parsed.pathname.toLowerCase().includes("videoplayback") ||
      host.includes("googlevideo.com") ||
      host.endsWith(".c.drive.google.com") ||
      (host.includes("drive.google.com") && parsed.pathname.toLowerCase().includes("videoplayback"));
    const hasVideoMime = mimeType.startsWith("video/") || mimeType.includes("mpegurl") || mimeType.includes("x-mpegurl");

    if (isDriveVideoPlayback || hasVideoMime) {
      return {
        url: rawUrl,
        title: pathParts[pathParts.length - 1] || "Online Video",
      };
    }

    if (looksLikeDirectFile) {
      return {
        url: rawUrl,
        title: parsed.pathname.split("/").pop() || "Online Video",
      };
    }

    return null;
  } catch {
    return null;
  }
};

const normalizeOnlineUrl = (rawUrl: string) => {
  const trimmed = rawUrl.trim();
  try {
    const parsed = new URL(trimmed);
    const host = parsed.hostname.toLowerCase();

    const isYoutubeHost =
      host === "youtube.com" ||
      host === "www.youtube.com" ||
      host === "m.youtube.com" ||
      host === "music.youtube.com";

    if (isYoutubeHost) {
      const videoId = parsed.searchParams.get("v");
      if (videoId) {
        return `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
      }
    }

    if (host === "youtu.be") {
      const videoId = parsed.pathname.split("/").filter(Boolean)[0];
      if (videoId) {
        return `https://youtu.be/${encodeURIComponent(videoId)}`;
      }
    }

    return trimmed;
  } catch {
    return trimmed;
  }
};

const sanitizeOnlineUrl = (rawUrl: string) => {
  const trimmed = String(rawUrl || "").trim();
  if (!trimmed) return "";
  const matched = trimmed.match(/https?:\/\/\S+/i);
  const candidate = matched ? matched[0] : trimmed;
  return candidate.replace(/[\])}"'.,;!?\u2026]+$/g, "");
};

const isDrivePlaybackLike = (rawUrl: string) => {
  try {
    const parsed = new URL(rawUrl);
    const host = parsed.hostname.toLowerCase();
    const pathname = parsed.pathname.toLowerCase();
    return (
      pathname.includes("videoplayback") ||
      host.endsWith(".c.drive.google.com") ||
      (host.includes("drive.google.com") && pathname.includes("videoplayback"))
    );
  } catch {
    return /videoplayback/i.test(rawUrl);
  }
};

const isGofileUrl = (rawUrl: string) => {
  try {
    const parsed = new URL(rawUrl);
    const host = parsed.hostname.toLowerCase();
    return host === "gofile.io" || host.endsWith(".gofile.io");
  } catch {
    return /gofile\.io/i.test(rawUrl);
  }
};

const isPixelDrainUrl = (rawUrl: string) => {
  try {
    const parsed = new URL(rawUrl);
    const host = parsed.hostname.toLowerCase();
    return host === 'pixeldrain.com' || host === 'www.pixeldrain.com' || host.includes('pixeldrain.eu.cc');
  } catch {
    return rawUrl.includes('pixeldrain');
  }
};

const isHlsLikeUrl = (rawUrl: string) => {
  const value = String(rawUrl || "").toLowerCase();
  if (!value) return false;
  if (/\.m3u8(?:$|\?|#)/i.test(value)) return true;
  if (value.includes("mpegurl")) return true;
  if (/\/local-media\?path=.*\.m3u8/i.test(value)) return true;

  try {
    const parsed = new URL(rawUrl);
    if (parsed.pathname === '/proxy' && parsed.searchParams.has('url')) {
      const target = decodeURIComponent(parsed.searchParams.get('url')!).toLowerCase();
      return /\.m3u8(?:$|\?|#)/i.test(target) || target.includes('mpegurl');
    }
  } catch { }
  return false;
};

const isDashLikeUrl = (rawUrl: string) => {
  const value = String(rawUrl || "").toLowerCase();
  if (/\.mpd(?:$|\?|#)/i.test(value)) return true;
  if (value.includes('dash')) return true;

  try {
    const parsed = new URL(rawUrl);
    if (parsed.pathname === '/proxy' && parsed.searchParams.has('url')) {
      const target = decodeURIComponent(parsed.searchParams.get('url')!).toLowerCase();
      return /\.mpd(?:$|\?|#)/i.test(target) || target.includes('dash');
    }
  } catch { }
  return false;
};

const isProtectedProxyUrl = (rawUrl: string) => {
  try {
    const parsed = new URL(String(rawUrl || "").trim());
    return parsed.pathname === "/proxy" && parsed.searchParams.has("rid");
  } catch {
    return false;
  }
};

const getElectronApi = () => {
  try {
    const byRequire = (window as any).require?.("electron");
    if (byRequire?.ipcRenderer) return byRequire;

    const byWindow = (window as any).electron;
    if (byWindow?.ipcRenderer) return byWindow;

    const rawIpc = (window as any).ipcRenderer;
    if (rawIpc) return { ipcRenderer: rawIpc };

    return null;
  } catch {
    return null;
  }
};

const extractDriveId = (rawUrl: string) => {
  try {
    const parsed = new URL(rawUrl);
    const host = parsed.hostname.toLowerCase();
    const isGoogleDriveHost =
      host === "drive.google.com" ||
      host === "drive.usercontent.google.com" ||
      host.endsWith(".c.drive.google.com") ||
      host.includes("googlevideo.com");

    if (!isGoogleDriveHost) return null;

    const queryId = parsed.searchParams.get("driveid") || parsed.searchParams.get("id");
    if (queryId) return queryId;

    const parts = parsed.pathname.split("/").filter(Boolean);
    const dIndex = parts.indexOf("d");
    if (dIndex >= 0 && parts[dIndex + 1]) return parts[dIndex + 1];

    const fileIndex = parts.indexOf("file");
    if (fileIndex >= 0 && parts[fileIndex + 2]) return parts[fileIndex + 2];
    return null;
  } catch {
    return null;
  }
};

const getDriveRetryUrls = (rawUrl: string) => {
  const driveId = extractDriveId(rawUrl);
  if (!driveId) return [];

  return [
    `https://drive.google.com/uc?export=download&id=${encodeURIComponent(driveId)}`,
    `https://drive.usercontent.google.com/download?id=${encodeURIComponent(driveId)}&export=download&confirm=t`,
  ];
};

const toFileProtocolUrl = (filePath: string) => {
  const normalized = String(filePath || "").replace(/\\/g, "/");
  if (!normalized) return "";
  if (/^[a-zA-Z]:\//.test(normalized)) {
    return `file:///${encodeURI(normalized)}`;
  }
  if (normalized.startsWith("/")) {
    return `file://${encodeURI(normalized)}`;
  }
  return `file://${encodeURI(normalized)}`;
};

const getPreviewMediaSource = (rawUrl: string) => {
  const value = String(rawUrl || "").trim();
  if (!value) return "";
  return value;
};

const extractPixeldrainFilesFromResponse = (payload: any) => {
  const candidateCollections = [
    payload?.children,
    payload?.value?.children,
    payload?.data?.children,
    payload?.files,
    payload?.value?.files,
    payload?.data?.files,
    payload?.items,
    payload?.value?.items,
    payload?.data?.items,
  ];

  const collection = candidateCollections.find((entry) => Array.isArray(entry)) || [];

  return collection
    .filter((f: any) => {
      const fileName = String(f?.name || f?.path || f?.id || "").trim();
      const type = String(f?.type || "").toLowerCase();
      if (!fileName || fileName === '.search_index.gz') return false;
      if (!type) return true;
      return type === 'file';
    })
    .map((f: any) => ({
      name: decodeURIComponent(String(f?.name || f?.path || f?.id || 'Unknown')),
      id: String(f?.name || f?.path || f?.id || '').trim(),
    }))
    .filter((f: { name: string; id: string }) => !!f.id);
};

const isLikelyLocalFilesystemPath = (rawPath: string) => {
  const value = String(rawPath || "").trim();
  if (!value) return false;
  if (value.startsWith("file://")) return true;
  if (/^[a-zA-Z]:[\\/]/.test(value)) return true;
  if (value.startsWith("/")) return true;
  return false;
};

const normalizeYoutubeQualityOptions = (rawQualities: any) => {
  if (!Array.isArray(rawQualities)) return [{ label: "undefined", value: "undefined", format: "UND" }];

  const normalized = rawQualities
    .map((opt: any) => {
      const val = String(opt?.value || opt?.label || "undefined");
      const rawLabel = String(opt?.label || opt?.value || "undefined");
      return {
        label: cleanQualityLabel(rawLabel),
        value: val,
        audioUrl: opt?.audioUrl || null,
        format: detectFormat(val, rawLabel, opt?.format),
      };
    })
    .filter((opt: any) => !!opt.label && !!opt.value)
    .filter((opt: any, index: number, self: any[]) => index === self.findIndex((t: any) => t.label === opt.label));

  return normalized.length > 0 ? normalized : [{ label: "undefined", value: "undefined", format: "UND" }];
};

const detectFormat = (url: string, label?: string, itemFormat?: string) => {
  if (itemFormat && itemFormat !== 'UND') return itemFormat;
  const val = String(url || "").toLowerCase();
  const rawLabel = String(label || "");

  if (rawLabel.includes('HEVC')) return 'HEVC';
  if (rawLabel.includes('AVC')) return 'AVC';
  if (rawLabel.includes('AV1')) return 'AV1';
  if (rawLabel.includes('VP9')) return 'VP9';
  if (rawLabel.includes('VP8')) return 'VP8';

  const labelMatch = rawLabel.match(/\(([^)]+)\)\s*$/);
  if (labelMatch) {
    const rawFmt = labelMatch[1].toUpperCase();
    if (rawFmt.includes('HLS') && rawFmt.includes('DASH')) return 'DASH';
    if (rawFmt.includes('HLS')) return 'HLS';
    if (rawFmt.includes('DASH')) return 'DASH';
    if (rawFmt.includes('AV1')) return 'AV1';
    if (rawFmt.includes('HEVC') || rawFmt.includes('H265')) return 'HEVC';
    if (rawFmt.includes('H264') || rawFmt.includes('AVC')) return 'AVC';
    if (rawFmt.includes('VP9')) return 'VP9';
    if (rawFmt.includes('MP4')) return 'MP4';
    if (rawFmt.includes('MKV')) return 'MKV';
    return rawFmt.split(/[ /]/)[0].trim();
  }

  if (isHlsLikeUrl(url)) return 'HLS';
  if (isDashLikeUrl(url)) return 'DASH';

  if (/\.(mp4|m4v)(?:$|\?|#|\/)/i.test(val)) return 'AVC';
  if (/\.(mkv|webm)(?:$|\?|#|\/)/i.test(val)) return 'MKV';
  if (/\.flv(?:$|\?|#|\/)/i.test(val)) return 'FLV';
  if (/\.ts(?:$|\?|#|\/)/i.test(val)) return 'TS';
  if (/\.webm(?:$|\?|#|\/)/i.test(val)) return 'WEBM';
  if (/\.(m3u8|mpegurl)(?:$|\?|#|\/)/i.test(val)) return 'HLS';
  if (/\.mpd(?:$|\?|#|\/)/i.test(val)) return 'DASH';

  if (/[\?&]download[=&]|\/download[\/&?]|(?:^|&)download(?:&|$)/i.test(val)) return 'DL';

  return 'UND';
};

const cleanQualityLabel = (label: string) => {
  return String(label || "").replace(/\s*\([^)]*\)\s*$/g, "").trim();
};

const getLanguageDisplayName = (language?: string | null, label?: string | null) => {
  const cleanLanguage = String(language || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "");

  if (["eng", "en", "english"].includes(cleanLanguage)) return "English";
  if (["ara", "ar", "arabic"].includes(cleanLanguage)) return "Arabic";
  if (["spa", "es", "spanish"].includes(cleanLanguage)) return "Spanish";
  if (["jpn", "ja", "japanese"].includes(cleanLanguage)) return "Japanese";
  if (["kor", "ko", "korean"].includes(cleanLanguage)) return "Korean";
  if (["chi", "zho", "zh", "chs", "cht", "chinese"].includes(cleanLanguage)) return "Chinese";
  if (["fre", "fra", "fr", "french"].includes(cleanLanguage)) return "French";
  if (["ger", "de", "german"].includes(cleanLanguage)) return "German";
  if (["hin", "hi", "hindi"].includes(cleanLanguage)) return "Hindi";
  if (["ind", "id", "indonesian"].includes(cleanLanguage)) return "Indonesian";

  const lowerLabel = String(label || "").trim().toLowerCase();
  if (/\beng(?:lish)?\b/.test(lowerLabel)) return "English";
  if (/\bara(?:bic)?\b/.test(lowerLabel)) return "Arabic";
  if (/\bspa(?:nish)?\b/.test(lowerLabel)) return "Spanish";
  if (/\bjpn|japanese\b/.test(lowerLabel)) return "Japanese";
  if (/\bkor|korean\b/.test(lowerLabel)) return "Korean";
  if (/\bchi|chinese\b/.test(lowerLabel)) return "Chinese";
  if (/\bger|german\b/.test(lowerLabel)) return "German";
  if (/\bfra|fre|french\b/.test(lowerLabel)) return "French";
  if (/\bhin|hindi\b/.test(lowerLabel)) return "Hindi";
  if (/\bind|indonesian\b/.test(lowerLabel)) return "Indonesian";

  return "";
};

const stripLanguageMarkerFromTrackLabel = (baseLabel: string, language?: string | null) => {
  const cleanBase = String(baseLabel || "").trim() || "Unknown";
  const cleanLanguage = String(language || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "");

  let result = cleanBase
    .replace(/\s*\[[a-z0-9-]{2,10}\]\s*$/i, "")
    .replace(/\s*\((?:[a-z0-9-]{2,10})\)\s*$/i, "")
    .trim();

  if (cleanLanguage && cleanLanguage !== "und") {
    const escaped = cleanLanguage.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    result = result
      .replace(new RegExp(`\s*\[${escaped}\]\s*$`, "i"), "")
      .replace(new RegExp(`\s*\(${escaped}\)\s*$`, "i"), "")
      .trim();
  }

  return result || "Unknown";
};

const buildLocalTrackTitle = (baseLabel: string, language?: string | null) => {
  const languageName = getLanguageDisplayName(language, baseLabel);
  if (languageName) return languageName;
  return stripLanguageMarkerFromTrackLabel(baseLabel, language);
};

const deriveLocalSubtitleBadge = (track: any, rawLabel: string) => {
  const candidates = [
    track?.format,
    track?.codec,
    track?.codecName,
    track?.codec_name,
    track?.type,
    track?.mimeType,
    rawLabel,
  ]
    .filter(Boolean)
    .map((value) => String(value).trim());

  for (const value of candidates) {
    const lower = value.toLowerCase();
    if (/\bass\b|\bssa\b/.test(lower)) return "ASS";
    if (/\bsrt\b|subrip/.test(lower)) return "SRT";
    if (/\bvtt\b|webvtt/.test(lower)) return "VTT";
    if (/\bpgs\b/.test(lower)) return "PGS";
    if (/\bsub\b|vobsub/.test(lower)) return "SUB";
    if (/\bttml\b/.test(lower)) return "TTML";
  }

  return "SUB";
};

const deriveLocalAudioBadge = (track: any, rawLabel: string) => {
  const candidates = [
    track?.format,
    track?.codec,
    track?.codecName,
    track?.codec_name,
    track?.mimeType,
    rawLabel,
  ]
    .filter(Boolean)
    .map((value) => String(value).trim());

  for (const value of candidates) {
    const lower = value.toLowerCase();
    if (/\baac\b/.test(lower)) return "AAC";
    if (/\bac-?3\b|\bdd\b|dolby digital/.test(lower)) return "AC3";
    if (/\be-?ac-?3\b|\bddp\b|dolby digital plus/.test(lower)) return "EAC3";
    if (/\bmp3\b|mpeg layer 3/.test(lower)) return "MP3";
    if (/\bflac\b/.test(lower)) return "FLAC";
    if (/\bopus\b/.test(lower)) return "OPUS";
    if (/\bvorbis\b/.test(lower)) return "VORBIS";
    if (/\bpcm\b|\blpcm\b/.test(lower)) return "PCM";
    if (/\btruehd\b/.test(lower)) return "TRUEHD";
    if (/\bdts[- ]?hd\b/.test(lower)) return "DTS-HD";
    if (/\bdts\b/.test(lower)) return "DTS";
  }

  return "AUD";
};

const formatTrackLabel = (baseLabel: string, language?: string | null) => {
  const cleanBase = String(baseLabel || "").trim() || "Unknown";
  const cleanLanguage = String(language || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "");

  if (!cleanLanguage || cleanLanguage === "und" || cleanBase.toLowerCase().includes(`[${cleanLanguage}]`)) {
    return cleanBase;
  }

  return `${cleanBase} [${cleanLanguage}]`;
};

const getSubtitleFormatFromUrl = (rawUrl: string) => {
  const matched = String(rawUrl || "").match(/\.([a-z0-9]+)(?:$|\?)/i);
  const ext = String(matched?.[1] || "").toLowerCase();
  if (["srt", "vtt", "ass", "ssa"].includes(ext)) return ext.toUpperCase();
  return "SUB";
};

const normalizeOnlineSubtitleEntry = (sub: any) => {
  const url = String(sub?.url || "").trim();
  const language = sub?.language ? String(sub.language).trim() : null;
  const normalizedLanguage = language && language.toLowerCase() !== "und" ? language : null;
  const label = String(sub?.label || "").trim() || (normalizedLanguage ? normalizedLanguage : "Unknown");
  const format = String(sub?.format || getSubtitleFormatFromUrl(url)).trim().toUpperCase() || "SUB";

  return {
    url,
    language: normalizedLanguage,
    label,
    format,
  };
};

const ASS_FONT_MAP: Record<string, string> = {
  arial: getRuntimeAssetUrl("fonts/arial.ttf"),
  "arialmt": getRuntimeAssetUrl("fonts/arial.ttf"),
  "arial unicode ms": getRuntimeAssetUrl("fonts/arial.ttf"),
  "lato": getRuntimeAssetUrl("fonts/Lato-Regular.ttf"),
  "lato regular": getRuntimeAssetUrl("fonts/Lato-Regular.ttf"),
  "lato bold": getRuntimeAssetUrl("fonts/Lato-Bold.ttf"),
  "lato italic": getRuntimeAssetUrl("fonts/Lato-Italic.ttf"),
  "lato bold italic": getRuntimeAssetUrl("fonts/Lato-BoldItalic.ttf"),
  "poetsen one": getRuntimeAssetUrl("fonts/PoetsenOne-Regular.ttf"),
  "segoe ui": getRuntimeAssetUrl("fonts/NotoSans-Regular.ttf"),
  "noto sans": getRuntimeAssetUrl("fonts/NotoSans-Regular.ttf"),
  "noto sans regular": getRuntimeAssetUrl("fonts/NotoSans-Regular.ttf"),
  "noto sans bold": getRuntimeAssetUrl("fonts/NotoSans-Bold.ttf"),
  "noto sans italic": getRuntimeAssetUrl("fonts/NotoSans-Italic.ttf"),
  "fot kafu techno std strp u": getRuntimeAssetUrl("fonts/NotoSansJP-Regular.ttf"),
  "fot modemin std bold": getRuntimeAssetUrl("fonts/NotoSansJP-Regular.ttf"),
};

const DEFAULT_ASS_FONTS = [
  getRuntimeAssetUrl("fonts/arial.ttf"),
  getRuntimeAssetUrl("fonts/NotoSans-Regular.ttf"),
  getRuntimeAssetUrl("fonts/NotoSans-Bold.ttf"),
  getRuntimeAssetUrl("fonts/NotoSans-Italic.ttf"),
  getRuntimeAssetUrl("fonts/NotoSansJP-Regular.ttf"),
  getRuntimeAssetUrl("fonts/Lato-Regular.ttf"),
  getRuntimeAssetUrl("fonts/Lato-Bold.ttf"),
  getRuntimeAssetUrl("fonts/Lato-Italic.ttf"),
  getRuntimeAssetUrl("fonts/Lato-BoldItalic.ttf"),
  getRuntimeAssetUrl("fonts/PoetsenOne-Regular.ttf"),
];

const normalizeAssFontKey = (value: string) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/["']/g, "")
    .replace(/\s+/g, " ");

const resolveAssFontPaths = (fontNames: string[], extractedFonts: string[] = []) => {
  const resolved = new Set<string>();

  DEFAULT_ASS_FONTS.forEach((fontPath) => resolved.add(fontPath));

  for (const extractedFontPath of extractedFonts || []) {
    if (!extractedFontPath) continue;
    try {
      const normalizedPath = String(extractedFontPath).replace(/\\/g, '/');
      const fileUrl = normalizedPath.startsWith('file://')
        ? normalizedPath
        : `file:///${encodeURI(normalizedPath.replace(/^\/+/, ''))}`;
      resolved.add(fileUrl);
    } catch {
      // ignore malformed extracted font path
    }
  }

  for (const rawName of fontNames || []) {
    const key = normalizeAssFontKey(rawName);
    const mapped = ASS_FONT_MAP[key];
    if (mapped) {
      resolved.add(mapped);
    }
  }

  [
    getRuntimeAssetUrl("fonts/Lato-Regular.ttf"),
    getRuntimeAssetUrl("fonts/Lato-Bold.ttf"),
    getRuntimeAssetUrl("fonts/Lato-Italic.ttf"),
    getRuntimeAssetUrl("fonts/Lato-BoldItalic.ttf"),
  ].forEach((fontPath) => resolved.add(fontPath));

  return Array.from(resolved);
};

const isAssSubtitleContent = (text: string) => /\[Script Info\]|\[V4\+? Styles\]|^Dialogue:/mi.test(String(text || "").trim());

interface DownloadInfo {
  percent: number;
  speed: string;
  downloaded: string;
  total: string;
  status: "idle" | "downloading" | "complete" | "error" | "paused";
  fileName: string;
  label: string;
  format: string;
  url: string;
  audioUrl: string | null;
  pageUrl: string | null;
  qualityLabel: string;
  isMerging?: boolean;
  errorMessage?: string;
  filePath?: string;
  startTime?: number;
}

interface PlaylistEntry {
  id: string;
  name: string;
  url: string;
  duration: number;
  group: string;
  logo: string;
  originalIndex: number;
  isHidden: boolean;
  isFavorite: boolean;
  httpHeaders?: Record<string, string>;
  drmKeys?: Record<string, string>;
}

interface Playlist {
  id: string;
  name: string;
  source: 'local' | 'remote';
  sourceUrl: string;
  entries: PlaylistEntry[];
  groups: string[];
  lastUpdated: number;
  autoRefresh: boolean;
}

const RecordingTimer = ({ startTime }: { startTime: number }) => {
  const [elapsed, setElapsed] = useState(Date.now() - startTime);

  useEffect(() => {
    const interval = setInterval(() => {
      setElapsed(Date.now() - startTime);
    }, 1000);
    return () => clearInterval(interval);
  }, [startTime]);

  const s = Math.floor(elapsed / 1000) % 60;
  const m = Math.floor(elapsed / 60000) % 60;
  const h = Math.floor(elapsed / 3600000);

  const ss = s < 10 ? `0${s}` : s;
  const mm = m < 10 ? `0${m}` : m;

  if (h > 0) {
    const hh = h < 10 ? `0${h}` : h;
    return <span>{hh}:{mm}:{ss}</span>;
  }
  return <span>{mm}:{ss}</span>;
}; const PlCardMarquee = ({ text, className, textClassName, style }: { text: string, className?: string, textClassName?: string, style?: React.CSSProperties }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);
  const [isOverflowing, setIsOverflowing] = useState(false);

  useEffect(() => {
    // Check overflow once on mount
    if (textRef.current && containerRef.current) {
      setIsOverflowing(textRef.current.scrollWidth > containerRef.current.clientWidth + 2);
    }
  }, [text]);

  return (
    <div ref={containerRef} className={`title-marquee-container ${className || ''}`} style={style}>
      <div className={`title-marquee-wrapper ${isOverflowing ? 'can-overflow' : 'justify-center h-full'}`}>
        <span ref={textRef} className={`${textClassName || ''} truncate-when-not-hovered`}>
          {text}
        </span>
        {isOverflowing && (
          <span className={`${textClassName || ''} marquee-duplicate`} style={{ paddingLeft: '48px' }}>
            {text}
          </span>
        )}
      </div>
    </div>
  );
};

export default function App() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const dashRef = useRef<dashjs.MediaPlayerClass | null>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const progressAreaRef = useRef<HTMLDivElement>(null);
  const settingsMenuRef = useRef<HTMLDivElement>(null);
  const settingsBtnRef = useRef<HTMLButtonElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const subtitleInputRef = useRef<HTMLInputElement>(null);
  const urlInputRef = useRef<HTMLInputElement>(null);
  const hideControlsTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRetrySeekTimeRef = useRef<number | null>(null);
  const statusHideTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const settingsCloseTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const preserveQualityOptionsRef = useRef(false);
  const pauseTimeRef = useRef<number | null>(null);
  // Tracks a pending stall-recovery timeout so we can clear it when the
  // stream recovers on its own (onPlaying fires).
  const stallRecoveryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const playingWatchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seekWatchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Counts consecutive stall-recovery attempts so we can escalate from
  // micro-seek to a full source reload if the first attempt doesn't help.
  const stallRecoveryAttemptRef = useRef(0);

  const [videoSrc, setVideoSrc] = useState("");
  const [activeOnlineUrl, setActiveOnlineUrl] = useState<string | null>(null);
  const [audioSrc, setAudioSrc] = useState<string | null>(null);
  const [videoTitle, setVideoTitle] = useState("Awaiting Media Source");
  const stableVideoTitleRef = useRef("Awaiting Media Source");

  const [subtitles, setSubtitles] = useState<{ start: number; end: number; text: string }[]>([]);
  const [customCaptionName, setCustomCaptionName] = useState<string | null>(null);
  const [embeddedSubtitleText, setEmbeddedSubtitleText] = useState<string>("");
  const [extractedSubtitles, setExtractedSubtitles] = useState<{ url: string; language?: string | null; label: string; format?: string | null }[]>([]);
  const [assMode, setAssMode] = useState(false);
  const assInstanceRef = useRef<any>(null);
  const [assSubtitleContent, setAssSubtitleContent] = useState<string | null>(null);
  const assModeRef = useRef(false);
  const assSubtitleContentRef = useRef<string | null>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  useEffect(() => { isMutedRef.current = isMuted; }, [isMuted]);
  const [volume, setVolume] = useState(1);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [activeSubmenu, setActiveSubmenu] = useState<string | null>(null);

  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [quality, setQuality] = useState("Default");
  const [qualityOptions, setQualityOptions] = useState<{ label: string; value: string; audioUrl?: string | null; format?: string }[]>([{ label: "Default", value: "Default", format: "UND" }]);
  const [format, setFormat] = useState("UND");
  const [isYoutubeStream, setIsYoutubeStream] = useState(false);
  const [isYoutubeLive, setIsYoutubeLive] = useState(false);
  const isYoutubeStreamRef = useRef(false);
  const selectedQualityValueRef = useRef("Default");
  const selectedYoutubeQualityIdRef = useRef("Default");
  const preferredYoutubeQualityIdRef = useRef("Default");
  const currentQualityLabelRef = useRef("Default");
  const youtubeQualitySwitchPendingRef = useRef(false);
  const youtubeRecoveryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const youtubeRecoveryInFlightRef = useRef(false);
  const youtubeAutoUpgradeDoneRef = useRef(false);
  const youtubeAutoUpgradeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resumeAfterQualitySwitchRef = useRef(false);

  const [caption, setCaption] = useState("Off");
  const [selectedSubtitleLabel, setSelectedSubtitleLabel] = useState("Off");
  const [selectedSubtitleId, setSelectedSubtitleId] = useState("off");
  const [, setDemuxSubtitleActive] = useState(false);
  const [availableTextTracks, setAvailableTextTracks] =
    useState<{ id: string; label: string; index: number; badge?: string | null; title?: string | null }[]>([]);

  const [audioTrack, setAudioTrack] = useState("Default");
  const [selectedAudioTrackId, setSelectedAudioTrackId] = useState("default");
  const [availableAudioTracks, setAvailableAudioTracks] =
    useState<{ id: string; label: string; index: number; badge?: string | null; title?: string | null; url?: string | null; qualities?: { label: string; value: string; audioTrackId?: string }[]; selectedQuality?: string | null }[]>([]);
  const animeAudioTrackMapRef = useRef<Record<string, { id: string; label: string; title?: string | null; url?: string | null; qualities?: { label: string; value: string; audioTrackId?: string }[]; selectedQuality?: string | null }>>({});

  const [folderFiles, setFolderFiles] = useState<{ name: string; id: string; url?: string }[]>([]);
  const [selectedFolder, setSelectedFolder] = useState<string>("None");
  const [, setFolderName] = useState<string>("None");
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [isDemuxedLocalFile, setIsDemuxedLocalFile] = useState(false);
  const [currentLocalFilePath, setCurrentLocalFilePath] = useState<string>("");
  const subtitleCacheRef = useRef<Map<number, { rawText: string; cues: { start: number; end: number; text: string }[]; isAss: boolean }>>(new Map());

  const [showControls, setShowControls] = useState(true);

  const [statusOverlay, setStatusOverlay] = useState({ active: false, icon: "play", text: "" });
  const [rippleLeft, setRippleLeft] = useState(false);
  const [rippleRight, setRippleRight] = useState(false);

  const [isHoveringProgress, setIsHoveringProgress] = useState(false);
  const [hoverX, setHoverX] = useState(0);
  const [hoverTime, setHoverTime] = useState(0);
  const [previewVideoEnabled, setPreviewVideoEnabled] = useState(false);
  const previewVideoRef = useRef<HTMLVideoElement>(null);
  const pendingPreviewTimeRef = useRef<number | null>(null);
  const previewSeekInFlightRef = useRef(false);
  const previewLastAppliedTimeRef = useRef<number | null>(null);
  const previewCanPlayRetryHandlerRef = useRef<(() => void) | null>(null);

  const [isLoaderOpen, setIsLoaderOpen] = useState(false);
  const [loaderOnlyPlaylist, setLoaderOnlyPlaylist] = useState(false);
  const [isMediaDetailsOpen, setIsMediaDetailsOpen] = useState(false);
  const [urlInput, setUrlInput] = useState("");
  const [refererInput, setRefererInput] = useState("");

  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isOnlineLoading, setIsOnlineLoading] = useState(false);
  const [isProbingUrl, setIsProbingUrl] = useState(false);
  const [titleOverflows, setTitleOverflows] = useState(false);
  const [onlineLoadingText, setOnlineLoadingText] = useState("Resolving stream...");

  const [streamFormat, setStreamFormat] = useState<string | null>(null);
  const [streamFileSize, setStreamFileSize] = useState<number | null>(null);
  const [streamVideoCodec, setStreamVideoCodec] = useState<string | null>(null);
  const [streamAudioCodec, setStreamAudioCodec] = useState<string | null>(null);
  const [streamDrmKeys, setStreamDrmKeys] = useState<any>(null);
  const streamDrmKeysRef = useRef<any>(null);
  const [streamFps, setStreamFps] = useState<number | null>(null);
  const [streamBitrate, setStreamBitrate] = useState<number | null>(null);
  const [isProbing, setIsProbing] = useState(false);

  const probeCurrentMedia = useCallback(async () => {
    const urlToProbe = videoSrc;
    console.log('[probeCurrentMedia] Started. urlToProbe:', urlToProbe, 'isProbing:', isProbing);
    if (!urlToProbe) {
      console.log('[probeCurrentMedia] Skipped because urlToProbe is empty.');
      return;
    }
    if (isProbing) {
      console.log('[probeCurrentMedia] Skipped because isProbing is true.');
      return;
    }

    // Skip only if we already have real codec data (not placeholder values)
    const hasRealVideoCodec = streamVideoCodec && streamVideoCodec !== 'Unknown';
    const hasRealAudioCodec = streamAudioCodec && streamAudioCodec !== 'Unknown';
    if (hasRealVideoCodec && hasRealAudioCodec && streamFileSize && streamFps && streamBitrate) {
      console.log('[probeCurrentMedia] Skipped because all data is already present.');
      return;
    }

    setIsProbing(true);
    console.log('[probeCurrentMedia] Invoking IPC with urlToProbe:', urlToProbe);
    try {
      const electron = getElectronApi();
      console.log('[probeCurrentMedia] electron API found:', !!electron, 'ipcRenderer:', !!electron?.ipcRenderer);
      const result = await electron?.ipcRenderer?.invoke('probe-current-media', urlToProbe);
      console.log('[probeCurrentMedia] IPC result:', result);
      if (result) {
        if (result.format) setStreamFormat(result.format);
        if (result.videoCodec) setStreamVideoCodec(result.videoCodec);
        if (result.audioCodec) setStreamAudioCodec(result.audioCodec);
        if (result.fileSize) setStreamFileSize(result.fileSize);
        if (result.fps) setStreamFps(result.fps);
        if (result.bitrate) setStreamBitrate(result.bitrate);

        // ── Renderer-side codec fallback ──
        // If the backend probe didn't find codecs, try extracting from hls.js / dash.js
        let needVideoCodec = !result.videoCodec;
        let needAudioCodec = !result.audioCodec;

        if ((needVideoCodec || needAudioCodec) && hlsRef.current) {
          try {
            const levels = hlsRef.current.levels;
            if (levels && levels.length > 0) {
              const currentLevel = hlsRef.current.currentLevel >= 0 ? hlsRef.current.currentLevel : 0;
              const level = levels[currentLevel] || levels[0];
              if (needVideoCodec && level.videoCodec) {
                const vc = level.videoCodec.toLowerCase();
                let friendly = vc;
                if (vc.startsWith('avc1') || vc.startsWith('avc3')) friendly = 'h264';
                else if (vc.startsWith('hvc1') || vc.startsWith('hev1')) friendly = 'hevc';
                else if (vc.startsWith('vp09')) friendly = 'vp9';
                else if (vc.startsWith('av01')) friendly = 'av1';
                setStreamVideoCodec(friendly);
                needVideoCodec = false;
              }
              if (needAudioCodec && level.audioCodec) {
                const ac = level.audioCodec.toLowerCase();
                let friendly = ac;
                if (ac.startsWith('mp4a')) friendly = 'aac';
                else if (ac.startsWith('ac-3')) friendly = 'ac3';
                else if (ac.startsWith('ec-3')) friendly = 'eac3';
                setStreamAudioCodec(friendly);
                needAudioCodec = false;
              }
            }
          } catch (hlsCodecErr) {
            console.warn('[probeCurrentMedia] hls.js codec extraction error:', hlsCodecErr);
          }
        }

        // Try dash.js bitrateInfo
        if ((needVideoCodec || needAudioCodec) && dashRef.current) {
          try {
            const bitrateInfoList = (dashRef.current as any).getBitrateInfoListFor?.('video');
            if (bitrateInfoList && bitrateInfoList.length > 0 && needVideoCodec) {
              const codec = bitrateInfoList[0]?.codec;
              if (codec) {
                const vc = codec.toLowerCase();
                let friendly = vc;
                if (vc.startsWith('avc1') || vc.startsWith('avc3')) friendly = 'h264';
                else if (vc.startsWith('hvc1') || vc.startsWith('hev1')) friendly = 'hevc';
                else if (vc.startsWith('vp09')) friendly = 'vp9';
                else if (vc.startsWith('av01')) friendly = 'av1';
                setStreamVideoCodec(friendly);
              }
            }
            const audioBitrateList = (dashRef.current as any).getBitrateInfoListFor?.('audio');
            if (audioBitrateList && audioBitrateList.length > 0 && needAudioCodec) {
              const codec = audioBitrateList[0]?.codec;
              if (codec) {
                const ac = codec.toLowerCase();
                let friendly = ac;
                if (ac.startsWith('mp4a')) friendly = 'aac';
                else if (ac.startsWith('ac-3')) friendly = 'ac3';
                else if (ac.startsWith('ec-3')) friendly = 'eac3';
                setStreamAudioCodec(friendly);
              }
            }
          } catch (dashCodecErr) {
            console.warn('[probeCurrentMedia] dash.js codec extraction error:', dashCodecErr);
          }
        }
      } else {
        console.warn('[probeCurrentMedia] IPC returned falsy result:', result);
      }
    } catch (err) {
      console.error('[probeCurrentMedia] renderer error:', err);
    } finally {
      setIsProbing(false);
    }
  }, [videoSrc, isProbing, streamVideoCodec, streamAudioCodec, streamFormat, streamFileSize, streamFps, streamBitrate]);

  useEffect(() => {
    if (videoSrc) {
      probeCurrentMedia();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoSrc]);

  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const [isVideoFrozen, setIsVideoFrozen] = useState(false);
  const frozenTimeRef = useRef<number | null>(null);

  const freezeFrame = useCallback(() => {
    const video = videoRef.current;
    const canvas = overlayCanvasRef.current;
    if (video && canvas && video.readyState >= 2) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        canvas.style.transition = 'none';
        canvas.style.opacity = '1';
        setIsVideoFrozen(true);
        frozenTimeRef.current = video.currentTime;
      }
    }
  }, []);

  const unfreezeFrame = useCallback((instant = false) => {
    if (frozenTimeRef.current !== null) {
      const canvas = overlayCanvasRef.current;
      if (canvas) {
        canvas.style.transition = instant ? 'none' : 'opacity 0.15s ease-out';
        canvas.style.opacity = '0';
      }
      setIsVideoFrozen(false);
      frozenTimeRef.current = null;
    }
  }, []);

  const autoPlayPendingRef = useRef(false);
  const audioDriftIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastVideoProgressRef = useRef<{ currentTime: number; timestamp: number } | null>(null);
  const isVideoStalledDetectionRef = useRef<boolean>(false);
  const bufferStallPlaybackRateRef = useRef<number | null>(null);
  const isMutedRef = useRef(false);
  const loadedUrlInputRef = useRef("");
  const pixelDrainRetryUrlsRef = useRef<string[]>([]);
  const driveRetryUrlsRef = useRef<string[]>([]);
  const streamRetryUrlsRef = useRef<string[]>([]);
  const streamLoadGuardTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pixelDrainExtractorFallbackTriedRef = useRef(false);
  const driveExtractorFallbackTriedRef = useRef(false);
  const gofileExtractorFallbackTriedRef = useRef(false);
  const driveProxyRetryUrlRef = useRef<string | null>(null);
  const [previewDisabled, setPreviewDisabled] = useState(false);
  const defaultExtractedSubtitleUrlRef = useRef<string | null>(null);
  const subtitleTimeRafRef = useRef<number | null>(null);
  const playNextEntryRef = useRef<() => void>(() => { });
  const pendingDrmKeysForNextStreamRef = useRef<Record<string, string> | null>(null);

  // ── Download feature state ──
  const [isDownloadOpen, setIsDownloadOpen] = useState(false);
  const [dlTab, setDlTab] = useState<"links" | "audio" | "progress" | "settings">("links");
  const [loaderTab, setLoaderTab] = useState<"local" | "online" | "playlist">("local");
  const [dlSavePath, setDlSavePath] = useState("");
  const [dlProgress, setDlProgress] = useState<Record<string, DownloadInfo>>({});
  const [dlThreads, setDlThreads] = useState(8);
  const [dlProxy, setDlProxy] = useState(() => localStorage.getItem("dl_proxy") || "");
  const dlIdCounterRef = useRef(0);
  const [isCustomPipActive, setIsCustomPipActive] = useState(false);
  const [audioCodecPref, setAudioCodecPref] = useState("m4a");
  const [audioBitratePref, setAudioBitratePref] = useState("best");
  const [deleteConfirm, setDeleteConfirm] = useState<{ dlId: string; filePath?: string } | null>(null);
  const [deadStreamNotify, setDeadStreamNotify] = useState<{ streamName: string; entryId: string } | null>(null);

  // ── Playlist state ──
  const [playlists, setPlaylists] = useState<Playlist[]>(() => {
    try { return JSON.parse(localStorage.getItem('aether_playlists') || '[]'); } catch { return []; }
  });
  const [activePlaylistId, setActivePlaylistId] = useState<string | null>(null);
  const [plSearchQuery, setPlSearchQuery] = useState('');
  const [plGroupFilter, setPlGroupFilter] = useState('all');
  const [plSortMode, setPlSortMode] = useState<'original' | 'az' | 'za' | 'duration'>('original');
  const [plShowFavoritesOnly, setPlShowFavoritesOnly] = useState(false);
  const [plPlayingEntryId, setPlPlayingEntryId] = useState<string | null>(null);
  const [plSkippedEntries, setPlSkippedEntries] = useState<Set<string>>(new Set());
  const [plEditingEntryId, setPlEditingEntryId] = useState<string | null>(null);
  const [plListRenamingId, setPlListRenamingId] = useState<string | null>(null);
  const [plDragOverId, setPlDragOverId] = useState<string | null>(null);
  const [plImportMode, setPlImportMode] = useState(false);
  const [plImportUrl, setPlImportUrl] = useState('');
  const [plRefreshing, setPlRefreshing] = useState(false);
  const plVisibleCountRef = useRef(50);
  const plScrollRef = useRef<HTMLDivElement>(null);
  const plSentinelRef = useRef<HTMLDivElement>(null);
  const [plVisibleCount, setPlVisibleCount] = useState(50);

  // ── TV / Live Streams state ──
  const [isTvOpen, setIsTvOpen] = useState(false);
  const [tvStreams, setTvStreams] = useState<any[]>([]);
  const [tvLoading, setTvLoading] = useState(false);
  const [tvError, setTvError] = useState("");
  const [tvFilter, setTvFilter] = useState<string>("all");
  const tvTickRef = useRef(0);
  const [tvTick, setTvTick] = useState(0);

  const [proxyOrigin, setProxyOrigin] = useState<string>("");

  useEffect(() => {
    localStorage.setItem("dl_proxy", dlProxy);
    const electron = getElectronApi();
    if (electron?.ipcRenderer?.send) {
      electron.ipcRenderer.send("set-downloader-proxy", dlProxy);
    }
  }, [dlProxy]);

  useEffect(() => {
    const electron = getElectronApi();
    if (!electron?.ipcRenderer) return;

    const handleCustomPipState = (_: any, isActive: boolean) => {
      setIsCustomPipActive(isActive);
      if (!isActive) {
        // Force browser relayout after window restores from PiP
        const forceRepaint = () => {
          window.dispatchEvent(new Event('resize'));
          // When paused, Chromium's video compositor doesn't repaint on resize.
          // Nudge currentTime to force a frame redraw.
          const video = videoRef.current;
          if (video && video.paused) {
            video.currentTime = video.currentTime;
          }
        };
        requestAnimationFrame(forceRepaint);
        setTimeout(forceRepaint, 100);
        setTimeout(forceRepaint, 300);
        setTimeout(forceRepaint, 600);
        setTimeout(forceRepaint, 1000);
      }
    };

    electron.ipcRenderer.on('custom-pip-state', handleCustomPipState);
    return () => {
      if (electron.ipcRenderer.removeListener) {
        electron.ipcRenderer.removeListener('custom-pip-state', handleCustomPipState);
      }
    };
  }, []);

  useEffect(() => {
    assModeRef.current = assMode;
  }, [assMode]);

  useEffect(() => {
    assSubtitleContentRef.current = assSubtitleContent;
  }, [assSubtitleContent]);

  useEffect(() => {
    if (isLoaderOpen) {
      // Small delay ensures the modal animation has started and browser is ready to focus
      setTimeout(() => {
        urlInputRef.current?.focus();
        urlInputRef.current?.select();
      }, 50);
    } else {
      // Blur the input when modal closes to restore keyboard shortcuts to the window
      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }
    }
  }, [isLoaderOpen]);

  // ── TV / Live Streams: fetch + auto-refresh countdown ──
  const fetchPpvStreams = useCallback(async () => {
    const electron = getElectronApi();
    if (!electron?.ipcRenderer?.invoke) return;
    setTvLoading(true);
    setTvError("");
    try {
      const result = await electron.ipcRenderer.invoke("fetch-ppv-streams");
      if (result?.success && Array.isArray(result.streams)) {
        setTvStreams(result.streams);
      } else {
        setTvError(result?.error || "Failed to fetch streams");
      }
    } catch (err: any) {
      setTvError(err?.message || "Network error");
    } finally {
      setTvLoading(false);
    }
  }, []);

  // Fetch on mount
  useEffect(() => {
    fetchPpvStreams();
  }, [fetchPpvStreams]);

  // Tick every second while TV popup is open (for countdown timers)
  useEffect(() => {
    if (!isTvOpen) return;
    const id = setInterval(() => {
      tvTickRef.current += 1;
      setTvTick(tvTickRef.current);
    }, 1000);
    return () => clearInterval(id);
  }, [isTvOpen]);

  const isHlsSource = isHlsLikeUrl(videoSrc);
  const isDashSource = isDashLikeUrl(videoSrc);
  const previewVideoSrc = getPreviewMediaSource(videoSrc);
  const isPixelDrainStream = isPixelDrainUrl(videoSrc);
  const isProtectedProxyStream = isProtectedProxyUrl(videoSrc);
  const isAuthenticatedStream =
    isYoutubeStream ||
    isDrivePlaybackLike(videoSrc) ||
    isGofileUrl(videoSrc) ||
    isPixelDrainStream ||
    isProtectedProxyStream;
  const isOnlineVideo = /^https?:\/\//i.test(videoSrc || "");
  const canUseDedicatedPreview = !previewDisabled && !!videoSrc && !isHlsLikeUrl(videoSrc) && !isDashSource && !isAuthenticatedStream && !isOnlineVideo;

  console.log("Initial videoSrc:", videoSrc);
  useEffect(() => {
    if (/drive\.google\.com\/uc\?export=download/i.test(String(videoSrc || "")) && !/drive\.google\.com|googlevideo\.com|driveusercontent\.google\.com/i.test(String(loadedUrlInputRef.current || ""))) {
      console.warn("[RETRY STATE] Non-Google source is currently using a stale Drive fallback URL", {
        loadedUrl: loadedUrlInputRef.current,
        videoSrc,
      });
    }
  }, [videoSrc]);

  useEffect(() => {
    const electron = getElectronApi();
    if (!electron) return;

    const handleProxyReady = (_event: any, origin: string) => {
      console.log("Media proxy ready at:", origin);
      setProxyOrigin(origin);
    };

    electron.ipcRenderer.on("media-proxy-ready", handleProxyReady);

    const handleMediaTranscoded = (_event: any, payload: { url: string; filePath: string; mode: string }) => {
      console.log("[TRANSCODE] Media transcoded successfully", payload);
      setIsOnlineLoading(false);
      if (payload.url) {
        setVideoSrc(payload.url);
        setAudioSrc(null);
        setIsDemuxedLocalFile(true);
        // If transcoded, we know it's H.264
        const newFormat = payload.mode === 'transcode' || payload.mode === 'transcode-fallback' ? 'H264' : format;
        setFormat(newFormat);
        setQualityOptions(prev => prev.map(opt =>
          opt.label === "Default" ? { ...opt, format: newFormat } : opt
        ));
        // Trigger manual load/play if needed as src change might not always trigger it if URL is same
        if (videoRef.current) {
          videoRef.current.load();
          videoRef.current.play().catch(() => { });
        }
      }
    };

    const handleTranscodeError = (_event: any, payload: { message: string }) => {
      console.error("[TRANSCODE] Error:", payload.message);
      setIsOnlineLoading(false);
      setVideoTitle("Transcoding failed: " + payload.message);
    };

    electron.ipcRenderer.on("media-transcoded", handleMediaTranscoded);
    electron.ipcRenderer.on("transcode-error", handleTranscodeError);

    const initDownloadPath = async () => {
      try {
        const path = await electron.ipcRenderer.invoke("get-downloads-path");
        if (path) setDlSavePath(path);
      } catch { }
    };
    void initDownloadPath();

    return () => {
      electron.ipcRenderer.removeListener("media-proxy-ready", handleProxyReady);
      electron.ipcRenderer.removeListener("media-transcoded", handleMediaTranscoded);
      electron.ipcRenderer.removeListener("transcode-error", handleTranscodeError);
    };
  }, []);

  const applyPreviewSeek = useCallback((targetTime?: number) => {
    const preview = previewVideoRef.current;
    if (!preview || !canUseDedicatedPreview) return;

    const nextTime = typeof targetTime === "number" ? targetTime : pendingPreviewTimeRef.current;
    if (typeof nextTime !== "number" || !Number.isFinite(nextTime)) return;

    if (preview.readyState < 2) {
      pendingPreviewTimeRef.current = nextTime;
      if (previewCanPlayRetryHandlerRef.current) {
        preview.removeEventListener("canplay", previewCanPlayRetryHandlerRef.current);
      }
      const onCanPlay = () => {
        preview.removeEventListener("canplay", onCanPlay);
        if (previewCanPlayRetryHandlerRef.current === onCanPlay) {
          previewCanPlayRetryHandlerRef.current = null;
        }
        applyPreviewSeek(nextTime);
      };
      previewCanPlayRetryHandlerRef.current = onCanPlay;
      preview.addEventListener("canplay", onCanPlay, { once: true });
      return;
    }

    if (previewSeekInFlightRef.current) {
      pendingPreviewTimeRef.current = nextTime;
      return;
    }

    const durationSafe = Number.isFinite(preview.duration) && preview.duration > 0;
    const boundedTime = durationSafe
      ? Math.max(0, Math.min(nextTime, preview.duration - 0.05))
      : Math.max(0, nextTime);

    const lastApplied = previewLastAppliedTimeRef.current;
    const minDelta = 0.12;
    if (lastApplied != null && Math.abs(lastApplied - boundedTime) < minDelta) return;

    previewSeekInFlightRef.current = true;
    previewLastAppliedTimeRef.current = boundedTime;
    pendingPreviewTimeRef.current = null;

    try {
      if (typeof (preview as HTMLVideoElement & { fastSeek?: (time: number) => void }).fastSeek === "function") {
        (preview as HTMLVideoElement & { fastSeek?: (time: number) => void }).fastSeek?.(boundedTime);
      } else {
        preview.currentTime = boundedTime;
      }
    } catch {
      previewSeekInFlightRef.current = false;
    }
  }, [canUseDedicatedPreview]);

  const tryAutoPlay = useCallback(() => {
    const video = videoRef.current;
    if (!video || !autoPlayPendingRef.current) return;

    if (video.readyState < 3) {
      const waitAndPlay = () => {
        video.removeEventListener("canplay", waitAndPlay);
        setTimeout(() => {
          if (!autoPlayPendingRef.current) return;
          const playPromise = video.play();
          if (playPromise && typeof playPromise.then === "function") {
            playPromise.then(() => {
              autoPlayPendingRef.current = false;
              setIsPlaying(true);
              if (audioRef.current && audioSrcRef.current) {
                audioRef.current.currentTime = video.currentTime;
                audioRef.current.playbackRate = video.playbackRate;
                audioRef.current.play().catch(() => { });
              }
            }).catch(() => { });
          } else {
            autoPlayPendingRef.current = false;
            setIsPlaying(true);
            if (audioRef.current && audioSrcRef.current) {
              audioRef.current.currentTime = video.currentTime;
              audioRef.current.playbackRate = video.playbackRate;
              audioRef.current.play().catch(() => { });
            }
          }
        }, 400); // 400ms buffer fill delay
      };
      video.addEventListener("canplay", waitAndPlay);
      return;
    }

    const playPromise = video.play();
    if (playPromise && typeof playPromise.then === "function") {
      playPromise
        .then(() => {
          autoPlayPendingRef.current = false;
          setIsPlaying(true);
          if (audioRef.current && audioSrcRef.current) {
            audioRef.current.currentTime = video.currentTime;
            audioRef.current.playbackRate = video.playbackRate;
            audioRef.current.play().catch(() => { });
          }
        })
        .catch(() => { });
    } else {
      autoPlayPendingRef.current = false;
      setIsPlaying(true);
      if (audioRef.current && audioSrcRef.current) {
        audioRef.current.currentTime = video.currentTime;
        audioRef.current.playbackRate = video.playbackRate;
        audioRef.current.play().catch(() => { });
      }
    }
  }, []);

  const retryNextStream = useCallback(
    (title = "Retrying stream...") => {
      const video = videoRef.current;
      if (!video || streamRetryUrlsRef.current.length === 0) return false;

      const currentVideoUrl = video.currentSrc || videoSrc;
      while (streamRetryUrlsRef.current.length > 0) {
        const nextRetryUrl = streamRetryUrlsRef.current.shift();
        if (!nextRetryUrl || nextRetryUrl === currentVideoUrl) continue;

        pendingRetrySeekTimeRef.current = video.currentTime;
        console.log("Saving seek time:", pendingRetrySeekTimeRef.current);
        setVideoSrc(nextRetryUrl);
        setAudioSrc(null);
        setVideoTitle(title);
        autoPlayPendingRef.current = true;
        if (!isHlsLikeUrl(nextRetryUrl) && !isDashLikeUrl(nextRetryUrl)) {
          video.src = nextRetryUrl;
          video.load();
        }
        tryAutoPlay();
        return true;
      }

      return false;
    },
    [tryAutoPlay, videoSrc]
  );

  const fallbackPixeldrainFolderLoad = useCallback(async (rawUrl: string) => {
    const target = parsePixeldrainUrl(rawUrl);
    if (!target || target.type !== 'd_unknown') return false;

    setCurrentFolderId(target.id);
    setIsOnlineLoading(true);
    setOnlineLoadingText('Loading folder...');

    try {
      const response = await fetch(`https://cdn.pixeldrain.eu.cc/proxy-api/filesystem/${target.id}`);
      const data = await response.json();
      const files = extractPixeldrainFilesFromResponse(data);

      console.log('[PIXELDRAIN][FOLDER FALLBACK]', {
        id: target.id,
        fileCount: files.length,
        payloadKeys: data && typeof data === 'object' ? Object.keys(data) : [],
      });

      setFolderFiles(files);
      setFolderName(`Pixeldrain folder: ${target.id}`);
      setSelectedFolder('None');

      if (files.length === 1) {
        setVideoTitle(files[0].name || `pixeldrain-${target.id}`);
        setIsOnlineLoading(false);
        await playFolderFile(target.id, files[0].name);
        return true;
      }

      setVideoTitle(`Folder loaded – ${files.length} files`);
      setIsOnlineLoading(false);
      return true;
    } catch (err) {
      console.error('Failed to load folder fallback', err);
      setVideoTitle('Failed to load folder');
      setIsOnlineLoading(false);
      return false;
    }
  }, []);

  const handleVideoError = useCallback((e?: any) => {
    if (videoRef.current) {
      pendingRetrySeekTimeRef.current = videoRef.current.currentTime;
      console.log("Saving seek time:", pendingRetrySeekTimeRef.current);
    }

    const isFromNativeVideo = e && e.type === 'error';
    if (isFromNativeVideo && (dashRef.current || hlsRef.current)) {
      console.warn("[PLAYER] Ignoring native video error event because MSE player (DASH/HLS) is active and handles its own errors.");
      return;
    }

    const error = videoRef.current?.error;
    const currentVideoUrl = videoRef.current?.currentSrc || videoSrc;
    const driveInputLike = isDrivePlaybackLike(loadedUrlInputRef.current);
    const isPixelDrainInput = isPixelDrainUrl(loadedUrlInputRef.current);

    if (!isPixelDrainInput && retryNextStream("Retrying stream...")) {
      return;
    }

    if (isPixelDrainInput) {
      setIsOnlineLoading(false);
      setVideoTitle("Pixeldrain rate limited or unavailable");
    }

    if (driveInputLike && driveRetryUrlsRef.current.length > 0 && videoRef.current) {
      const nextUrl = driveRetryUrlsRef.current.shift();
      if (nextUrl && nextUrl !== currentVideoUrl) {
        console.warn("[RETRY] Applying Drive retry URL", {
          loadedUrl: loadedUrlInputRef.current,
          currentVideoUrl,
          nextUrl,
        });
        pendingRetrySeekTimeRef.current = videoRef.current.currentTime;
        setVideoSrc(nextUrl);
        setAudioSrc(null);
        setVideoTitle("Retrying Drive stream...");
        autoPlayPendingRef.current = true;
        videoRef.current.src = nextUrl;
        videoRef.current.load();
        tryAutoPlay();
        return;
      }
    }

    if (driveProxyRetryUrlRef.current && driveProxyRetryUrlRef.current !== currentVideoUrl && videoRef.current) {
      const retryUrl = driveProxyRetryUrlRef.current;
      console.warn("[RETRY] Applying proxy fallback URL", {
        loadedUrl: loadedUrlInputRef.current,
        currentVideoUrl,
        retryUrl,
      });
      driveProxyRetryUrlRef.current = null;
      pendingRetrySeekTimeRef.current = videoRef.current.currentTime;
      setVideoSrc(retryUrl);
      setAudioSrc(null);
      setVideoTitle("Retrying stream...");
      autoPlayPendingRef.current = true;
      videoRef.current.src = retryUrl;
      videoRef.current.load();
      tryAutoPlay();
      return;
    }

    const pixelDrainParsedForFallback = parsePixeldrainUrl(loadedUrlInputRef.current);
    const pixelDrainFolderId = pixelDrainParsedForFallback?.type === 'd_unknown' ? pixelDrainParsedForFallback.id : null;
    if (pixelDrainFolderId && !pixelDrainExtractorFallbackTriedRef.current) {
      pixelDrainExtractorFallbackTriedRef.current = true;
      setFolderFiles([]);
      setSelectedFolder("None");
      setVideoTitle("Direct file unavailable — trying folder...");
      setVideoSrc("");
      setAudioSrc(null);
      setIsPlaying(false);
      if (videoRef.current) {
        videoRef.current.pause();
        videoRef.current.removeAttribute("src");
        videoRef.current.load();
      }

      void fallbackPixeldrainFolderLoad(loadedUrlInputRef.current);
      return;
    }

    if (driveInputLike && !driveExtractorFallbackTriedRef.current) {
      const electron = getElectronApi();
      if (electron) {
        if (videoRef.current) {
          pendingRetrySeekTimeRef.current = videoRef.current.currentTime;
        }
        driveExtractorFallbackTriedRef.current = true;
        setVideoTitle("Trying Drive fallback...");
        electron.ipcRenderer.send("fetch-online-video", loadedUrlInputRef.current);
        return;
      }
    }

    if (isGofileUrl(loadedUrlInputRef.current) && !gofileExtractorFallbackTriedRef.current && folderFiles.length === 0) {
      const electron = getElectronApi();
      if (electron) {
        if (videoRef.current) {
          pendingRetrySeekTimeRef.current = videoRef.current.currentTime;
        }
        gofileExtractorFallbackTriedRef.current = true;
        setVideoTitle("Trying GoFile fallback...");
        electron.ipcRenderer.send("fetch-online-video", loadedUrlInputRef.current);
        return;
      }
    }

    if (error && error.code === 4) {
      const electron = getElectronApi();
      const currentFile = fileInputRef.current?.files?.[0] as any;
      const filePath = currentLocalFilePath || (currentFile && currentFile.path);
      if (electron && filePath) {
        console.log("[PLAYER] Native playback failed (error 4). Requesting transcoding for:", filePath);
        setOnlineLoadingText("Transcoding unsupported format...");
        setIsOnlineLoading(true);
        electron.ipcRenderer.send("request-media-transcode", filePath);
      }
    }

    // Playlist auto-skip: if playing a playlist entry and all retries exhausted, skip to next
    if (plPlayingEntryId && activePlaylistId) {
      console.warn('[PLAYLIST] Playback error — auto-skipping to next entry');
      setPlSkippedEntries(prev => new Set(prev).add(plPlayingEntryId));

      const pl = playlists.find(p => p.id === activePlaylistId);
      const entry = pl?.entries.find(e => e.id === plPlayingEntryId);
      setDeadStreamNotify({ streamName: entry?.name || "Unknown Stream", entryId: plPlayingEntryId });

      setIsOnlineLoading(false);
      return;
    }

    setIsOnlineLoading(false);
  }, [retryNextStream, tryAutoPlay, videoSrc, fallbackPixeldrainFolderLoad, plPlayingEntryId, activePlaylistId]);

  const handleVideoErrorRef = useRef(handleVideoError);
  useEffect(() => {
    handleVideoErrorRef.current = handleVideoError;
  }, [handleVideoError]);

  const stableHandleVideoError = useCallback((e?: any) => {
    return handleVideoErrorRef.current(e);
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }
    if (dashRef.current) {
      dashRef.current.reset();
      dashRef.current = null;
    }

    // NOTE: Do NOT reset preserveQualityOptionsRef here — this effect fires on
    // every videoSrc change (including quality switches within the same stream).
    // The flag is managed by handleStreamReady (sets true/false based on quality
    // count) and the quality-switch re-resolve path (clears before full re-fetch).

    if (!videoSrc) return;

    if (isDashSource) {
      if (typeof dashjs !== 'undefined' && dashjs.supportsMediaSource()) {
        const dashPlayer = dashjs.MediaPlayer().create();
        dashPlayer.updateSettings({
          debug: { logLevel: dashjs.Debug.LOG_LEVEL_DEBUG },
          streaming: {
            buffer: {
              bufferTimeDefault: 30,
              bufferTimeAtTopQuality: 30,
              bufferTimeAtTopQualityLongForm: 30,
              longFormContentDurationThreshold: 300
            }
          }
        });

        // Explicitly test ClearKey access
        navigator.requestMediaKeySystemAccess('org.w3.clearkey', [{
          initDataTypes: ['cenc'],
          videoCapabilities: [{ contentType: 'video/mp4; codecs="avc1.64001F"' }],
          audioCapabilities: [{ contentType: 'audio/mp4; codecs="mp4a.40.2"' }]
        }]).then(() => console.log('[EME-TEST] ClearKey IS natively supported by this Electron build'))
          .catch(e => console.error('[EME-TEST] ClearKey IS REJECTED by Electron:', e));

        if (streamDrmKeysRef.current) {
          // Shaka often receives hex strings (e.g. from kickbd). dash.js requires base64url.
          const formattedKeys: Record<string, string> = {};
          const hexToBase64Url = (hex: string) => {
            const bytes = new Uint8Array(hex.match(/.{1,2}/g)?.map(byte => parseInt(byte, 16)) || []);
            let binary = '';
            for (let i = 0; i < bytes.byteLength; i++) {
              binary += String.fromCharCode(bytes[i]);
            }
            return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
          };

          for (const [k, v] of Object.entries(streamDrmKeysRef.current)) {
            const keyStr = String(k);
            const valStr = String(v);
            const isHex = (s: string) => /^[0-9a-fA-F]{32}$/i.test(s);
            const kId = isHex(keyStr) ? hexToBase64Url(keyStr) : keyStr;
            const kVal = isHex(valStr) ? hexToBase64Url(valStr) : valStr;
            formattedKeys[kId] = kVal;
          }

          console.log('[NATIVE-EME] Starting ClearKey EME override with keys:', formattedKeys);

          // Override requestMediaKeySystemAccess so dash.js's Widevine/PlayReady
          // attempts get transparently redirected to ClearKey
          const origRMKSA = navigator.requestMediaKeySystemAccess.bind(navigator);
          let clearKeyLoggedOnce = false;
          (navigator as any).requestMediaKeySystemAccess = (keySystem: string, configs: any[]) => {
            // Always intercept, even for org.w3.clearkey, because we need to override
            // generateRequest to rewrite 'cenc' to 'keyids' for Chromium's CDM.

            // Always redirect non-ClearKey DRM probes to ClearKey.
            // dash.js's CapabilitiesFilter calls this once per codec profile
            // (e.g. avc1.64001E for 480p, avc1.640028 for 1080p). Rejecting
            // any of these causes that quality level to be stripped entirely.
            if (!clearKeyLoggedOnce) {
              console.log(`[EME-OVERRIDE] Redirecting ${keySystem} → org.w3.clearkey`);
              clearKeyLoggedOnce = true;
            }

            const clearKeyConfigs = configs.map(c => {
              const newConfig = { ...c };
              if (!newConfig.initDataTypes) newConfig.initDataTypes = [];
              if (!newConfig.initDataTypes.includes('keyids')) newConfig.initDataTypes.push('keyids');
              if (!newConfig.initDataTypes.includes('cenc')) newConfig.initDataTypes.push('cenc');

              // Remove proprietary DRM specific settings that ClearKey won't understand
              delete newConfig.robustness;
              if (newConfig.videoCapabilities) {
                newConfig.videoCapabilities = newConfig.videoCapabilities.map((vc: any) => {
                  const newVc = { ...vc };
                  delete newVc.robustness;
                  return newVc;
                });
              }
              if (newConfig.audioCapabilities) {
                newConfig.audioCapabilities = newConfig.audioCapabilities.map((ac: any) => {
                  const newAc = { ...ac };
                  delete newAc.robustness;
                  return newAc;
                });
              }
              return newConfig;
            });

            return origRMKSA('org.w3.clearkey', clearKeyConfigs).then((access: any) => {
              // Wrap createMediaKeys to intercept session creation
              const origCreateMK = access.createMediaKeys.bind(access);
              return {
                keySystem: access.keySystem,
                getConfiguration: access.getConfiguration.bind(access),
                createMediaKeys: () => origCreateMK().then((mediaKeys: any) => {
                  const origCreateSession = mediaKeys.createSession.bind(mediaKeys);
                  mediaKeys.createSession = (sessionType?: string) => {
                    const session = origCreateSession(sessionType || 'temporary');

                    // Override generateRequest to use keyids instead of cenc PSSH
                    const origGR = session.generateRequest.bind(session);
                    session.generateRequest = (initDataType: string, initData: any) => {
                      if (initDataType === 'cenc') {
                        console.log('[EME-OVERRIDE] Redirecting generateRequest cenc → keyids');
                        const keyIdsPayload = new TextEncoder().encode(
                          JSON.stringify({ kids: Object.keys(formattedKeys) })
                        );
                        return origGR('keyids', keyIdsPayload);
                      }
                      return origGR(initDataType, initData);
                    };

                    return session;
                  };
                  return mediaKeys;
                })
              };
            });
          };
        }
        if (Object.keys(streamDrmKeysRef.current || {}).length > 0) {
          const clearkeys: Record<string, string> = {};
          const isHex = (s: string) => /^[0-9a-fA-F]{32}$/i.test(s);
          const hexToBase64Url = (hex: string) => {
            const bytes = new Uint8Array(hex.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16)));
            const binary = Array.from(bytes).map(b => String.fromCharCode(b)).join('');
            return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
          };
          for (const [k, v] of Object.entries(streamDrmKeysRef.current)) {
            const kId = isHex(String(k)) ? hexToBase64Url(String(k)) : String(k);
            const kVal = isHex(String(v)) ? hexToBase64Url(String(v)) : String(v);
            clearkeys[kId] = kVal;
          }
          dashPlayer.setProtectionData({
            "org.w3.clearkey": {
              clearkeys: clearkeys
            }
          });
          console.log('[DASH] Configured native setProtectionData for ClearKey', clearkeys);
        }

        dashPlayer.initialize(video, videoSrc, autoPlayPendingRef.current);
        dashRef.current = dashPlayer;
        let dashQualitiesRetryCount = 0;
        const updateDashQualities = () => {
          try {
            const bitrates = typeof (dashPlayer as any).getRepresentationsByType === 'function'
              ? (dashPlayer as any).getRepresentationsByType('video')
              : (dashPlayer as any).getBitrateInfoListFor?.('video');
            if (bitrates && bitrates.length > 0) {
              const nativeLevelOptions = bitrates.map((b: any, index: number) => {
                const height = b.height;
                const bitrate = b.bandwidth || b.bitrate;
                const stableIndex = b.qualityIndex !== undefined ? b.qualityIndex : index;
                return {
                  label: height > 0 ? `${height}p` : `Level ${index}`,
                  value: String(stableIndex),
                  isNativeDashLevel: true,
                  levelIndex: stableIndex,
                  height,
                  bitrate
                };
              }).sort((a: any, b: any) => (b.height || 0) - (a.height || 0) || (b.bitrate || 0) - (a.bitrate || 0));

              if (!preserveQualityOptionsRef.current) {
                if (nativeLevelOptions.length > 1) {
                  setQualityOptions([
                    { label: 'Auto', value: '-1', isNativeDashLevel: true, levelIndex: -1 },
                    ...nativeLevelOptions
                  ] as any);
                  // Only set quality label if we haven't already selected a specific level, or if the selected level is invalid
                  const currentExists = nativeLevelOptions.some((opt: any) => opt.value === selectedQualityValueRef.current);
                  if (!currentExists || selectedQualityValueRef.current === null || selectedQualityValueRef.current === '-1' || selectedQualityValueRef.current === 'Default') {
                    console.log(`[DASH-QUALITY] Resetting to Auto because currentExists=${currentExists}, selectedValue=${selectedQualityValueRef.current}`);
                    setQuality('Auto');
                    selectedQualityValueRef.current = '-1';
                  } else {
                    console.log(`[DASH-QUALITY] Retaining selected quality: ${selectedQualityValueRef.current}`);
                  }
                }
              }
            } else {
              if (dashQualitiesRetryCount < 20) {
                dashQualitiesRetryCount++;
                setTimeout(updateDashQualities, 500);
              }
            }
          } catch (e) {
            console.warn('[DASH] Failed to extract qualities:', e);
          }
        };

        dashPlayer.on(dashjs.MediaPlayer.events.STREAM_INITIALIZED, () => {
          if (dashPlayer.isDynamic()) setIsYoutubeLive(true);
          updateDashQualities();
        });
        dashPlayer.on(dashjs.MediaPlayer.events.PLAYBACK_METADATA_LOADED, updateDashQualities);
        dashPlayer.on(dashjs.MediaPlayer.events.ERROR, (e: any) => {
          console.warn('[DASH] Playback error emitted by dash.js:', e);
          const errObj = e?.error;
          const code = errObj?.code;
          const message = String(errObj?.message || errObj || '').toLowerCase();

          // Only trigger dead stream fallback for critical manifest or network failures that stop playback
          if (code === 27 /* manifestError */ || code === 31 /* mediasource */ || message.includes('manifest') || message.includes('fatal')) {
            if (videoRef.current && videoRef.current.paused) {
              console.error('[DASH] Fatal error detected, triggering fallback.');
              handleVideoError();
            }
          }
        });
        dashPlayer.on(dashjs.MediaPlayer.events.BUFFER_EMPTY, () => {
          setOnlineLoadingText("");
          setIsOnlineLoading(true);
          // In DASH, audio and video share the same <video> element via MSE, but
          // the audio buffer fills much faster due to its lower bitrate. If video runs dry,
          // Chromium keeps playing the audio ahead by several seconds, desynchronizing the
          // visual frame and the playhead time. We set playbackRate to 0 to perfectly freeze it.
          if (videoRef.current && bufferStallPlaybackRateRef.current === null) {
            bufferStallPlaybackRateRef.current = videoRef.current.playbackRate;
            videoRef.current.playbackRate = 0;
          }
        });
        dashPlayer.on(dashjs.MediaPlayer.events.BUFFER_LOADED, () => {
          // Don't hide the spinner while a YouTube quality switch is still pending —
          // the onPlaying handler will clear it once the video actually starts rendering.
          if (!youtubeQualitySwitchPendingRef.current) {
            setIsOnlineLoading(false);
          }
          // Restore playback rate after buffer stall recovery
          if (videoRef.current && bufferStallPlaybackRateRef.current !== null) {
            videoRef.current.playbackRate = bufferStallPlaybackRateRef.current;
            bufferStallPlaybackRateRef.current = null;
          }
        });
      } else {
        setVideoTitle("DASH is not supported (dash.js not loaded)");
      }
      return;
    }

    if (isHlsSource) {
      const nativeHlsSupport = video.canPlayType("application/vnd.apple.mpegurl");
      const hlsJsSupported = typeof Hls !== "undefined" && Hls.isSupported();

      console.log("[HLS] Source detected", {
        url: videoSrc,
        nativeHlsSupport,
        hlsJsSupported
      });

      if (hlsJsSupported) {
        const hls = new Hls({
          enableWorker: true,
          lowLatencyMode: false,
          backBufferLength: 30,
          maxBufferLength: 30,
          maxMaxBufferLength: 60,
          maxBufferSize: 60 * 1000 * 1000,
          fragLoadingTimeOut: 20000,
          manifestLoadingTimeOut: 15000,
          fragLoadingRetryDelay: 500,
          manifestLoadingRetryDelay: 500,
          levelLoadingRetryDelay: 500,
          // Strict Audio/Video Sync settings for Live IPTV streams
          maxAudioFramesDrift: 1,
          stretchShortVideoTrack: true,
          liveSyncDurationCount: 3,
          liveMaxLatencyDurationCount: 10,
          capLevelToPlayerSize: true,
        });
        hlsRef.current = hls;
        hls.loadSource(videoSrc);
        hls.attachMedia(video);
        hls.on(Hls.Events.MANIFEST_PARSED, (_event: any, data: any) => {
          try {
            const levels = Array.isArray(hls.levels) ? hls.levels : [];
            const summarizedLevels = levels.map((level: any) => ({
              height: level?.height || 0,
              width: level?.width || 0,
              videoCodec: String(level?.videoCodec || level?.codecSet || ""),
              audioCodec: String(level?.audioCodec || "")
            }));
            console.log("[HLS] Manifest parsed:", summarizedLevels);

            const nativeLevelOptions = (Array.isArray(data?.levels) ? data.levels : levels)
              .map((level: any, index: number) => {
                const height = Number(level?.height || 0);
                const bitrate = Number(level?.bitrate || 0);
                return {
                  label: height > 0 ? `${height}p` : `Level ${index}`,
                  value: String(index),
                  isNativeHlsLevel: true,
                  levelIndex: index,
                  height,
                  bitrate
                };
              })
              .sort((left: { height?: number; bitrate?: number }, right: { height?: number; bitrate?: number }) => {
                const heightDiff = Number(right.height || 0) - Number(left.height || 0);
                if (heightDiff !== 0) return heightDiff;
                return Number(right.bitrate || 0) - Number(left.bitrate || 0);
              });

            if (nativeLevelOptions.length > 0) {
              // If we already have quality options from the main process, do NOT replace them.
              // This is critical for Pornhub where Playwright extracts separate single-level manifests.
              if (preserveQualityOptionsRef.current) {
                const currentOption = qualityOptions.find(opt => opt.value === videoSrc);
                if (currentOption) {
                  setQuality(currentOption.label);
                  selectedQualityValueRef.current = currentOption.value;
                }
              } else if (nativeLevelOptions.length > 1) {
                setQualityOptions([
                  { label: 'Auto', value: '-1', isNativeHlsLevel: true, levelIndex: -1 },
                  ...nativeLevelOptions
                ] as any);
                setQuality('Auto');
                selectedQualityValueRef.current = '-1';
              }
            }

            const hasLevels = summarizedLevels.length > 0;
            const av1Only = hasLevels && summarizedLevels.every((level) => /\bav01\b|\bav1\b/i.test(level.videoCodec || ""));
            const mediaSourceApi = (window as any).MediaSource;
            const av1Playable = !av1Only || summarizedLevels.some((level) => {
              const videoCodec = String(level.videoCodec || "").trim();
              const audioCodec = String(level.audioCodec || "").trim();
              if (!videoCodec || !mediaSourceApi?.isTypeSupported) return false;
              const codecList = [videoCodec, audioCodec].filter(Boolean).join(",");
              return mediaSourceApi.isTypeSupported(`video/mp4; codecs="${codecList}"`);
            });

            if (av1Only && !av1Playable) {
              console.error("[HLS] AV1-only stream is not supported by the current Electron/Chromium media stack.", summarizedLevels);
              setIsOnlineLoading(false);
              setVideoTitle("This HLS stream is AV1-only and is not supported by the current Electron build");
              hls.destroy();
              hlsRef.current = null;
              return;
            }
          } catch (error) {
            console.warn("[HLS] Failed to inspect manifest codecs:", error);
          }

          tryAutoPlay();
        });

        hls.on(Hls.Events.BUFFER_CODECS, (_event: any, data: any) => {
          if (data?.video?.codec || data?.video?.name) {
            const vc = String(data.video.codec || data.video.name).toLowerCase();
            let friendly = vc;
            if (vc.startsWith('avc1') || vc.startsWith('avc3') || vc.startsWith('h264')) friendly = 'h264';
            else if (vc.startsWith('hvc1') || vc.startsWith('hev1') || vc.startsWith('hevc')) friendly = 'hevc';
            else if (vc.startsWith('vp09') || vc.startsWith('vp9')) friendly = 'vp9';
            else if (vc.startsWith('av01') || vc.startsWith('av1')) friendly = 'av1';
            setStreamVideoCodec(prev => (prev === 'Unknown' || !prev) ? friendly : prev);
          }
          if (data?.audio?.codec || data?.audio?.name) {
            const ac = String(data.audio.codec || data.audio.name).toLowerCase();
            let friendly = ac;
            if (ac.startsWith('mp4a') || ac.startsWith('aac')) friendly = 'aac';
            else if (ac.startsWith('ac-3') || ac.startsWith('ac3')) friendly = 'ac3';
            else if (ac.startsWith('ec-3') || ac.startsWith('eac3')) friendly = 'eac3';
            else if (ac.startsWith('opus')) friendly = 'opus';
            else if (ac.startsWith('flac')) friendly = 'flac';
            setStreamAudioCodec(prev => (prev === 'Default' || !prev) ? friendly : prev);
          }
        });

        hls.on(Hls.Events.FRAG_BUFFERED, () => {
          if (!youtubeQualitySwitchPendingRef.current) {
            setIsOnlineLoading(false);
          }

          // Auto-kickstart HLS streams (especially live) that stall on the first frame despite having a buffer
          if (video && video.buffered.length > 0) {
            const bufferedStart = video.buffered.start(0);

            // If the video is playing but stuck before or exactly at the start of the buffer, bump it
            if (!video.paused && (video.currentTime === 0 || video.currentTime < bufferedStart)) {
              console.log("[HLS] Kickstarting stuck stream...", { currentTime: video.currentTime, bufferedStart });
              video.currentTime = bufferedStart + 0.1;
            }
          }
        });

        hls.on(Hls.Events.LEVEL_SWITCHING, (_event: any, data: any) => {
          try {
            const level = hls.levels?.[data.level];
            if (level && level.bitrate) {
              setStreamBitrate(level.bitrate);
            }
          } catch (err) { }
        });

        hls.on(Hls.Events.LEVEL_LOADED, (_event: any, data: any) => {
          if (data.details && data.details.live) {
            setIsYoutubeLive(true);
          }
        });

        let mediaErrorRecoveryAttempts = 0;

        hls.on(Hls.Events.ERROR, (_event: string, data: any) => {
          if (data.details === 'bufferStalledError') {
            setIsOnlineLoading(true);
            setOnlineLoadingText('');
            if (stallRecoveryTimerRef.current) {
              clearTimeout(stallRecoveryTimerRef.current);
              stallRecoveryTimerRef.current = null;
            }
            if (video && video.buffered.length > 0 && !video.paused) {
              video.currentTime += 0.2;
            }
            return;
          }

          console.error('[HLS] Error:', {
            type: data?.type,
            details: data?.details,
            fatal: !!data?.fatal,
            error: data?.error?.message ?? data?.error ?? null,
          });

          if (!data?.fatal) {
            if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
              hls.recoverMediaError();
            }
            return;
          }

          if (data.type === Hls.ErrorTypes.MEDIA_ERROR && mediaErrorRecoveryAttempts < 2) {
            mediaErrorRecoveryAttempts++;
            console.warn('[HLS] Fatal media error, recovery attempt', mediaErrorRecoveryAttempts);
            hls.recoverMediaError();
            return;
          }

          let friendlyError = "Stream connection failed";
          if (data?.details) {
            const d = String(data.details);
            if (d.includes('manifestLoadError')) friendlyError = "Stream access denied";
            else if (d.includes('manifestLoadTimeOut')) friendlyError = "Stream connection timed out";
            else if (d.includes('manifestParsingError')) friendlyError = "Stream data is invalid or corrupt";
            else if (d.includes('fragLoad')) friendlyError = "Stream segment failed to load";
            else if (d.includes('bufferStalled')) friendlyError = "Stream playback stalled";
            else friendlyError = "Stream may be dead";
          }
          setVideoTitle(friendlyError);
              stableHandleVideoError();
        });
      } else if (nativeHlsSupport) {
        console.log("[HLS] Falling back to native media element HLS playback");
        video.src = videoSrc;
      } else {
        setVideoTitle("HLS stream is not supported on this device");
      }
      return;
    }

    video.src = videoSrc;
  }, [videoSrc, isHlsSource, isDashSource, tryAutoPlay, stableHandleVideoError]);

  const handleMinimize = () => {
    const electron = getElectronApi();
    if (electron) electron.ipcRenderer.send("window-minimize");
  };

  const handleMaximize = () => {
    const electron = getElectronApi();
    if (electron) electron.ipcRenderer.send("window-maximize");
  };

  const handleClose = () => {
    const electron = getElectronApi();
    if (electron) electron.ipcRenderer.send("window-close");
  };

  const applyDemuxTrackState = useCallback((tracks: any) => {
    if (!tracks || tracks.error) return;

    console.log("[DEMUX UI] applyDemuxTrackState:input", tracks);

    const audioTracks = Array.isArray(tracks.audio)
      ? tracks.audio.map((track: any) => {
        const rawLabel = String(track.title || `Audio Track ${track.trackNumber || track.index}`);
        return {
          index: Number(track.index),
          id: String(track.index),
          label: formatTrackLabel(rawLabel, track.language),
          badge: deriveLocalAudioBadge(track, rawLabel),
          title: buildLocalTrackTitle(rawLabel, track.language),
        };
      })
      : [];

    const subtitleTracks = Array.isArray(tracks.subtitles)
      ? tracks.subtitles.map((track: any) => {
        const rawLabel = String(track.title || `Subtitle ${track.trackNumber || track.index}`);
        return {
          index: Number(track.index),
          id: String(track.index),
          label: formatTrackLabel(rawLabel, track.language),
          badge: deriveLocalSubtitleBadge(track, rawLabel),
          title: buildLocalTrackTitle(rawLabel, track.language),
        };
      })
      : [];

    setAvailableAudioTracks(audioTracks);
    setAvailableTextTracks(subtitleTracks);

    // Update video format badge
    const videoTracks = Array.isArray(tracks.video) ? tracks.video : [];
    if (videoTracks.length > 0) {
      const currentVideoIndex = tracks.current?.video;
      const currentVideo = videoTracks.find((t: any) => t.index === currentVideoIndex) || videoTracks[0];
      const codec = String(currentVideo.codec || "").toLowerCase();
      let formatLabel = "UND";
      if (codec.includes("h264") || codec.includes("avc")) formatLabel = "AVC";
      else if (codec.includes("hevc") || codec.includes("h265")) formatLabel = "HEVC";
      else if (codec.includes("vp9")) formatLabel = "VP9";
      else if (codec.includes("vp8")) formatLabel = "VP8";
      else if (codec.includes("av1")) formatLabel = "AV1";
      else if (codec.includes("mpeg")) formatLabel = "MPG";
      else if (codec !== "unknown") formatLabel = codec.toUpperCase();

      setFormat(formatLabel);
      setQualityOptions(prev => {
        if (prev.length === 0) return [{ label: "Default", value: "Default", format: formatLabel }];
        // If there's only one item, it's likely the "Default" or res-based one, update its format
        if (prev.length === 1) return [{ ...prev[0], format: formatLabel }];
        // Fallback: update any item that matches Default or undefined
        return prev.map(opt =>
          (opt.label === "Default" || opt.label === "undefined") ? { ...opt, format: formatLabel } : opt
        );
      });

      // Populate stream info fields for the Info modal
      setStreamVideoCodec(codec || null);
      if (currentVideo.fps) {
        setStreamFps(currentVideo.fps);
      } else if (currentVideo.r_frame_rate) {
        const fpsRaw = String(currentVideo.r_frame_rate);
        const fpsParts = fpsRaw.split('/');
        if (fpsParts.length === 2 && parseInt(fpsParts[1], 10) > 0) {
          setStreamFps(Math.round((parseInt(fpsParts[0], 10) / parseInt(fpsParts[1], 10)) * 100) / 100);
        } else {
          setStreamFps(parseFloat(fpsRaw) || null);
        }
      }
    }

    // Set audio codec from the current audio track
    const allAudioTracks = Array.isArray(tracks.audio) ? tracks.audio : [];
    const currentAudioForCodec = allAudioTracks.find((t: any) => t.index === tracks.current?.audio) || allAudioTracks[0];
    if (currentAudioForCodec?.codec) {
      setStreamAudioCodec(String(currentAudioForCodec.codec).toLowerCase());
    }

    const currentAudio = audioTracks.find((track: { id: string; label: string; index: number; title?: string | null }) => track.index === tracks.current?.audio);
    if (currentAudio) {
      setAudioTrack(currentAudio.title || currentAudio.label);
      setSelectedAudioTrackId(currentAudio.id);
    }

    const currentSubtitle = subtitleTracks.find((track: { id: string; label: string; index: number; title?: string | null }) => track.index === tracks.current?.subtitle);
    if (currentSubtitle) {
      setSelectedSubtitleLabel(currentSubtitle.title || currentSubtitle.label);
      setSelectedSubtitleId(`embedded:${currentSubtitle.id}:${currentSubtitle.index}`);
      setCaption(currentSubtitle.title || currentSubtitle.label);
      setDemuxSubtitleActive(true);
    } else {
      setDemuxSubtitleActive(false);
      setSelectedSubtitleLabel("Off");
      setSelectedSubtitleId("off");
      setCaption("Off");
    }
  }, []);

  const loadDemuxedSubtitleText = useCallback(async (force = false) => {
    const electron = getElectronApi();
    if (!electron?.ipcRenderer?.invoke || (!isDemuxedLocalFile && !force)) return;

    try {
      const subtitleResult = await electron.ipcRenderer.invoke("demux:getSubtitles");
      if (!subtitleResult || subtitleResult.error) return;
      if (!subtitleResult.supported) {
        setSubtitles([]);
        setEmbeddedSubtitleText(subtitleResult.reason || "");
        setDemuxSubtitleActive(false);
        return;
      }

      const rawSubtitleText = String(subtitleResult.text || "").replace(/\uFEFF/g, "");
      const trackIndex = subtitleResult.subtitleIndex;
      const isAss = isAssSubtitleContent(rawSubtitleText);

      if (isAss) {
        console.log("[ASS] Embedded subtitle");
        setSubtitles([]);
        setEmbeddedSubtitleText("");
        setCaption("Demux");
        setDemuxSubtitleActive(true);
        setAssSourceFromText(rawSubtitleText, "Embedded ASS subtitle detected");
        if (trackIndex != null) {
          subtitleCacheRef.current.set(trackIndex, { rawText: rawSubtitleText, cues: [], isAss: true });
        }
        return;
      }

      disableAssMode();
      const subtitleText = rawSubtitleText
        .replace(/\{\\[^}]*\}/g, "")
        .replace(/\\N/g, "\n")
        .replace(/\\n/g, "\n");
      const cues = parseSubtitles(subtitleText);
      setSubtitles(cues);
      setEmbeddedSubtitleText("");
      if (cues.length > 0) {
        setCaption("Demux");
        setDemuxSubtitleActive(true);
      } else {
        setCaption("Off");
        setDemuxSubtitleActive(false);
      }
      if (trackIndex != null) {
        subtitleCacheRef.current.set(trackIndex, { rawText: rawSubtitleText, cues, isAss: false });
      }
    } catch {
      // Best-effort subtitle loading only.
    }
  }, [isDemuxedLocalFile]);

  const remuxLocalPlaybackWithTracks = useCallback(async (payload: { audioIndex?: number | null; subtitleIndex?: number | null; currentTime?: number }) => {
    const electron = getElectronApi();
    if (!electron?.ipcRenderer?.invoke || !currentLocalFilePath) return;

    const currentTime = Number(payload.currentTime || 0);
    const wasPlaying = autoPlayPendingRef.current || (!!videoRef.current && !videoRef.current.paused && !videoRef.current.ended);

    try {
      console.log("[DEMUX UI] remuxLocalPlaybackWithTracks:start", { payload, currentLocalFilePath, currentTime, wasPlaying });
      setIsOnlineLoading(true);
      setOnlineLoadingText("Switching tracks...");
      setIsDemuxedLocalFile(true);
      setCurrentLocalFilePath((prev) => prev || currentLocalFilePath);

      const trackResult = await electron.ipcRenderer.invoke("demux:setTracks", {
        audioIndex: payload.audioIndex,
        subtitleIndex: payload.subtitleIndex,
      });

      console.log("[DEMUX UI] remuxLocalPlaybackWithTracks:setTracks", trackResult);

      if (trackResult?.error) {
        console.error("[DEMUX UI] remuxLocalPlaybackWithTracks:setTracks:error", trackResult.error);
        setIsOnlineLoading(false);
        return;
      }

      applyDemuxTrackState(trackResult);

      const remuxResult = await electron.ipcRenderer.invoke("demux:remuxForPlayback", {
        filePath: currentLocalFilePath,
        time: currentTime,
      });

      console.log("[DEMUX UI] remuxLocalPlaybackWithTracks:remux", remuxResult);

      if (!remuxResult || remuxResult.error || !remuxResult.url) {
        console.error("[DEMUX UI] remuxLocalPlaybackWithTracks:remux:error", remuxResult?.error || "missing-url");
        setIsOnlineLoading(false);
        return;
      }

      // If remuxer used -ss, the new file starts at 0. If direct mode, use currentTime.
      pendingRetrySeekTimeRef.current = (remuxResult.mode !== 'direct' && remuxResult.startedAt > 0) ? 0 : currentTime;
      autoPlayPendingRef.current = wasPlaying;
      setIsDemuxedLocalFile(true);
      setVideoSrc(remuxResult.url);
      setAudioSrc(remuxResult.audioUrl || null);

      await loadDemuxedSubtitleText(true);

      // If the video URL is identical (same file, just switching audio tracks),
      // onLoadedMetadata won't fire. We must manually start the audio element.
      if (videoRef.current && videoSrc === remuxResult.url) {
        // Wait a tick for React to mount the new <audio> element
        await new Promise(r => setTimeout(r, 100));
        const audio = audioRef.current;
        const video = videoRef.current;
        if (audio && remuxResult.audioUrl) {
          audio.currentTime = video.currentTime;
          audio.volume = video.volume;
          audio.playbackRate = video.playbackRate;
          if (wasPlaying || !video.paused) {
            audio.play().catch(() => { });
          }
        }
        if (wasPlaying && video.paused) {
          video.play().catch(() => { });
        }
      }
    } catch (error) {
      console.error("[DEMUX] remuxLocalPlaybackWithTracks:error", error);
      throw error;
    } finally {
      setIsOnlineLoading(false);
    }
  }, [applyDemuxTrackState, currentLocalFilePath, loadDemuxedSubtitleText, tryAutoPlay]);

  const resetTrackUiState = useCallback(() => {
    defaultExtractedSubtitleUrlRef.current = null;
    animeAudioTrackMapRef.current = {};
    subtitleCacheRef.current.clear();
    setAvailableAudioTracks([]);
    setAvailableTextTracks([]);
    setSubtitles([]);
    setCaption("Off");
    setSelectedSubtitleLabel("Off");
    setSelectedSubtitleId("off");
    setCustomCaptionName(null);
    setAudioTrack("Default");
    setSelectedAudioTrackId("default");
    setEmbeddedSubtitleText("");
    setExtractedSubtitles([]);
    setCurrentLocalFilePath("");
    setIsDemuxedLocalFile(false);
  }, []);

  const clearOldDemuxTempOutputs = useCallback(async (keepActive = false) => {
    const electron = getElectronApi();
    if (!electron?.ipcRenderer?.invoke) return;
    try {
      await electron.ipcRenderer.invoke("demux:clearTempOutputs", { keepActive });
    } catch {
      // Best-effort cleanup only.
    }
  }, []);

  const loadLocalFileSource = useCallback(async (input: {
    fileName: string;
    filePath?: string;
    file?: File | null;
  }) => {
    disableAssMode();
    const electron = getElectronApi();
    const fileName = String(input.fileName || "");
    const filePath = String(input.filePath || "");
    const file = input.file || null;

    await clearOldDemuxTempOutputs(false);
    const lowerName = fileName.toLowerCase();
    const isPlaylistFile =
      /\.(m3u8|m3u)$/i.test(fileName) || String(file?.type || "").toLowerCase().includes("mpegurl");
    const shouldUseDemuxer =
      !!electron?.ipcRenderer?.invoke &&
      isLikelyLocalFilesystemPath(filePath) &&
      !isPlaylistFile &&
      /\.(mkv|avi|mov|wmv|flv|ts|m2ts|webm|mp4|m4v|mpg|mpeg|vob|ogv|3gp|asf|divx|f4v|flv)$/i.test(lowerName);

    console.log("[LOCAL LOAD DECISION]", {
      fileName,
      filePath,
      lowerName,
      isPlaylistFile,
      hasElectronInvoke: !!electron?.ipcRenderer?.invoke,
      isLikelyLocalFilesystemPath: isLikelyLocalFilesystemPath(filePath),
      shouldUseDemuxer,
      hasBrowserFile: !!file,
    });

    // ── Tear down any active online stream before loading a local file ──
    // Destroy HLS/DASH instances immediately so they don't fight with the new source
    if (hlsRef.current) {
      try { hlsRef.current.destroy(); } catch { }
      hlsRef.current = null;
    }
    if (dashRef.current) {
      try { dashRef.current.reset(); } catch { }
      dashRef.current = null;
    }
    // Stop current video element to prevent error events from the dying stream
    if (videoRef.current) {
      try {
        videoRef.current.pause();
        videoRef.current.removeAttribute("src");
        videoRef.current.load();
      } catch { }
    }
    // Clear stall recovery timers that could override the local source
    if (stallRecoveryTimerRef.current) {
      clearTimeout(stallRecoveryTimerRef.current);
      stallRecoveryTimerRef.current = null;
    }
    stallRecoveryAttemptRef.current = 0;
    // Clear YouTube recovery/upgrade timers
    if (youtubeRecoveryTimeoutRef.current) {
      clearTimeout(youtubeRecoveryTimeoutRef.current);
      youtubeRecoveryTimeoutRef.current = null;
    }
    youtubeRecoveryInFlightRef.current = false;
    if (youtubeAutoUpgradeTimerRef.current) {
      clearTimeout(youtubeAutoUpgradeTimerRef.current);
      youtubeAutoUpgradeTimerRef.current = null;
    }
    youtubeQualitySwitchPendingRef.current = false;
    // Reset all stream-specific state so late IPC responses don't overwrite the local source
    setIsYoutubeLive(false);
    setActiveOnlineUrl(null);
    loadedUrlInputRef.current = "";
    driveProxyRetryUrlRef.current = null;
    driveRetryUrlsRef.current = [];
    preserveQualityOptionsRef.current = false;
    autoPlayPendingRef.current = true;
    // Clear audio element if separate audio was in use (e.g. YouTube video-only + audio)
    if (audioRef.current) {
      try {
        audioRef.current.pause();
        audioRef.current.removeAttribute("src");
        audioRef.current.load();
      } catch { }
    }

    setFolderFiles([]);
    setCurrentFolderId(null);
    pendingRetrySeekTimeRef.current = null;
    resetTrackUiState();

    let mediaUrl = isPlaylistFile && filePath ? toFileProtocolUrl(filePath) : file ? URL.createObjectURL(file) : toFileProtocolUrl(filePath);
    if (isPlaylistFile && filePath && electron?.ipcRenderer?.invoke) {
      try {
        const localServerUrl = await electron.ipcRenderer.invoke("get-local-media-url", filePath);
        if (localServerUrl) mediaUrl = String(localServerUrl);
      } catch { }
    }

    setVideoTitle(fileName || "Local Video");
    stableVideoTitleRef.current = fileName || "Local Video";
    setOnlineLoadingText("Loading local file...");
    setIsOnlineLoading(true);
    setIsPlaying(true);
    setIsYoutubeStream(false);
    isYoutubeStreamRef.current = false;
    setIsYoutubeLive(false);
    setQuality("Default");
    // Initial guess based on extension, will be refined by demuxer analysis
    const initialFormat = lowerName.endsWith(".webm") ? "VP9" :
      (lowerName.endsWith(".mp4") || lowerName.endsWith(".m4v")) ? "AVC" :
        lowerName.endsWith(".mkv") ? "MKV" :
          lowerName.endsWith(".ts") ? "TS" :
            lowerName.endsWith(".avi") ? "AVI" : "UND";
    setFormat(initialFormat);
    setQualityOptions([{ label: "Default", value: "Default", format: initialFormat }]);
    setPreviewDisabled(false);
    resetTrackUiState();
    streamRetryUrlsRef.current = [];
    setCurrentLocalFilePath(filePath || "");

    if (shouldUseDemuxer) {
      try {
        console.log("[DEMUX] analyze:start", { filePath });
        const analysis = await electron.ipcRenderer.invoke("demux:analyze", filePath);
        console.log("[DEMUX] analyze:result", analysis);
        if (!analysis?.error) {
          console.log("[DEMUX] analyze:tracks", analysis.tracks);
          applyDemuxTrackState(analysis.tracks);
          console.log("[DEMUX] remux:start", { filePath, time: 0 });
          const remuxResult = await electron.ipcRenderer.invoke("demux:remuxForPlayback", {
            filePath,
            time: 0,
          });
          console.log("[DEMUX] remux:result", remuxResult);
          if (remuxResult?.error) {
            console.error("[DEMUX] remux:error", remuxResult.error);
          }
          if (remuxResult?.url && !remuxResult.error) {
            setIsDemuxedLocalFile(true);
            setVideoSrc(remuxResult.url);
            setAudioSrc(remuxResult.audioUrl || null);
            // Fire and forget subtitle extraction so it doesn't block playback startup
            loadDemuxedSubtitleText(true).catch(e => console.error("Auto-load subtitle failed:", e));
            setTimeout(() => {
              if (videoRef.current) {
                videoRef.current.src = remuxResult.url;
                videoRef.current.load();
                videoRef.current.play().catch(() => { });
              }
              // Start the audio proxy element if present (split mode)
              if (remuxResult.audioUrl && audioRef.current) {
                audioRef.current.currentTime = 0;
                audioRef.current.volume = videoRef.current?.volume ?? 1;
                audioRef.current.play().catch(() => { });
              }
            }, 150);
            setTimeout(() => {
              void clearOldDemuxTempOutputs(true);
            }, 800);
            return;
          }
        } else {
          console.error("[DEMUX] analyze:error", analysis?.error);
        }
      } catch (error) {
        console.error("[DEMUX] loadLocalFileSource:fallback", error);
      }
    }

    setVideoSrc(mediaUrl);
    setAudioSrc(null);

    setTimeout(() => {
      if (videoRef.current && !isHlsLikeUrl(mediaUrl) && !isDashLikeUrl(mediaUrl)) {
        videoRef.current.play().catch(() => { });
      }
    }, 100);

    if (electron && filePath) {
      console.log("[LOCAL TRACK FALLBACK] get-media-tracks:send", { filePath });
      electron.ipcRenderer.send("get-media-tracks", filePath);
    }
  }, [applyDemuxTrackState, loadDemuxedSubtitleText, resetTrackUiState]);

  const handleFileLoad = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      await loadLocalFileSource({
        fileName: file.name,
        filePath: String((file as any).path || ""),
        file,
      });
      (e.target as HTMLInputElement).blur();
    }
  };

  // ── Drag & Drop ──
  const [isDragOver, setIsDragOver] = useState(false);
  const dragCounterRef = useRef(0);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current++;
    if (e.dataTransfer.types.includes("Files")) {
      setIsDragOver(true);
    }
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current--;
    if (dragCounterRef.current === 0) {
      setIsDragOver(false);
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current = 0;
    setIsDragOver(false);

    const file = e.dataTransfer.files?.[0];
    if (!file) return;

    const videoExts = [".mp4", ".mkv", ".avi", ".mov", ".webm", ".flv", ".wmv", ".mpg", ".mpeg", ".m4v", ".ts", ".m2ts", ".3gp", ".ogv", ".m3u8", ".m3u"];
    const ext = file.name.toLowerCase().slice(file.name.lastIndexOf("."));
    const isVideo = file.type.startsWith("video/") || videoExts.includes(ext);

    if (isVideo) {
      if (ext === '.m3u' || ext === '.m3u8') {
        try {
          const text = await file.text();
          if (text.includes('#EXTM3U') && !text.includes('#EXT-X-TARGETDURATION') && !text.includes('#EXT-X-STREAM-INF')) {
            const name = file.name.replace(/\.(m3u8?|m3u)$/i, '') || 'Dropped Playlist';
            const { entries, groups } = parseM3U(text, name);
            const pl: Playlist = {
              id: `pl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
              name,
              source: 'local',
              sourceUrl: String((file as any).path || file.name),
              entries,
              groups,
              lastUpdated: Date.now(),
              autoRefresh: false,
            };
            persistPlaylists([...playlists, pl]);
            setActivePlaylistId(pl.id);
            setLoaderTab("playlist");
            setLoaderOnlyPlaylist(false);
            setIsLoaderOpen(true);
            return;
          }
        } catch (err) {
          console.error('[PLAYLIST] Failed to parse dropped M3U file', err);
        }
      }

      await loadLocalFileSource({
        fileName: file.name,
        filePath: String((file as any).path || ""),
        file,
      });
    }
  };

  const playAlbumFile = (url: string, title: string) => {
    pendingRetrySeekTimeRef.current = null;
    autoPlayPendingRef.current = true;
    setVideoSrc(url);
    setAudioSrc(null);
    setQualityOptions([{ label: "Source", value: url, format: "WEB" }]);
    selectedQualityValueRef.current = url;
    setQuality("Source");
    setExtractedSubtitles([]);
    setAvailableAudioTracks([]);
    setVideoTitle(title);
    stableVideoTitleRef.current = title;
    setOnlineLoadingText("Connecting to source...");
    setIsOnlineLoading(true);
    setIsPlaying(true);
    if (videoRef.current) {
      videoRef.current.src = url;
      videoRef.current.load();
      tryAutoPlay();
    }
  };

  const playAlbumFileWithCdn = async (fileId: string, fileName: string) => {
    const electron = getElectronApi();

    // Try enhanced CDN link first
    if (electron?.ipcRenderer?.invoke) {
      try {
        const cdnResult = await electron.ipcRenderer.invoke('generate-pixeldrain-cdn-link', {
          type: 'album',
          fileId
        });
        if (cdnResult?.url) {
          console.log(`[ALBUM] Using enhanced CDN link: ${cdnResult.url}`);
          playAlbumFile(cdnResult.url, fileName);
          return;
        }
      } catch (err) {
        console.warn('[ALBUM] Enhanced CDN attempt failed, falling back to proxy:', err);
      }
    }

    // Fallback to proxy
    if (proxyOrigin) {
      playAlbumFile(`${proxyOrigin}/pixeldrain-stream?fileId=${fileId}&variant=api`, fileName);
    } else {
      playAlbumFile(`https://pixeldrain.com/api/file/${fileId}`, fileName);
    }
  };

  const playFolderFile = async (folderId: string, fileName: string) => {
    const electron = getElectronApi();

    // Try enhanced CDN link first
    if (electron?.ipcRenderer?.invoke) {
      try {
        const cdnResult = await electron.ipcRenderer.invoke('generate-pixeldrain-cdn-link', {
          type: 'folder',
          folderId,
          fileName
        });
        if (cdnResult?.url) {
          console.log(`[FOLDER] Using enhanced CDN link: ${cdnResult.url}`);
          playAlbumFile(cdnResult.url, fileName);
          return;
        }
      } catch (err) {
        console.warn('[FOLDER] Enhanced CDN attempt failed, falling back to proxy:', err);
      }
    }

    // Fallback to proxy
    let resolvedProxyOrigin = proxyOrigin;
    if (!resolvedProxyOrigin && electron?.ipcRenderer?.invoke) {
      try {
        const onDemandOrigin = await electron.ipcRenderer.invoke('get-media-proxy-origin');
        if (onDemandOrigin) {
          resolvedProxyOrigin = String(onDemandOrigin);
          setProxyOrigin(String(onDemandOrigin));
        }
      } catch { }
    }

    const nativeFilesystemUrl = `https://pixeldrain.com/api/filesystem/${encodeURIComponent(folderId)}/${encodeURIComponent(fileName)}`;
    const proxiedUrl = resolvedProxyOrigin
      ? `${resolvedProxyOrigin}/proxy?url=${encodeURIComponent(nativeFilesystemUrl)}`
      : (electron ? '' : nativeFilesystemUrl);

    if (!proxiedUrl) {
      setVideoTitle('Waiting for media proxy...');
      setIsOnlineLoading(false);
      return;
    }

    playAlbumFile(proxiedUrl, fileName);
  };

  const handleLoadUrl = async (url: string, customReferer?: string, httpHeaders?: Record<string, string>, isFromPlaylist: boolean = false) => {
    if (!url.trim() && !customReferer?.trim()) return;
    setIsOnlineLoading(true);

    // ── Immediately tear down old stream so old frames don't bleed through ──
    if (hlsRef.current) {
      try { hlsRef.current.destroy(); } catch { }
      hlsRef.current = null;
    }
    if (dashRef.current) {
      try { dashRef.current.reset(); } catch { }
      dashRef.current = null;
    }
    if (videoRef.current) {
      try {
        videoRef.current.pause();
        videoRef.current.removeAttribute("src");
        videoRef.current.load();
      } catch { }
    }
    setVideoSrc("");
    setAudioSrc(null);
    if (stallRecoveryTimerRef.current) {
      clearTimeout(stallRecoveryTimerRef.current);
      stallRecoveryTimerRef.current = null;
    }
    stallRecoveryAttemptRef.current = 0;

    void clearOldDemuxTempOutputs(false);
    setTimeout(() => {
      void clearOldDemuxTempOutputs(false);
    }, 1200);
    resetTrackUiState();
    setFolderFiles([]);
    setCurrentFolderId(null);
    pendingRetrySeekTimeRef.current = null;
    const trimmedUrl = normalizeOnlineUrl(sanitizeOnlineUrl(url));
    const lowerUrl = trimmedUrl.toLowerCase();
    const isYouTubeUrl = lowerUrl.includes("youtube.com") || lowerUrl.includes("youtu.be");
    const parsedPixeldrain = parsePixeldrainUrl(trimmedUrl);
    const directSource = resolveDirectVideoUrl(trimmedUrl);
    const driveRetries = getDriveRetryUrls(trimmedUrl);
    loadedUrlInputRef.current = trimmedUrl;
    pixelDrainExtractorFallbackTriedRef.current = false;
    driveExtractorFallbackTriedRef.current = false;
    gofileExtractorFallbackTriedRef.current = false;
    driveProxyRetryUrlRef.current = null;
    driveRetryUrlsRef.current = driveRetries;
    streamRetryUrlsRef.current = [];
    setPreviewDisabled(false);
    setActiveOnlineUrl(null);
    setIsYoutubeLive(false);

    autoPlayPendingRef.current = true;

    const electron = getElectronApi();

    if (parsedPixeldrain) {
      const type = parsedPixeldrain.type;

      const updatePixeldrainTitle = async (t: string, id: string, defaultName?: string) => {
        if (isFromPlaylist) return;
        let finalTitle = defaultName || `pixeldrain-${id}`;
        if (t === 'file') {
          try {
            const res = await fetch(`https://pixeldrain.com/api/file/${id}/info`);
            if (res.ok) {
              const data = await res.json();
              if (data.name) finalTitle = data.name;
            }
          } catch (e) {}
        }
        setVideoTitle(finalTitle);
        stableVideoTitleRef.current = finalTitle;
      };

      if (type === 'folder_file') {
        // Direct file inside a folder
        const { folderId, filePath, fileName } = parsedPixeldrain;
        if (electron?.ipcRenderer?.invoke) {
          try {
            const cdnResult = await electron.ipcRenderer.invoke('generate-pixeldrain-cdn-link', {
              type: 'folder', folderId, fileName
            });
            if (cdnResult?.url) {
              console.log(`[PIXELDRAIN] Using enhanced CDN link: ${cdnResult.url}`);
              pixelDrainRetryUrlsRef.current = [];
              setVideoSrc(cdnResult.url);
              setAudioSrc(null);
              void updatePixeldrainTitle('folder', folderId, fileName);
              setOnlineLoadingText("Connecting...");
              setIsOnlineLoading(true);
              setIsPlaying(true);
              if (videoRef.current) {
                videoRef.current.src = cdnResult.url;
                videoRef.current.load();
                tryAutoPlay();
              }
              return;
            }
          } catch (err) {
            console.warn('[PIXELDRAIN] Enhanced CDN attempt failed:', err);
          }
        }
        // Fallback to proxy
        let resolvedProxyOrigin = proxyOrigin;
        if (!resolvedProxyOrigin && electron?.ipcRenderer?.invoke) {
          try {
            const onDemandOrigin = await electron.ipcRenderer.invoke('get-media-proxy-origin');
            if (onDemandOrigin) {
              resolvedProxyOrigin = String(onDemandOrigin);
              setProxyOrigin(String(onDemandOrigin));
            }
          } catch { }
        }
        const nativeFilesystemUrl = `https://pixeldrain.com/api/filesystem/${encodeURIComponent(folderId)}/${filePath.split('/').map((part) => encodeURIComponent(decodeURIComponent(part))).join('/')}`;
        const primaryUrl = resolvedProxyOrigin ? `${resolvedProxyOrigin}/proxy?url=${encodeURIComponent(nativeFilesystemUrl)}` : (electron ? '' : nativeFilesystemUrl);
        if (!primaryUrl) {
          setVideoTitle('Waiting for media proxy...');
          setIsOnlineLoading(false);
          return;
        }
        pixelDrainRetryUrlsRef.current = [];
        setVideoSrc(primaryUrl);
        setAudioSrc(null);
        void updatePixeldrainTitle('folder', folderId, fileName);
        setOnlineLoadingText("Connecting to source...");
        setIsOnlineLoading(true);
        setIsPlaying(true);
        if (videoRef.current) {
          videoRef.current.src = primaryUrl;
          videoRef.current.load();
          tryAutoPlay();
        }
        return;
      }

      if (type === 'file') {
        const { id } = parsedPixeldrain;
        if (electron?.ipcRenderer?.invoke) {
          try {
            const cdnResult = await electron.ipcRenderer.invoke('generate-pixeldrain-cdn-link', {
              type: 'file', fileId: id
            });
            if (cdnResult?.url) {
              console.log(`[PIXELDRAIN] Using enhanced CDN link: ${cdnResult.url}`);
              pixelDrainRetryUrlsRef.current = [];
              setVideoSrc(cdnResult.url);
              setAudioSrc(null);
              void updatePixeldrainTitle('file', id);
              setOnlineLoadingText("Connecting...");
              setIsOnlineLoading(true);
              setIsPlaying(true);
              if (videoRef.current) {
                videoRef.current.src = cdnResult.url;
                videoRef.current.load();
                tryAutoPlay();
              }
              return;
            }
          } catch (err) {
            console.warn('[PIXELDRAIN] Enhanced CDN attempt failed:', err);
          }
        }
        // Fallback
        const primaryUrl = proxyOrigin ? `${proxyOrigin}/pixeldrain-stream?fileId=${id}&variant=api` : `https://pixeldrain.com/api/file/${id}`;
        pixelDrainRetryUrlsRef.current = [];
        setVideoSrc(primaryUrl);
        setAudioSrc(null);
        void updatePixeldrainTitle('file', id);
        setOnlineLoadingText("Connecting to source...");
        setIsOnlineLoading(true);
        setIsPlaying(true);
        if (videoRef.current) {
          videoRef.current.src = primaryUrl;
          videoRef.current.load();
          tryAutoPlay();
        }
        return;
      }

      if (type === 'album' || type === 'd_unknown') {
        const { id } = parsedPixeldrain;
        autoPlayPendingRef.current = true;
        setIsOnlineLoading(true);
        setOnlineLoadingText(`Probing Pixeldrain ${type === 'album' ? 'album' : 'link'}...`);

        const isUnknownFolder = type === 'd_unknown';
        let files = [];
        let plName = `Pixeldrain ${type === 'album' ? 'Album' : 'Folder'}: ${id}`;

        try {
          if (isUnknownFolder && electron?.ipcRenderer?.invoke) {
            // Smart probe for /d/
            const probeResult = await electron.ipcRenderer.invoke('probe-pixeldrain-filesystem', { id });
            if (probeResult && probeResult.isFolder) {
              files = probeResult.files;
              if (probeResult.title) plName = probeResult.title;
            } else {
              // It's not a folder, it's a direct stream file!
              setIsOnlineLoading(false);
              return handleLoadUrl(`https://pixeldrain.com/u/${id}`, customReferer, httpHeaders, isFromPlaylist);
            }
          } else {
            // Album fetch
            const resp = await fetch(`https://pixeldrain.com/api/list/${id}`);
            if (resp.ok) {
              const data = await resp.json();
              if (data.title || data.name) plName = data.title || data.name;
              files = (data.files || []).map((f: any) => ({
                name: decodeURIComponent(f.name),
                id: f.id
              }));
            } else {
              throw new Error(`HTTP ${resp.status}`);
            }
          }

          if (files.length === 0) throw new Error("No files found");

          // Generate M3U8 string
          const m3uLines = ['#EXTM3U'];
          files.forEach((f: any) => {
            const url = isUnknownFolder 
               ? `https://pixeldrain.com/api/filesystem/${encodeURIComponent(id)}/${encodeURIComponent(f.name)}`
               : `https://pixeldrain.com/api/file/${f.id}`;
            m3uLines.push(`#EXTINF:-1,${f.name}`);
            m3uLines.push(url);
          });
          const m3uText = m3uLines.join('\n');

          // Parse into advanced playlist
          const { entries, groups } = parseM3U(m3uText, plName);
          const pl: Playlist = {
            id: `pl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            name: plName,
            source: 'remote',
            sourceUrl: isUnknownFolder ? `https://pixeldrain.com/api/filesystem/${id}` : `https://pixeldrain.com/api/list/${id}`,
            entries,
            groups,
            lastUpdated: Date.now(),
            autoRefresh: true,
          };
          persistPlaylists([...playlists, pl]);
          setActivePlaylistId(pl.id);
          setIsOnlineLoading(false);
          setLoaderTab("playlist");
          
          if (files.length === 1 && entries.length > 0) {
            playPlaylistEntry(entries[0]);
          } else {
            setVideoTitle(`${plName} (${files.length} items)`);
          }
        } catch (err) {
          console.error(`Failed to load Pixeldrain ${type}`, err);
          if (isUnknownFolder) {
            // Probe failed, fallback to direct stream
            setIsOnlineLoading(false);
            return handleLoadUrl(`https://pixeldrain.com/u/${id}`, customReferer, httpHeaders, isFromPlaylist);
          }
          setVideoTitle(`Failed to load Pixeldrain ${type}`);
          setIsOnlineLoading(false);
        }
        return;
      }
    }

    if (!directSource) {
      setIsYoutubeStream(isYouTubeUrl);
      isYoutubeStreamRef.current = isYouTubeUrl;
      setQuality("Default");
      setFormat("UND");
      setQualityOptions([{ label: "Default", value: "Default" }]);
      setVideoTitle("Loading online video...");
      setOnlineLoadingText("Resolving stream...");
      setIsOnlineLoading(true);

      if (electron) {
        if (isYouTubeUrl) {
          setActiveOnlineUrl(trimmedUrl);
          electron.ipcRenderer.send("fetch-online-video", { url: trimmedUrl, referer: customReferer, httpHeaders, isFromPlaylist });
        } else {
          setActiveOnlineUrl(trimmedUrl);
          electron.ipcRenderer.send("fetch-online-video", { url: trimmedUrl, referer: customReferer, httpHeaders, isFromPlaylist });
        }
      } else {
        setVideoSrc("");
        setAudioSrc(null);
        setIsPlaying(false);
        setVideoTitle("Online extraction unavailable (Electron bridge not found)");
      }
    } else {
      const isDirectManifestSource = isHlsLikeUrl(directSource.url) || isDashLikeUrl(directSource.url);

      if ((isDrivePlaybackLike(trimmedUrl) || isDirectManifestSource) && electron) {
        pixelDrainRetryUrlsRef.current = [];
        setIsYoutubeStream(false);
        isYoutubeStreamRef.current = false;
        setQuality("Default");
        setFormat("UND");
        setQualityOptions([{ label: "Default", value: "Default" }]);
        setVideoTitle(isDrivePlaybackLike(trimmedUrl) ? "Loading Drive video..." : "Loading stream manifest...");
        setOnlineLoadingText("Resolving stream...");
        setIsOnlineLoading(true);
        electron.ipcRenderer.send("fetch-online-video", { url: trimmedUrl, referer: customReferer, httpHeaders, isFromPlaylist });
        return;
      }

      pixelDrainRetryUrlsRef.current = [];
      setIsYoutubeStream(false);
      isYoutubeStreamRef.current = false;
      setQuality("Default");
      setFormat("UND");
      setQualityOptions([{ label: "Default", value: "Default" }]);

      setVideoSrc(directSource.url);
      setAudioSrc(null);
      setVideoTitle(directSource.title);
      stableVideoTitleRef.current = directSource.title;
      setOnlineLoadingText("Connecting to source...");
      setIsOnlineLoading(true);
      driveProxyRetryUrlRef.current = null;
      setIsPlaying(true);
      if (videoRef.current && !isHlsLikeUrl(directSource.url) && !isDashLikeUrl(directSource.url)) {
        videoRef.current.src = directSource.url;
        videoRef.current.load();
        tryAutoPlay();
      }
    }
  };

  const submitUrlInput = async () => {
    if (!urlInput.trim()) return;
    const lowerUrl = urlInput.trim().toLowerCase();

    setIsProbingUrl(true);
    // Fast universal probe for playlist signatures
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 1500); // 1.5s max wait for probe

      // Fetch the first few bytes to check if it's a playlist
      const resp = await fetch(urlInput, {
        headers: { Range: 'bytes=0-4096' },
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      const text = await resp.text();
      // If it starts with #EXTM3U and lacks single-stream markers, it's an IPTV playlist
      if (text.trimStart().startsWith('#EXTM3U') && !text.includes('#EXT-X-TARGETDURATION') && !text.includes('#EXT-X-STREAM-INF')) {
        await importPlaylistFromUrl(urlInput);
        setIsLoaderOpen(true);
        setLoaderTab("playlist");
        setLoaderOnlyPlaylist(false);
        setUrlInput("");
        setRefererInput("");
        setIsProbingUrl(false);
        return;
      }
    } catch (err) {
      // Ignore errors (timeout, not text, etc.) and fallback to normal media load
    }
    setIsProbingUrl(false);

    await handleLoadUrl(urlInput, refererInput);
    setIsLoaderOpen(false);
    setUrlInput("");
    setRefererInput("");
    (document.activeElement as HTMLElement | null)?.blur?.();
  };

  // ══════════════════════════════════════════════════════════════════════════════
  // ── Playlist Logic ─────────────────────────────────────────────────────────
  // ══════════════════════════════════════════════════════════════════════════════

  const persistPlaylists = useCallback((updated: Playlist[]) => {
    setPlaylists(updated);
    try { localStorage.setItem('aether_playlists', JSON.stringify(updated)); } catch { }
  }, []);

  const parseM3U = useCallback((text: string, sourceName: string): { entries: PlaylistEntry[]; groups: string[] } => {
    const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
    const entries: PlaylistEntry[] = [];
    const groupSet = new Set<string>();
    let pendingDuration = -1;
    let pendingName = '';
    let pendingLogo = '';
    let pendingGroup = '';
    let pendingHeaders: Record<string, string> = {};
    let pendingDrmKeys: Record<string, string> = {};
    let idx = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line || line === '#EXTM3U') continue;

      // Parse #EXTVLCOPT directives (e.g. http-user-agent, http-referrer)
      if (line.startsWith('#EXTVLCOPT:')) {
        const optVal = line.substring(11);
        const eqIdx = optVal.indexOf('=');
        if (eqIdx > 0) {
          const optKey = optVal.substring(0, eqIdx).trim().toLowerCase();
          const optData = optVal.substring(eqIdx + 1).trim();
          if (optKey === 'http-user-agent') pendingHeaders['user-agent'] = optData;
          else if (optKey === 'http-referrer' || optKey === 'http-referer') pendingHeaders['referer'] = optData;
          else if (optKey === 'http-origin') pendingHeaders['origin'] = optData;
        }
        continue;
      }

      // Parse #EXTHTTP JSON headers (e.g. {"cookie":"..."})
      if (line.startsWith('#EXTHTTP:')) {
        try {
          const jsonStr = line.substring(9).trim();
          const parsed = JSON.parse(jsonStr);
          if (parsed && typeof parsed === 'object') {
            for (const [k, v] of Object.entries(parsed)) {
              if (typeof v === 'string') pendingHeaders[k.toLowerCase()] = v;
            }
          }
        } catch { /* ignore malformed JSON */ }
        continue;
      }

      // Parse KODIPROP DRM keys
      if (line.startsWith('#KODIPROP:')) {
        const propVal = line.substring(10);
        const eqIdx = propVal.indexOf('=');
        if (eqIdx > 0) {
          const key = propVal.substring(0, eqIdx).trim().toLowerCase();
          const val = propVal.substring(eqIdx + 1).trim();
          if (key === 'inputstream.adaptive.license_key') {
            const keysArray = val.split(',');
            for (const kPair of keysArray) {
              if (kPair.includes(':')) {
                const [kid, k] = kPair.split(':');
                pendingDrmKeys[kid] = k;
              } else {
                pendingDrmKeys['00000000000000000000000000000000'] = kPair;
              }
            }
          }
        }
        continue;
      }

      // Skip other comment/directive lines (but NOT #EXTINF)
      if (line.startsWith('#') && !line.startsWith('#EXTINF')) continue;

      if (line.startsWith('#EXTINF:')) {
        // Parse: #EXTINF:duration tvg-logo="..." group-title="...",Track Name
        const afterTag = line.substring(8);

        let inQuotes = false;
        let commaIdx = -1;
        for (let i = 0; i < afterTag.length; i++) {
          if (afterTag[i] === '"') {
            inQuotes = !inQuotes;
          } else if (afterTag[i] === ',' && !inQuotes) {
            commaIdx = i;
            break;
          }
        }

        const metaPart = commaIdx >= 0 ? afterTag.substring(0, commaIdx) : afterTag;
        pendingName = commaIdx >= 0 ? afterTag.substring(commaIdx + 1).trim() : '';

        // Parse duration (first number)
        const durMatch = metaPart.match(/^-?\d+/);
        pendingDuration = durMatch ? parseInt(durMatch[0]) : -1;

        // Parse tvg-logo (supports both quoted and unquoted values)
        const logoMatch = metaPart.match(/tvg-logo=(?:"([^"]*)"|([^\s]+))/i);
        pendingLogo = logoMatch ? (logoMatch[1] || logoMatch[2]) : '';

        // Parse group-title (supports both quoted and unquoted values)
        const groupMatch = metaPart.match(/group-title=(?:"([^"]*)"|([^\s]+))/i);
        pendingGroup = groupMatch ? (groupMatch[1] || groupMatch[2]) : '';
        if (pendingGroup) groupSet.add(pendingGroup);
        continue;
      }

      if (!line.startsWith('#')) {
        // This is a URL/path line — also parse pipe-separated headers (|key=val&key=val)
        let url = line;
        const pipeIdx = url.indexOf('|');
        if (pipeIdx > 0) {
          const pipeParams = url.substring(pipeIdx + 1);
          url = url.substring(0, pipeIdx);
          // Parse key=value pairs separated by &
          for (const param of pipeParams.split('&')) {
            const eqIdx = param.indexOf('=');
            if (eqIdx > 0) {
              const pk = param.substring(0, eqIdx).trim().toLowerCase();
              const pv = param.substring(eqIdx + 1).trim();
              if (pk === 'user-agent') pendingHeaders['user-agent'] = pv;
              else if (pk === 'referer' || pk === 'referrer') pendingHeaders['referer'] = pv;
              else if (pk === 'origin') pendingHeaders['origin'] = pv;
              else if (pk === 'cookie') pendingHeaders['cookie'] = pv;
              else pendingHeaders[pk] = pv;
            }
          }
        }

        const entryName = pendingName || url.split('/').pop()?.split('?')[0] || `Track ${idx + 1}`;
        const entryId = `pl-${idx}-${Math.abs(url.split('').reduce((a, b) => ((a << 5) - a) + b.charCodeAt(0), 0)).toString(36)}`;
        const hasHeaders = Object.keys(pendingHeaders).length > 0;
        const hasDrmKeys = Object.keys(pendingDrmKeys).length > 0;

        entries.push({
          id: entryId,
          name: entryName,
          url,
          duration: pendingDuration,
          group: pendingGroup,
          logo: pendingLogo,
          originalIndex: idx,
          isHidden: false,
          isFavorite: false,
          ...(hasHeaders ? { httpHeaders: { ...pendingHeaders } } : {}),
          ...(hasDrmKeys ? { drmKeys: { ...pendingDrmKeys } } : {}),
        });
        idx++;
        pendingDuration = -1;
        pendingName = '';
        pendingLogo = '';
        pendingGroup = '';
        pendingHeaders = {};
        pendingDrmKeys = {};
      }
    }

    return { entries, groups: Array.from(groupSet).sort() };
  }, []);

  const importPlaylistFromFile = useCallback(async () => {
    const electron = getElectronApi();
    if (!electron?.ipcRenderer?.invoke) return;
    try {
      const result = await electron.ipcRenderer.invoke('dialog:openFile', {
        title: 'Open Playlist',
        filters: [
          { name: 'M3U Playlists', extensions: ['m3u', 'm3u8'] },
          { name: 'All Files', extensions: ['*'] },
        ],
      });
      if (!result) return;

      const filePath = typeof result === 'string' ? result : result?.path || result?.filePaths?.[0];
      if (!filePath) return;

      const content = await electron.ipcRenderer.invoke('read-file-text', filePath);
      if (!content) return;

      const name = String(filePath).split(/[\\/]/).pop()?.replace(/\.(m3u8?|m3u)$/i, '') || 'Untitled Playlist';
      const { entries, groups } = parseM3U(content, name);

      const pl: Playlist = {
        id: `pl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name,
        source: 'local',
        sourceUrl: filePath,
        entries,
        groups,
        lastUpdated: Date.now(),
        autoRefresh: false,
      };

      persistPlaylists([...playlists, pl]);
      setActivePlaylistId(pl.id);
      setPlImportMode(false);
    } catch (err) {
      console.error('[PLAYLIST] Import failed:', err);
    }
  }, [playlists, parseM3U, persistPlaylists]);

  const importPlaylistFromUrl = useCallback(async (url: string) => {
    if (!url.trim()) return;
    setPlRefreshing(true);
    try {
      const resp = await fetch(url);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const text = await resp.text();
      const name = url.split('/').pop()?.split('?')[0]?.replace(/\.(m3u8?|m3u)$/i, '') || 'Remote Playlist';
      const { entries, groups } = parseM3U(text, name);

      const pl: Playlist = {
        id: `pl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name,
        source: 'remote',
        sourceUrl: url,
        entries,
        groups,
        lastUpdated: Date.now(),
        autoRefresh: true,
      };

      persistPlaylists([...playlists, pl]);
      setActivePlaylistId(pl.id);
      setPlImportMode(false);
      setPlImportUrl('');
    } catch (err) {
      console.error('[PLAYLIST] Remote import failed:', err);
    } finally {
      setPlRefreshing(false);
    }
  }, [playlists, parseM3U, persistPlaylists]);

  const refreshPlaylist = useCallback(async (playlistId: string) => {
    const pl = playlists.find(p => p.id === playlistId);
    if (!pl) return;
    setPlRefreshing(true);

    try {
      let text = '';
      if (pl.source === 'remote') {
        const resp = await fetch(pl.sourceUrl);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        text = await resp.text();
      } else {
        const electron = getElectronApi();
        if (electron?.ipcRenderer?.invoke) {
          text = await electron.ipcRenderer.invoke('read-file-text', pl.sourceUrl);
        }
      }

      if (!text) { setPlRefreshing(false); return; }

      const { entries: newEntries, groups } = parseM3U(text, pl.name);

      // Preserve favorites and hidden status from old entries
      const oldMap = new Map(pl.entries.map(e => [e.url, e]));
      for (const entry of newEntries) {
        const old = oldMap.get(entry.url);
        if (old) {
          entry.isFavorite = old.isFavorite;
          entry.isHidden = old.isHidden;
          if (old.name !== entry.name && old.name !== entry.url.split('/').pop()?.split('?')[0]) {
            entry.name = old.name; // Preserve user renames
          }
        }
      }

      const updated = playlists.map(p => p.id === playlistId ? {
        ...p,
        entries: newEntries,
        groups,
        lastUpdated: Date.now(),
      } : p);
      persistPlaylists(updated);
    } catch (err) {
      console.error('[PLAYLIST] Refresh failed:', err);
    } finally {
      setPlRefreshing(false);
    }
  }, [playlists, parseM3U, persistPlaylists]);

  // Auto-refresh remote playlists on startup
  useEffect(() => {
    const toRefresh = playlists.filter(p => p.source === 'remote' && p.autoRefresh);
    if (toRefresh.length === 0) return;
    const timer = setTimeout(() => {
      toRefresh.forEach(p => {
        void refreshPlaylist(p.id);
      });
    }, 3000); // Delay to not block startup
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only on mount

  const deletePlaylist = useCallback((playlistId: string) => {
    persistPlaylists(playlists.filter(p => p.id !== playlistId));
    if (activePlaylistId === playlistId) setActivePlaylistId(null);
  }, [playlists, activePlaylistId, persistPlaylists]);

  const togglePlaylistAutoRefresh = useCallback((playlistId: string) => {
    const updated = playlists.map(p => p.id === playlistId ? { ...p, autoRefresh: !p.autoRefresh } : p);
    persistPlaylists(updated);
  }, [playlists, persistPlaylists]);

  const toggleFavorite = useCallback((playlistId: string, entryId: string) => {
    const updated = playlists.map(p => {
      if (p.id !== playlistId) return p;
      return { ...p, entries: p.entries.map(e => e.id === entryId ? { ...e, isFavorite: !e.isFavorite } : e) };
    });
    persistPlaylists(updated);
  }, [playlists, persistPlaylists]);

  const renamePlaylistEntry = useCallback((playlistId: string, entryId: string, newName: string) => {
    if (!newName.trim()) return;
    const updated = playlists.map(p => {
      if (p.id !== playlistId) return p;
      return { ...p, entries: p.entries.map(e => e.id === entryId ? { ...e, name: newName.trim() } : e) };
    });
    persistPlaylists(updated);
    setPlEditingEntryId(null);
  }, [playlists, persistPlaylists]);

  const renamePlaylist = useCallback((playlistId: string, newName: string) => {
    if (!newName.trim()) {
      setPlListRenamingId(null);
      return;
    }
    const updated = playlists.map(p => {
      if (p.id !== playlistId) return p;
      return { ...p, name: newName.trim() };
    });
    persistPlaylists(updated);
    setPlListRenamingId(null);
  }, [playlists, persistPlaylists]);

  const deletePlaylistEntry = useCallback((playlistId: string, entryId: string) => {
    const updated = playlists.map(p => {
      if (p.id !== playlistId) return p;
      return { ...p, entries: p.entries.map(e => e.id === entryId ? { ...e, isHidden: true } : e) };
    });
    persistPlaylists(updated);
  }, [playlists, persistPlaylists]);

  const reorderPlaylistEntries = useCallback((playlistId: string, fromId: string, toId: string) => {
    const updated = playlists.map(p => {
      if (p.id !== playlistId) return p;
      const arr = [...p.entries];
      const fromIdx = arr.findIndex(e => e.id === fromId);
      const toIdx = arr.findIndex(e => e.id === toId);
      if (fromIdx < 0 || toIdx < 0) return p;
      const [moved] = arr.splice(fromIdx, 1);
      arr.splice(toIdx, 0, moved);
      return { ...p, entries: arr };
    });
    persistPlaylists(updated);
    setPlDragOverId(null);
  }, [playlists, persistPlaylists]);

  const exportPlaylist = useCallback((playlist: Playlist) => {
    const lines = ['#EXTM3U'];
    for (const entry of playlist.entries) {
      if (entry.isHidden) continue;
      let extInf = `#EXTINF:${entry.duration}`;
      if (entry.logo) extInf += ` tvg-logo="${entry.logo}"`;
      if (entry.group) extInf += ` group-title="${entry.group}"`;
      extInf += `,${entry.name}`;
      lines.push(extInf);

      if (entry.drmKeys && Object.keys(entry.drmKeys).length > 0) {
        lines.push('#KODIPROP:inputstream.adaptive.license_type=clearkey');
        const licenseKeys = Object.entries(entry.drmKeys).map(([kid, k]) => `${kid}:${k}`).join(',');
        lines.push(`#KODIPROP:inputstream.adaptive.license_key=${licenseKeys}`);
      }

      lines.push(entry.url);
    }
    const blob = new Blob([lines.join('\n')], { type: 'audio/x-mpegurl' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${playlist.name}.m3u`;
    a.click();
    URL.revokeObjectURL(a.href);
  }, []);

  const playPlaylistEntry = useCallback((entry: PlaylistEntry) => {
    setPlPlayingEntryId(entry.id);
    setIsLoaderOpen(false);
    const url = entry.url;
    if (/^[a-zA-Z]:[\\/]/.test(url) || url.startsWith('/') || url.startsWith('file://')) {
      void loadLocalFileSource({ fileName: entry.name, filePath: url, file: null });
    } else {
      // Pass IPTV httpHeaders (cookie, user-agent, referer) from M3U metadata
      const referer = entry.httpHeaders?.['referer'] || undefined;
      pendingDrmKeysForNextStreamRef.current = entry.drmKeys || null;
      void handleLoadUrl(url, referer, entry.httpHeaders, true);
    }
    setVideoTitle(entry.name);
    stableVideoTitleRef.current = entry.name;
  }, [handleLoadUrl, loadLocalFileSource]);

  const playNextEntry = useCallback(() => {
    if (!activePlaylistId || !plPlayingEntryId) return;
    const pl = playlists.find(p => p.id === activePlaylistId);
    if (!pl) return;
    const visible = pl.entries.filter(e => !e.isHidden);
    const currentIdx = visible.findIndex(e => e.id === plPlayingEntryId);
    if (currentIdx < 0 || currentIdx >= visible.length - 1) return;
    const next = visible[currentIdx + 1];
    if (next) playPlaylistEntry(next);
  }, [activePlaylistId, plPlayingEntryId, playlists, playPlaylistEntry]);

  useEffect(() => {
    playNextEntryRef.current = playNextEntry;
  }, [playNextEntry]);

  const playPrevEntry = useCallback(() => {
    if (!activePlaylistId || !plPlayingEntryId) return;
    const pl = playlists.find(p => p.id === activePlaylistId);
    if (!pl) return;
    const visible = pl.entries.filter(e => !e.isHidden);
    const currentIdx = visible.findIndex(e => e.id === plPlayingEntryId);
    if (currentIdx <= 0) return;
    const prev = visible[currentIdx - 1];
    if (prev) playPlaylistEntry(prev);
  }, [activePlaylistId, plPlayingEntryId, playlists, playPlaylistEntry]);

  // Lazy loading: IntersectionObserver for sentinel
  useEffect(() => {
    let observer: IntersectionObserver | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const attach = () => {
      const sentinel = plSentinelRef.current;
      if (!sentinel) {
        // Sentinel may not be in DOM yet (AnimatePresence), retry shortly
        retryTimer = setTimeout(attach, 150);
        return;
      }
      observer = new IntersectionObserver(
        (entries) => {
          if (entries[0]?.isIntersecting) {
            setPlVisibleCount(prev => prev + 50);
          }
        },
        { root: plScrollRef.current, threshold: 0.1 }
      );
      observer.observe(sentinel);
    };

    attach();

    return () => {
      if (retryTimer) clearTimeout(retryTimer);
      if (observer) observer.disconnect();
    };
  }, [activePlaylistId, plSearchQuery, plGroupFilter, plSortMode, plShowFavoritesOnly, plVisibleCount]);

  // Reset visible count when filters change
  useEffect(() => {
    setPlVisibleCount(50);
  }, [plSearchQuery, plGroupFilter, plSortMode, plShowFavoritesOnly, activePlaylistId]);


  useEffect(() => {
    if (!isLoaderOpen) {
      window.focus();
      return;
    }
    const focusTimer = setTimeout(() => {
      urlInputRef.current?.focus();
      urlInputRef.current?.select();
    }, 20);
    return () => clearTimeout(focusTimer);
  }, [isLoaderOpen]);

  useEffect(() => {
    if (streamLoadGuardTimeoutRef.current) {
      clearTimeout(streamLoadGuardTimeoutRef.current);
      streamLoadGuardTimeoutRef.current = null;
    }

    const video = videoRef.current;
    if (!video) return;
    if (!/^https?:\/\//i.test(videoSrc)) return;
    if (streamRetryUrlsRef.current.length === 0) return;

    streamLoadGuardTimeoutRef.current = setTimeout(() => {
      const stalledAtStart = (video.currentTime || 0) < 0.05 && video.readyState < 2;
      if (stalledAtStart) {
        retryNextStream("Trying alternate stream...");
      }
    }, 8000);

    return () => {
      if (streamLoadGuardTimeoutRef.current) {
        clearTimeout(streamLoadGuardTimeoutRef.current);
        streamLoadGuardTimeoutRef.current = null;
      }
    };
  }, [videoSrc, retryNextStream]);

  const sanitizeCueHtml = (raw: string): string => {
    const normalized = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    const noTimingTags = normalized.replace(/<\d+:\d+[\d:.]*>/g, "").replace(/<c[^>]*>/g, "").replace(/<\/c>/g, "");
    const stripped = noTimingTags.replace(/<(?!\/?(?:b|i|u|br|font|span)(?:\s[^>]*)?>)[^>]+>/gi, "");
    return stripped.replace(/\n/g, "<br>");
  };

  const parseTime = (timeStr: string) => {
    const parts = timeStr.replace(",", ".").split(":");
    let seconds = 0;
    if (parts.length === 3) {
      seconds = parseInt(parts[0]) * 3600 + parseInt(parts[1]) * 60 + parseFloat(parts[2]);
    } else if (parts.length === 2) {
      seconds = parseInt(parts[0]) * 60 + parseFloat(parts[1]);
    }
    return seconds;
  };

  const parseSubtitles = (text: string) => {
    const normalized = text.replace(/\r\n/g, "\n").replace(/^\uFEFF/, "");
    const trimmed = normalized.trim();
    const cues: { start: number; end: number; text: string }[] = [];

    if (!trimmed) return cues;

    if (/\[Script Info\]|\[V4\+? Styles\]|^Dialogue:/mi.test(trimmed)) {
      const lines = trimmed.split("\n");
      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line.startsWith("Dialogue:")) continue;
        const payload = line.slice("Dialogue:".length).trim();
        const parts = payload.split(",");
        if (parts.length < 10) continue;
        const startStr = parts[1]?.trim() || "0:00:00.00";
        const endStr = parts[2]?.trim() || startStr;
        const textPart = parts.slice(9).join(",").trim();
        const cleanedText = textPart
          .replace(/\{\\[^}]*\}/g, "")
          .replace(/\\N/g, "\n")
          .replace(/\\n/g, "\n")
          .replace(/\\h/g, " ")
          .trim();
        if (!cleanedText) continue;
        cues.push({
          start: parseTime(startStr),
          end: parseTime(endStr),
          text: cleanedText,
        });
      }
      return cues;
    }

    const blocks = trimmed.split(/\n\s*\n/);
    blocks.forEach((block) => {
      const lines = block.split("\n");
      if (lines.length > 0 && /^\d+$/.test(lines[0].trim())) {
        lines.shift();
      }
      if (lines.length > 0 && lines[0].includes("-->")) {
        const [startStr, endStr] = lines[0].split("-->");
        cues.push({
          start: parseTime(startStr.trim()),
          end: parseTime(endStr.trim()),
          text: sanitizeCueHtml(lines.slice(1).join("\n").trim()),
        });
      } else if (lines.length > 1 && lines[1].includes("-->")) {
        const [startStr, endStr] = lines[1].split("-->");
        cues.push({
          start: parseTime(startStr.trim()),
          end: parseTime(endStr.trim()),
          text: sanitizeCueHtml(lines.slice(2).join("\n").trim()),
        });
      }
    });
    return cues;
  };

  const handleSubtitleLoad = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      const isAssFile = /\.(ass|ssa)$/i.test(file.name) || isAssSubtitleContent(text);

      console.log(isAssFile ? "[ASS] Mode ON" : "[ASS] Mode OFF");

      if (isAssFile) {
        console.log("[ASS] Manual file");
        setSubtitles([]);
        setEmbeddedSubtitleText("");
        setCustomCaptionName(file.name);
        setCaption("Custom");
        setSelectedSubtitleLabel(file.name);
        setSelectedSubtitleId(`custom:${file.name}`);
        disableEmbeddedTracks();
        setAssSourceFromText(text, `Manual ASS subtitle loaded: ${file.name}`);
        e.target.value = "";
        return;
      }

      disableAssMode();
      const cues = parseSubtitles(text);
      setSubtitles(cues);
      setCustomCaptionName(file.name);
      setCaption("Custom");
      setSelectedSubtitleLabel(file.name);
      setSelectedSubtitleId(`custom:${file.name}`);
      disableEmbeddedTracks();
    };
    reader.readAsText(file);

    e.target.value = "";
  };

  const activeCue = useMemo(() => {
    if (caption === "Off") return null;
    return subtitles.find((cue) => currentTime >= cue.start && currentTime <= cue.end) || null;
  }, [currentTime, subtitles, caption]);

  const finalSubtitleText = useMemo(() => {
    if (caption !== "Off" && activeCue) return activeCue.text;
    if (caption !== "Off" && caption !== "Custom" && caption !== "Demux" && embeddedSubtitleText) {
      return embeddedSubtitleText.replace(/\n/g, "<br>");
    }
    return "";
  }, [caption, activeCue, embeddedSubtitleText]);

  const showStatus = (icon: string, text: string = "") => {
    if (statusHideTimeoutRef.current) {
      clearTimeout(statusHideTimeoutRef.current);
      statusHideTimeoutRef.current = null;
    }
    setStatusOverlay({ active: true, icon, text });
    statusHideTimeoutRef.current = setTimeout(() => {
      setStatusOverlay((prev) => ({ ...prev, active: false }));
      statusHideTimeoutRef.current = null;
    }, 500);
  };

  const closeSettingsPanel = useCallback((afterClose?: () => void) => {
    if (settingsCloseTimeoutRef.current) {
      clearTimeout(settingsCloseTimeoutRef.current);
      settingsCloseTimeoutRef.current = null;
    }

    if (!isSettingsOpen) {
      afterClose?.();
      return;
    }

    setIsSettingsOpen(false);
    setActiveSubmenu(null);

    settingsCloseTimeoutRef.current = setTimeout(() => {
      settingsCloseTimeoutRef.current = null;
      afterClose?.();
    }, 320);
  }, [isSettingsOpen]);

  const handlePlayPause = useCallback(() => {
    const video = videoRef.current;
    if (!video || !videoSrc) return;

    if (video.paused || video.ended) {
      pauseTimeRef.current = null;
      stallRecoveryAttemptRef.current = 0;

      // Show spinner immediately — don't wait 2-4 s for the 'waiting' event.
      if (/^https?:\/\//i.test(video.currentSrc || videoSrc || '')) {
        setIsOnlineLoading(true);
        setOnlineLoadingText('');
      }

      const playPromise = video.play();
      if (playPromise && typeof playPromise.then === "function") {
        playPromise
          .then(() => {
            setIsPlaying(true);
            if (audioRef.current && audioSrc) {
              audioRef.current.currentTime = video.currentTime;
              audioRef.current.playbackRate = video.playbackRate;
              audioRef.current.play().catch(() => { });
            }
            showStatus("pause");
          })
          .catch(() => {
            setIsPlaying(false);
          });
      } else {
        setIsPlaying(true);
        if (audioRef.current && audioSrc) {
          audioRef.current.currentTime = video.currentTime;
          audioRef.current.playbackRate = video.playbackRate;
          audioRef.current.play().catch(() => { });
        }
        showStatus("pause");
      }
      return;
    }

    video.pause();
    pauseTimeRef.current = Date.now();
    if (audioRef.current) audioRef.current.pause();
    setIsPlaying(false);
    showStatus("play");
  }, [audioSrc, videoSrc]);

  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video || !videoSrc) return;

    if (video.paused) {
      pauseTimeRef.current = null;
      stallRecoveryAttemptRef.current = 0;

      // Show spinner immediately — don't wait 2-4 s for the 'waiting' event.
      if (/^https?:\/\//i.test(video.currentSrc || videoSrc || '')) {
        setIsOnlineLoading(true);
        setOnlineLoadingText('');
      }

      const playPromise = video.play();
      if (playPromise && typeof playPromise.then === "function") {
        playPromise
          .then(() => {
            setIsPlaying(true);
            showStatus("pause");
            if (audioRef.current) {
              audioRef.current.currentTime = video.currentTime;
              audioRef.current.playbackRate = video.playbackRate;
              audioRef.current.play().catch(() => { });
            }
          })
          .catch(() => {
            setIsPlaying(false);
          });
      } else {
        setIsPlaying(true);
        showStatus("pause");
      }
      return;
    }

    video.pause();
    pauseTimeRef.current = Date.now();
    if (audioRef.current) {
      audioRef.current.pause();
    }
    setIsPlaying(false);
    showStatus("play");
  }, [videoSrc]);

  const triggerRipple = (side: "left" | "right") => {
    if (side === "left") {
      setRippleLeft(false);
      setTimeout(() => setRippleLeft(true), 10);
    } else {
      setRippleRight(false);
      setTimeout(() => setRippleRight(true), 10);
    }
  };

  const disableEmbeddedTracks = useCallback(() => {
    const vid = videoRef.current as any;
    if (vid && vid.textTracks) {
      for (let i = 0; i < vid.textTracks.length; i++) {
        const track = vid.textTracks[i];
        if (track.kind === "subtitles" || track.kind === "captions") {
          track.mode = "disabled";
        }
      }
    }
  }, []);

  const disposeAssRenderer = useCallback(() => {
    if (assInstanceRef.current) {
      try {
        console.log("[ASS] Instance disposed");
        assInstanceRef.current.dispose();
      } catch (error) {
        console.error("[ASS] Failed during dispose:", error);
      }
      assInstanceRef.current = null;
    }
  }, []);

  const extractAssFontNames = useCallback((text: string) => {
    const fontNames = new Set<string>();
    const lines = String(text || "").split(/\r?\n/);
    let inStylesSection = false;
    let styleFormatColumns: string[] = [];

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue;
      if (/^\[v4\+? styles\]/i.test(line)) {
        inStylesSection = true;
        styleFormatColumns = [];
        continue;
      }
      if (inStylesSection && /^\[.*\]$/.test(line)) {
        inStylesSection = false;
        continue;
      }
      if (!inStylesSection) continue;

      if (/^format\s*:/i.test(line)) {
        styleFormatColumns = line
          .replace(/^format\s*:/i, "")
          .split(",")
          .map((part) => part.trim().toLowerCase());
        continue;
      }

      if (/^style\s*:/i.test(line)) {
        const values = line.replace(/^style\s*:/i, "").split(",");
        const fontNameIndex = styleFormatColumns.indexOf("fontname");
        const fallbackFontName = values[1]?.trim();
        const resolvedFontName = fontNameIndex >= 0 ? values[fontNameIndex]?.trim() : fallbackFontName;
        if (resolvedFontName) {
          fontNames.add(resolvedFontName);
        }
      }
    }

    return Array.from(fontNames);
  }, []);

  const setAssSourceFromText = useCallback((text: string, sourceLabel: string) => {
    const normalizedText = String(text || "");
    console.log(`[ASS] ${sourceLabel}`);
    console.log("[ASS] Mode ON");
    console.log("[ASS] Detected fonts from ASS:", extractAssFontNames(normalizedText));
    assSubtitleContentRef.current = normalizedText;
    assModeRef.current = true;
    setAssSubtitleContent((prev) => (prev === normalizedText ? prev : normalizedText));
    setAssMode((prev) => (prev ? prev : true));
  }, [extractAssFontNames]);

  const disableAssMode = useCallback(() => {
    const hadAssState = !!(assModeRef.current || assSubtitleContentRef.current || assInstanceRef.current);
    if (hadAssState) {
      console.log("[ASS] Mode OFF");
    }
    disposeAssRenderer();
    assSubtitleContentRef.current = null;
    assModeRef.current = false;
    setAssSubtitleContent((prev) => (prev === null ? prev : null));
    setAssMode((prev) => (prev ? false : prev));
  }, [disposeAssRenderer]);

  const ensureSubtitlesOctopusLoaded = useCallback(async () => {
    if ((window as any).SubtitlesOctopus) {
      return (window as any).SubtitlesOctopus;
    }

    console.log("[ASS] Initializing script load...");

    await new Promise<void>((resolve, reject) => {
      const existingScript = document.querySelector('script[data-ass-octopus="true"]') as HTMLScriptElement | null;
      if (existingScript) {
        existingScript.addEventListener("load", () => resolve(), { once: true });
        existingScript.addEventListener("error", () => reject(new Error("SubtitlesOctopus script failed to load")), { once: true });
        return;
      }

      const script = document.createElement("script");
      script.src = getRuntimeAssetUrl("ass/subtitles-octopus.js");
      script.async = true;
      script.dataset.assOctopus = "true";
      script.onload = () => resolve();
      script.onerror = () => reject(new Error("SubtitlesOctopus script failed to load"));
      document.body.appendChild(script);
    });

    if (!(window as any).SubtitlesOctopus) {
      throw new Error("[ASS] Failed to load WASM runtime");
    }

    return (window as any).SubtitlesOctopus;
  }, []);

  const extractAssFonts = useCallback(async () => {
    console.log("[ASS] Font extraction bypassed for debugging");
    return [] as string[];
  }, []);

  const waitForVideoLoaded = useCallback((video: HTMLVideoElement) => {
    return new Promise<void>((resolve) => {
      if (video.videoWidth > 0 && video.videoHeight > 0) {
        resolve();
        return;
      }
      const onLoaded = () => {
        video.removeEventListener("loadedmetadata", onLoaded);
        resolve();
      };
      video.addEventListener("loadedmetadata", onLoaded, { once: true });
    });
  }, []);

  const loadExtractedSubtitle = useCallback(async (sub: { url: string; label: string; format?: string | null }) => {
    setCaption(sub.label);
    setSelectedSubtitleLabel(sub.label);
    setSelectedSubtitleId(`extracted:${sub.url}`);
    setEmbeddedSubtitleText("");
    disableEmbeddedTracks();

    const response = await fetch(sub.url);
    const content = await response.text();
    const isAssSource = /\.(ass|ssa)(?:$|\?)/i.test(sub.url) || isAssSubtitleContent(content);

    if (isAssSource) {
      console.log("[ASS] Extracted subtitle");
      setSubtitles([]);
      setAssSourceFromText(content, `Extracted ASS subtitle loaded: ${sub.label}`);
      return;
    }

    disableAssMode();
    const cues = parseSubtitles(content);
    setSubtitles(cues);
  }, [disableAssMode, disableEmbeddedTracks, setAssSourceFromText]);

  const pickPreferredExtractedSubtitle = useCallback(
    (items: { url: string; language?: string | null; label: string; format?: string | null }[]) => {
      if (!Array.isArray(items) || items.length === 0) return null;

      const exactDefault = defaultExtractedSubtitleUrlRef.current
        ? items.find((sub) => sub.url === defaultExtractedSubtitleUrlRef.current)
        : null;
      if (exactDefault) return exactDefault;

      const englishByLanguage = items.find(
        (sub) => String(sub.language || "").trim().toLowerCase() === "en"
      );
      if (englishByLanguage) return englishByLanguage;

      const englishByLabel = items.find((sub) => /english|\ben\b/i.test(String(sub.label || "")));
      if (englishByLabel) return englishByLabel;

      const vttFirst = items.find((sub) => /\.vtt(?:$|\?)/i.test(String(sub.url || "")));
      if (vttFirst) return vttFirst;

      return items[0] || null;
    },
    []
  );

  useEffect(() => {
    if (!assMode || !assSubtitleContent) return;
    if (assInstanceRef.current) return;

    let disposed = false;
    let instance: any = null;

    const initializeAss = async (video: HTMLVideoElement) => {
      try {
        const detectedAssFonts = extractAssFontNames(assSubtitleContent);
        const extractedFonts = await extractAssFonts();
        const assFonts = resolveAssFontPaths(detectedAssFonts, extractedFonts);
        const unresolvedAssFonts = detectedAssFonts.filter(
          (fontName) => !ASS_FONT_MAP[normalizeAssFontKey(fontName)]
        );
        const finalFonts = assFonts;

        console.log("[ASS DEBUG LOOP CHECK]", {
          assMode,
          assSubtitleContentLength: assSubtitleContent.length,
          videoSrc,
        });

        console.log("[ASS] init");
        console.log("[ASS DEBUG]", {
          assMode,
          assSubtitleContentLength: assSubtitleContent.length,
          hasVideo: !!video,
          detectedAssFonts,
          unresolvedAssFonts,
        });
        console.log("[ASS] Video ready:", !!video);
        console.log("[ASS] Detected fonts from ASS:", detectedAssFonts);
        console.log("[ASS] Extracted fonts:", extractedFonts);
        console.log("[ASS] Fonts loaded:", assFonts);
        console.log("[ASS] Final fonts used:", finalFonts);
        console.log("[ASS] Fallback font:", getRuntimeAssetUrl("fonts/arial.ttf"));
        console.log("[ASS] Content preview:", assSubtitleContent.slice(0, 500));
        if (assFonts.length === DEFAULT_ASS_FONTS.length) {
          console.warn("[ASS] Using only default mapped fonts. Add matching font files under /public/fonts for VLC-like styling fidelity.");
        }
        if (unresolvedAssFonts.length > 0) {
          console.warn("[ASS] Missing font mappings for:", unresolvedAssFonts);
        }
        await waitForVideoLoaded(video);
        if (disposed || assInstanceRef.current) return;

        await new Promise<void>((resolve) => {
          const check = () => {
            const videoRect = video.getBoundingClientRect();
            if (videoRect.width > 0 && videoRect.height > 0) {
              resolve();
            } else {
              requestAnimationFrame(check);
            }
          };
          check();
        });
        if (disposed || assInstanceRef.current) return;

        void video.offsetHeight;
        void document.body.offsetHeight;

        const wasPaused = video.paused;
        if (wasPaused) {
          await video.play().catch(() => { });
          await new Promise((resolve) => setTimeout(resolve, 50));
          if (wasPaused) {
            video.pause();
          }
        }

        await new Promise<void>((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        });
        await new Promise((resolve) => setTimeout(resolve, 100));
        if (disposed || assInstanceRef.current) return;

        console.log("[ASS] Just before creation:", {
          video,
          videoIsConnected: video.isConnected,
          videoClientRect: video.getBoundingClientRect(),
          videoOffsetWidth: video.offsetWidth,
          videoClientWidth: video.clientWidth,
          videoPaused: video.paused,
          subContentLength: assSubtitleContent.length,
        });

        const SubtitlesOctopusCtor = await ensureSubtitlesOctopusLoaded();
        if (disposed || assInstanceRef.current) return;

        instance = new SubtitlesOctopusCtor({
          video,
          subContent: assSubtitleContent,
          workerUrl: getRuntimeAssetUrl("ass/subtitles-octopus-worker.js"),
          wasmUrl: getRuntimeAssetUrl("ass/subtitles-octopus-worker.wasm"),
          legacyWorkerUrl: getRuntimeAssetUrl("ass/subtitles-octopus-worker-legacy.js"),
          fonts: finalFonts,
          fallbackFont: getRuntimeAssetUrl("fonts/arial.ttf"),
          debug: true,
        });

        assInstanceRef.current = instance;

        console.log("[ASS] fonts loaded");
        console.log("[ASS] Loaded successfully");
      } catch (err) {
        console.error("[ASS] Initialization failed:", err);
        console.error("[ASS] Failed to load WASM");
      }
    };

    const video = videoRef.current;

    if (!video) {
      console.log("[ASS] waiting for DOM...");
      return () => {
        disposed = true;
      };
    }

    void initializeAss(video);

    return () => {
      disposed = true;
      if (instance) {
        try {
          console.log("[ASS] dispose");
          instance.dispose();
        } catch (error) {
          console.error("[ASS] Worker failed", error);
        }
        if (assInstanceRef.current === instance) {
          assInstanceRef.current = null;
        }
      }
    };
  }, [assMode, assSubtitleContent, ensureSubtitlesOctopusLoaded, extractAssFonts, extractAssFontNames, waitForVideoLoaded]);

  useEffect(() => {
    if (!videoSrc) return;
    if (assInstanceRef.current) {
      console.log("[ASS] Video changed → cleanup");
      disposeAssRenderer();
    }
  }, [videoSrc, disposeAssRenderer]);

  useEffect(() => {
    return () => {
      console.log("[ASS] Component cleanup");
      disposeAssRenderer();
    };
  }, [disposeAssRenderer]);

  const handleEmbeddedSubtitleChange = async (index: number, label: string) => {
    const electron = getElectronApi();
    const matchedTrack = availableTextTracks.find((track) => track.index === index);
    if (isDemuxedLocalFile) {
      // ── Instant restore from cache ──
      const cached = subtitleCacheRef.current.get(index);
      if (cached) {
        if (cached.isAss) {
          disableAssMode();
          setSubtitles([]);
          setEmbeddedSubtitleText("");
          setCaption("Demux");
          setDemuxSubtitleActive(true);
          setAssSourceFromText(cached.rawText, "Cached ASS subtitle");
        } else {
          disableAssMode();
          setSubtitles(cached.cues);
          setEmbeddedSubtitleText("");
          setCaption("Demux");
          setDemuxSubtitleActive(true);
        }
        setSelectedSubtitleLabel(matchedTrack?.title || label);
        setSelectedSubtitleId(`embedded:${index}`);
        // Sync track manager in background (fire-and-forget)
        if (electron?.ipcRenderer?.invoke) {
          electron.ipcRenderer.invoke("demux:setTracks", { subtitleIndex: index }).catch(() => { });
        }
        return;
      }

      // ── Cache miss — extract via IPC ──
      if (electron?.ipcRenderer?.invoke) {
        try {
          setIsOnlineLoading(true);
          setOnlineLoadingText("");
          setSubtitles([]);
          setEmbeddedSubtitleText("");

          const trackResult = await electron.ipcRenderer.invoke("demux:setTracks", {
            subtitleIndex: index,
          });

          if (trackResult?.error) {
            console.error("[DEMUX SUBTITLE] setTracks:error", trackResult);
            return;
          }

          applyDemuxTrackState(trackResult);
          setSelectedSubtitleLabel(matchedTrack?.title || label);
          setSelectedSubtitleId(`embedded:${index}`);
          await loadDemuxedSubtitleText();
        } catch (error) {
          console.error("[DEMUX SUBTITLE] switch:error", error);
        } finally {
          setIsOnlineLoading(false);
        }
        return;
      }
    }
    disableAssMode();
    setCaption(matchedTrack?.title || label);
    setSelectedSubtitleLabel(matchedTrack?.title || label);
    setSelectedSubtitleId(`embedded:${index}`);
    if (electron) {
      electron.ipcRenderer.send("extract-subtitle-track", index);
    } else {
      const vid = videoRef.current as any;
      if (vid && vid.textTracks) {
        for (let i = 0; i < vid.textTracks.length; i++) {
          const track = vid.textTracks[i];
          if (track.kind === "subtitles" || track.kind === "captions") {
            track.mode = i === index ? "hidden" : "disabled";
          }
        }
      }
    }
  };

  const toggleCaptions = useCallback(async () => {
    if (selectedSubtitleId !== "off") {
      setCaption("Off");
      setSelectedSubtitleLabel("Off");
      setSelectedSubtitleId("off");
      setSubtitles([]);
      setEmbeddedSubtitleText("");
      setAssSubtitleContent(null);
      setAssMode(false);
      return;
    }

    // Prioritize embedded tracks (local files)
    if (availableTextTracks.length > 0) {
      const first = availableTextTracks[0];
      await handleEmbeddedSubtitleChange(first.index, first.label);
      return;
    }

    // Then extracted online subs
    if (extractedSubtitles.length > 0) {
      const first = extractedSubtitles[0];
      await loadExtractedSubtitle(first);
      return;
    }

    // Then custom uploaded subs
    if (customCaptionName) {
      // Note: Re-enabling custom subtitles after turning them off via the toggle or menu
      // requires re-parsing the file or storing the parsed subtitle array.
      // For now, this just updates the UI state.
      setCaption(customCaptionName);
      setSelectedSubtitleLabel(customCaptionName);
      setSelectedSubtitleId(`custom:${customCaptionName}`);
    }
  }, [selectedSubtitleId, availableTextTracks, extractedSubtitles, customCaptionName, handleEmbeddedSubtitleChange, loadExtractedSubtitle]);

  const handleAudioTrackChange = async (index: number, label: string) => {
    const electron = getElectronApi();
    const matchedTrack = availableAudioTracks.find((track) => track.index === index);

    if (isYoutubeStream && electron && matchedTrack?.id) {
      // Already playing this track — nothing to do.
      if (String(matchedTrack.id) === selectedAudioTrackId) return;

      setAudioTrack(matchedTrack?.title || label);
      setSelectedAudioTrackId(String(matchedTrack.id));

      const video = videoRef.current;
      freezeFrame();
      resumeAfterQualitySwitchRef.current = !!video && !video.paused && !video.ended;
      youtubeAutoUpgradeDoneRef.current = true;
      if (youtubeAutoUpgradeTimerRef.current) {
        clearTimeout(youtubeAutoUpgradeTimerRef.current);
        youtubeAutoUpgradeTimerRef.current = null;
      }

      electron.ipcRenderer.send("set-youtube-audio-track", {
        audioTrackId: matchedTrack.id,
        qualityId: selectedYoutubeQualityIdRef.current,
        currentTime: video?.currentTime || 0
      });
      return;
    }

    if (isDemuxedLocalFile) {
      const video = videoRef.current;
      const wasPlaying = !!video && !video.paused && !video.ended;
      const currentPos = video?.currentTime || 0;

      try {
        setIsOnlineLoading(true);
        setOnlineLoadingText("");
        if (video) video.pause();
        autoPlayPendingRef.current = wasPlaying;

        await remuxLocalPlaybackWithTracks({
          audioIndex: index,
          currentTime: currentPos,
        });
        setAudioTrack(matchedTrack?.title || label);
        setSelectedAudioTrackId(String(index));
      } catch (error) {
        console.error("[DEMUX AUDIO] switch:error", error);
      } finally {
        setIsOnlineLoading(false);
      }
      return;
    }

    const animeTrack = matchedTrack?.id ? animeAudioTrackMapRef.current[String(matchedTrack.id)] : null;
    if (animeTrack) {
      const currentQualityLabel = quality;
      const nextQualityOptions = Array.isArray(animeTrack.qualities) && animeTrack.qualities.length > 0
        ? animeTrack.qualities
        : [{ label: 'Auto', value: animeTrack.url || videoSrc, audioTrackId: animeTrack.id }];
      const preferredMatch = nextQualityOptions.find((entry) => entry.label === currentQualityLabel) ||
        nextQualityOptions.find((entry) => entry.value === animeTrack.selectedQuality) ||
        nextQualityOptions[0];
      const currentPos = videoRef.current?.currentTime || 0;
      const wasPlaying = !!videoRef.current && !videoRef.current.paused && !videoRef.current.ended;

      animeAudioTrackMapRef.current[String(animeTrack.id)] = {
        ...animeTrack,
        selectedQuality: preferredMatch?.value || animeTrack.url || null
      };

      setAudioTrack(animeTrack.title || animeTrack.label || label);
      setSelectedAudioTrackId(String(animeTrack.id));
      setQualityOptions(nextQualityOptions);
      selectedQualityValueRef.current = preferredMatch?.value || nextQualityOptions[0]?.value || 'Default';
      setQuality(preferredMatch?.label || nextQualityOptions[0]?.label || 'Default');
      pendingRetrySeekTimeRef.current = currentPos;
      autoPlayPendingRef.current = wasPlaying;
      setVideoSrc(preferredMatch?.value || animeTrack.url || videoSrc);
      setAudioSrc(null);
      return;
    }

    setAudioTrack(matchedTrack?.title || label);
    setSelectedAudioTrackId(String(index));
    if (electron) {
      const video = videoRef.current;
      const wasPlaying = !!video && !video.paused && !video.ended;
      const currentTime = video?.currentTime || 0;

      setIsOnlineLoading(true);
      setOnlineLoadingText("");
      if (video) video.pause();
      autoPlayPendingRef.current = wasPlaying;

      electron.ipcRenderer.send("set-audio-track", { index, currentTime });
    } else {
      const vid = videoRef.current as any;
      if (vid && vid.audioTracks) {
        for (let i = 0; i < vid.audioTracks.length; i++) {
          vid.audioTracks[i].enabled = i === index;
        }
      }
    }
  };

  const handleQualityChange = (value: string, label: string) => {
    selectedQualityValueRef.current = value;
    const selectedOption = qualityOptions.find(opt => opt.value === value);
    const isNativeHlsLevel = !!(selectedOption as any)?.isNativeHlsLevel && !!hlsRef.current;
    const isNativeDashLevel = !!(selectedOption as any)?.isNativeDashLevel && !!dashRef.current;

    if (isYoutubeStream && value !== selectedYoutubeQualityIdRef.current) {
      if (isNativeHlsLevel) {
        const nextLevel = parseInt(String(value), 10);
        if (hlsRef.current) {
          hlsRef.current.currentLevel = Number.isNaN(nextLevel) ? -1 : nextLevel;
          setQuality(label);
        }
        return;
      }
      if (isNativeDashLevel) {
        if (dashRef.current) {
          if (value === '-1') {
            dashRef.current.updateSettings({ streaming: { abr: { autoSwitchBitrate: { video: true } } } });
          } else {
            dashRef.current.updateSettings({ streaming: { abr: { autoSwitchBitrate: { video: false } } } });
            if (typeof (dashRef.current as any).setRepresentationForTypeById === 'function') {
              (dashRef.current as any).setRepresentationForTypeById('video', String(value));
            } else {
              const nextLevel = parseInt(String(value), 10);
              (dashRef.current as any).setQualityFor('video', nextLevel);
            }
          }
          setQuality(label);
        }
        return;
      }

      const video = videoRef.current;
      if (!video) return;

      freezeFrame();
      const wasPlaying = !video.paused && !video.ended;
      resumeAfterQualitySwitchRef.current = wasPlaying;
      autoPlayPendingRef.current = wasPlaying;

      // Synchronously pause playback so both audio and video stop at the exact frozen frame
      video.pause();
      if (audioRef.current) {
        audioRef.current.pause();
      }

      youtubeAutoUpgradeDoneRef.current = true;
      preferredYoutubeQualityIdRef.current = value;
      if (youtubeAutoUpgradeTimerRef.current) {
        clearTimeout(youtubeAutoUpgradeTimerRef.current);
        youtubeAutoUpgradeTimerRef.current = null;
      }

      setOnlineLoadingText("");
      setIsOnlineLoading(true);

      setQuality(label);
      const electron = getElectronApi();
      if (electron) {
        electron.ipcRenderer.send("set-youtube-quality", {
          qualityId: value,
          currentTime: video.currentTime || 0,
        });
      }
      return;
    }

    if (!isYoutubeStream && qualityOptions.length > 1) {
      const video = videoRef.current;
      if (!video) return;

      const currentPos = video.currentTime;
      const wasPlaying = !video.paused && !video.ended;

      const selectedOption = qualityOptions.find(opt => opt.value === value);
      if (!selectedOption) return;

      const originalSelectedValue = String((selectedOption as any).originalValue || '');
      const nextValue = String(selectedOption.value || '');
      const qualitySourceValue = originalSelectedValue || nextValue;
      const nextIsManifest = isHlsLikeUrl(qualitySourceValue) || isDashLikeUrl(qualitySourceValue) || isHlsLikeUrl(nextValue) || isDashLikeUrl(nextValue);
      const currentIsManifest = isHlsLikeUrl(videoSrc) || isDashLikeUrl(videoSrc);
      const isNativeHlsLevel = !!(selectedOption as any).isNativeHlsLevel && !!hlsRef.current;
      const isNativeDashLevel = !!(selectedOption as any).isNativeDashLevel && !!dashRef.current;

      if (isNativeHlsLevel) {
        const nextLevel = parseInt(nextValue, 10);
        if (hlsRef.current) {
          hlsRef.current.currentLevel = Number.isNaN(nextLevel) ? -1 : nextLevel;
          setQuality(label);
        }
        return;
      }

      if (isNativeDashLevel) {
        if (dashRef.current) {
          if (value === '-1') {
            console.log('[DASH-QUALITY] Setting AutoSwitchBitrate to true');
            dashRef.current.updateSettings({ streaming: { abr: { autoSwitchBitrate: { video: true } } } });
          } else {
            const nextLevel = parseInt(String(value), 10);
            console.log('[DASH-QUALITY] Setting quality to index:', nextLevel);
            dashRef.current.updateSettings({ streaming: { abr: { autoSwitchBitrate: { video: false } } } });
            if (typeof (dashRef.current as any).setRepresentationForTypeByIndex === 'function') {
              console.log('[DASH-QUALITY] Calling setRepresentationForTypeByIndex with index:', nextLevel);
              (dashRef.current as any).setRepresentationForTypeByIndex('video', nextLevel);
            } else {
              console.log('[DASH-QUALITY] Calling setQualityFor with level:', nextLevel);
              (dashRef.current as any).setQualityFor('video', nextLevel);
            }
          }
          setQuality(label);
        }
        return;
      }

      const currentAnimeAudioTrack = animeAudioTrackMapRef.current[selectedAudioTrackId];
      if (currentAnimeAudioTrack) {
        animeAudioTrackMapRef.current[selectedAudioTrackId] = {
          ...currentAnimeAudioTrack,
          selectedQuality: selectedOption.value
        };
      }

      if (nextValue === videoSrc && ((selectedOption as any).audioUrl || null) === audioSrc) {
        setQuality(label);
        return;
      }

      freezeFrame();
      autoPlayPendingRef.current = wasPlaying;
      pendingRetrySeekTimeRef.current = currentPos;
      setQuality(label);
      setOnlineLoadingText("");
      setIsOnlineLoading(true);

      const electron = getElectronApi();
      const shouldReResolveProtectedQuality = !!electron && !!originalSelectedValue;

      // Manifest-based streams need a harder reset before switching variants,
      // otherwise repeated HLS/DASH swaps can leave the playback pipeline stuck.
      if (currentIsManifest || nextIsManifest || shouldReResolveProtectedQuality) {
        try {
          hlsRef.current?.destroy();
        } catch { }
        hlsRef.current = null;

        try {
          dashRef.current?.reset();
        } catch { }
        dashRef.current = null;

        try {
          video.pause();
          video.removeAttribute('src');
          video.load();
        } catch { }

        try {
          if (audioRef.current) {
            audioRef.current.pause();
            audioRef.current.removeAttribute('src');
            audioRef.current.load();
          }
        } catch { }
      }

      if (shouldReResolveProtectedQuality) {
        // Only clear preserve flag when doing a full re-resolve via IPC,
        // since the response will replace the entire quality list anyway.
        preserveQualityOptionsRef.current = false;
        electron!.ipcRenderer.send('fetch-online-video', qualitySourceValue);
        return;
      }

      setVideoSrc(nextValue);
      setAudioSrc((selectedOption as any).audioUrl || null);
      return;
    }

    setQuality(label);
  };

  const requestYoutubeQualityRefresh = useCallback(() => {
    const electron = getElectronApi();
    const video = videoRef.current;
    if (!electron || !video || !isYoutubeStreamRef.current || !audioSrc) return false;
    if (youtubeRecoveryInFlightRef.current || youtubeQualitySwitchPendingRef.current) return false;

    const qualityId = selectedYoutubeQualityIdRef.current;
    if (!qualityId || qualityId === "Default") return false;

    youtubeRecoveryInFlightRef.current = true;
    youtubeQualitySwitchPendingRef.current = true;
    setVideoTitle(`Refreshing ${currentQualityLabelRef.current || quality}...`);
    electron.ipcRenderer.send("set-youtube-quality", {
      qualityId,
      currentTime: video.currentTime || 0,
    });
    return true;
  }, [audioSrc, quality]);

  const requestYoutubePreferredUpgrade = useCallback(() => {
    const electron = getElectronApi();
    const video = videoRef.current;
    const preferredQualityId = preferredYoutubeQualityIdRef.current;
    const currentQualityId = selectedYoutubeQualityIdRef.current;

    if (!electron || !video || !isYoutubeStreamRef.current) return false;
    if (!preferredQualityId || preferredQualityId === "Default") return false;
    if (!currentQualityId || currentQualityId === preferredQualityId) return false;
    if (youtubeQualitySwitchPendingRef.current || youtubeRecoveryInFlightRef.current) return false;

    youtubeAutoUpgradeDoneRef.current = true;
    youtubeQualitySwitchPendingRef.current = true;
    resumeAfterQualitySwitchRef.current = !video.paused && !video.ended;
    setVideoTitle(`Switching to ${currentQualityLabelRef.current || quality}...`);
    electron.ipcRenderer.send("set-youtube-quality", {
      qualityId: preferredQualityId,
      currentTime: video.currentTime || 0,
    });
    return true;
  }, [quality]);

  const videoSrcRef = useRef(videoSrc);
  useEffect(() => { videoSrcRef.current = videoSrc; }, [videoSrc]);

  const audioSrcRef = useRef(audioSrc);
  useEffect(() => { audioSrcRef.current = audioSrc; }, [audioSrc]);

  useEffect(() => {
    const video = videoRef.current as any;
    const currentVideoSrc = videoSrcRef.current;
    if (!video) return;

    const clearYoutubeRecoveryTimeout = () => {
      if (youtubeRecoveryTimeoutRef.current) {
        clearTimeout(youtubeRecoveryTimeoutRef.current);
        youtubeRecoveryTimeoutRef.current = null;
      }
    };

    const clearYoutubeAutoUpgradeTimer = () => {
      if (youtubeAutoUpgradeTimerRef.current) {
        clearTimeout(youtubeAutoUpgradeTimerRef.current);
        youtubeAutoUpgradeTimerRef.current = null;
      }
    };

    const scheduleYoutubePreferredUpgrade = () => {
      if (!isYoutubeStreamRef.current) return;
      if (youtubeAutoUpgradeDoneRef.current) return;
      if (youtubeQualitySwitchPendingRef.current || youtubeRecoveryInFlightRef.current) return;
      if (!preferredYoutubeQualityIdRef.current || preferredYoutubeQualityIdRef.current === "Default") return;
      if (preferredYoutubeQualityIdRef.current === selectedYoutubeQualityIdRef.current) {
        youtubeAutoUpgradeDoneRef.current = true;
        return;
      }
      if (video.paused || video.ended) return;

      clearYoutubeAutoUpgradeTimer();
      youtubeAutoUpgradeTimerRef.current = setTimeout(() => {
        youtubeAutoUpgradeTimerRef.current = null;
        const currentPosition = Number(video.currentTime || 0);
        const healthyPlayback = !video.paused && !video.ended && video.readyState >= 3 && currentPosition >= 8;
        if (!healthyPlayback) return;
        requestYoutubePreferredUpgrade();
      }, 3500);
    };

    const scheduleYoutubeRecovery = () => {
      if (
        !isYoutubeStreamRef.current ||
        youtubeQualitySwitchPendingRef.current ||
        youtubeRecoveryInFlightRef.current ||
        !audioSrcRef.current
      ) {
        return;
      }

      const stalledAt = Number(video.currentTime || 0);
      if (stalledAt < 20) return;

      clearYoutubeRecoveryTimeout();
      youtubeRecoveryTimeoutRef.current = setTimeout(() => {
        const currentPosition = Number(video.currentTime || 0);
        const hasNotProgressed = Math.abs(currentPosition - stalledAt) < 0.2;
        const isActuallyStalled =
          !video.paused && !video.ended && video.readyState < 2 && hasNotProgressed;

        if (isActuallyStalled) {
          requestYoutubeQualityRefresh();
        }
      }, 5000);
    };

    const updateTime = () => {
      if (frozenTimeRef.current === null) {
        setCurrentTime(video.currentTime);
      }
      syncSeparateAudio();
      clearYoutubeRecoveryTimeout();
      youtubeRecoveryInFlightRef.current = false;
      scheduleYoutubePreferredUpgrade();
      if (video.textTracks) {
        let textFound = false;
        for (let i = 0; i < video.textTracks.length; i++) {
          const track = video.textTracks[i];
          if (track.mode === "hidden" && track.activeCues && track.activeCues.length > 0) {
            const text = Array.from(track.activeCues).map((c: any) => c.text).join("\n");
            setEmbeddedSubtitleText(text);
            textFound = true;
            break;
          }
        }
        if (!textFound) setEmbeddedSubtitleText("");
      }
    };

    const updateSubtitleClock = () => {
      setCurrentTime((prev) => {
        const next = video.currentTime;
        return Math.abs(prev - next) > 0.01 ? next : prev;
      });

      if (video.textTracks) {
        let textFound = false;
        for (let i = 0; i < video.textTracks.length; i++) {
          const track = video.textTracks[i];
          if (track.mode === "hidden" && track.activeCues && track.activeCues.length > 0) {
            const text = Array.from(track.activeCues).map((c: any) => c.text).join("\n");
            setEmbeddedSubtitleText((prev) => (prev === text ? prev : text));
            textFound = true;
            break;
          }
        }
        if (!textFound) {
          setEmbeddedSubtitleText((prev) => (prev === "" ? prev : ""));
        }
      }
    };

    const stopSubtitleClock = () => {
      if (subtitleTimeRafRef.current != null) {
        cancelAnimationFrame(subtitleTimeRafRef.current);
        subtitleTimeRafRef.current = null;
      }
    };

    const startSubtitleClock = () => {
      stopSubtitleClock();
      const tick = () => {
        updateSubtitleClock();
        if (!video.paused && !video.ended) {
          subtitleTimeRafRef.current = requestAnimationFrame(tick);
        } else {
          subtitleTimeRafRef.current = null;
        }
      };
      subtitleTimeRafRef.current = requestAnimationFrame(tick);
    };

    const updateDuration = () => {
      setDuration(video.duration);
      if (video.duration === Infinity) {
        setIsYoutubeLive(true);
      }
    };

    const updateQualityText = () => {
      if (isYoutubeStreamRef.current) return;
      if (dashRef.current || hlsRef.current) return;

      // The qualityOptions array from the closure may be stale (length 1) even if DASH/HLS
      // has populated multiple bitrates in state. We must check the fresh prev state.
      setQualityOptions((prev) => {
        // If we already have multiple qualities, do NOT overwrite them with a fallback label.
        if (prev.length > 1) {
          return prev;
        }

        const height = video.videoHeight;
        let label = "Default";
        if (height > 0) {
          if (height >= 2000) label = "2160p";
          else if (height >= 1400) label = "1440p";
          else if (height >= 1000) label = "1080p";
          else if (height >= 700) label = "720p";
          else label = "480p";
        }

        // We only want to set Quality text if we are actually falling back
        setTimeout(() => setQuality((qPrev) => (qPrev === label ? qPrev : label)), 0);

        const currentFormat = format || "UND";
        if (prev.length === 1) {
          if (prev[0].label === label && prev[0].format === currentFormat) {
            return prev;
          }
          const existingValue = prev[0].value;
          const newValue = existingValue && existingValue !== "undefined" && existingValue !== "Default" && existingValue !== prev[0].label
            ? existingValue
            : (videoSrcRef.current || label);
          return [{ ...prev[0], label, value: newValue, format: currentFormat }];
        }
        return [{ label, value: videoSrcRef.current || label, format: currentFormat }];
      });
    };

    const updateTracks = () => {
      if (isDemuxedLocalFile) {
        return;
      }

      if (isYoutubeStreamRef.current) {
        return;
      }

      if (video.audioTracks) {
        const aTracks: { id: string; label: string; index: number; badge?: string | null; title?: string | null }[] = [];
        for (let i = 0; i < video.audioTracks.length; i++) {
          const track = video.audioTracks[i];
          const rawLabel = String(track.label || `Audio Track ${i + 1}`);
          aTracks.push({
            index: i,
            id: track.id || String(i),
            label: formatTrackLabel(rawLabel, track.language),
            badge: deriveLocalAudioBadge(track, rawLabel),
            title: buildLocalTrackTitle(rawLabel, track.language),
          });
          if (track.enabled) {
            setAudioTrack(aTracks[i].title || aTracks[i].label);
            setSelectedAudioTrackId(aTracks[i].id || String(i));
          }
        }
        if (aTracks.length > 0) setAvailableAudioTracks(aTracks);
      }
      if (video.textTracks) {
        const tTracks: { id: string; label: string; index: number; badge?: string | null; title?: string | null }[] = [];
        for (let i = 0; i < video.textTracks.length; i++) {
          const track = video.textTracks[i];
          if (track.kind === "subtitles" || track.kind === "captions") {
            const rawLabel = String(track.label || `Subtitle ${tTracks.length + 1}`);
            tTracks.push({
              index: i,
              id: track.id || String(i),
              label: formatTrackLabel(rawLabel, track.language),
              badge: deriveLocalSubtitleBadge(track, rawLabel),
              title: buildLocalTrackTitle(rawLabel, track.language),
            });
            if (track.mode === "showing") {
              track.mode = "hidden";
            }
          }
        }
        setAvailableTextTracks(tTracks);
      }
    };

    const onPlay = () => {
      setIsPlaying(true);
      startSubtitleClock();
      if (audioRef.current) {
        if (youtubeQualitySwitchPendingRef.current) {
          audioRef.current.pause();
          return;
        }
        syncSeparateAudio(true);
        audioRef.current.play().catch(() => { });
      }
    };
    const onPause = () => {
      setIsPlaying(false);
      stopSubtitleClock();
      clearYoutubeAutoUpgradeTimer();
      if (audioRef.current) audioRef.current.pause();
      if (playingWatchdogRef.current) { clearTimeout(playingWatchdogRef.current); playingWatchdogRef.current = null; }
    };
    const onEnded = () => {
      setIsPlaying(false);
      stopSubtitleClock();
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.currentTime = 0;
      }
      if (playingWatchdogRef.current) { clearTimeout(playingWatchdogRef.current); playingWatchdogRef.current = null; }
    };
    const onSeeking = () => {
      stopSubtitleClock();
      clearYoutubeAutoUpgradeTimer();
      setOnlineLoadingText("");
      setIsOnlineLoading(true);
      if (playingWatchdogRef.current) { clearTimeout(playingWatchdogRef.current); playingWatchdogRef.current = null; }
    };
    const onSeeked = () => {
      updateSubtitleClock();
      if (!video.paused && !video.ended) {
        startSubtitleClock();
      }
      syncSeparateAudio(true);

      // For progressive online streams: `seeked` fires when the single current frame is ready.
      // But if the video is supposed to be playing, it might still take several seconds to buffer
      // enough future frames to actually resume smoothly. We must keep the spinner visible until
      // `onPlaying` actually fires.
      if (!hlsRef.current && !dashRef.current) {
        const isOnline = /^https?:\/\//i.test(video.currentSrc || videoSrcRef.current || "");
        if (isOnline && !video.paused) {
          setIsOnlineLoading(true);
          // Progressive stream watchdog: ensure the spinner stays visible until playback ACTUALLY resumes.
          // DO NOT nudge currentTime for progressive streams, it aborts the HTTP request!
          if (seekWatchdogRef.current) clearTimeout(seekWatchdogRef.current);
          const ctAtSeeked = video.currentTime;

          const checkProgressiveSeek = () => {
            seekWatchdogRef.current = null;
            const v = videoRef.current;
            if (!v || v.paused || v.ended) {
              setIsOnlineLoading(false);
              return;
            }
            if (v.currentTime > ctAtSeeked + 0.15) {
              // Playback is actively advancing.
              setIsOnlineLoading(false);
              return;
            }
            // Still frozen waiting for data. Ensure spinner is on, and poll again.
            console.warn('[SEEK WATCHDOG] Still buffering after seek. Keeping spinner visible.');
            setIsOnlineLoading(true);
            seekWatchdogRef.current = setTimeout(checkProgressiveSeek, 500);
          };

          seekWatchdogRef.current = setTimeout(checkProgressiveSeek, 1500);
        } else {
          setIsOnlineLoading(false);
        }
      }

      // If we are frozen from a quality switch and the new frame just decoded, we can instantly
      // drop the freeze frame to reveal the new quality. By using `instant: true`, we bypass the
      // fade out to prevent crossfade "ghosting" or shaking caused by slight keyframe differences.
      if (youtubeQualitySwitchPendingRef.current) {
        if (!resumeAfterQualitySwitchRef.current) {
          youtubeQualitySwitchPendingRef.current = false;
          unfreezeFrame(true);
        }
      }
    };
    const onWaiting = () => {
      const isOnline = /^https?:\/\//i.test(video.currentSrc || videoSrcRef.current || "");
      if (video.paused && !isOnline) return;
      if (audioRef.current) audioRef.current.pause();
      // For DASH/manifest streams where audio plays through the video element,
      // freeze time immediately to stop audio from running ahead of stalled video.
      if (!audioSrcRef.current && video && bufferStallPlaybackRateRef.current === null) {
        bufferStallPlaybackRateRef.current = video.playbackRate;
        video.playbackRate = 0;
      }
      setIsOnlineLoading(true);
      setOnlineLoadingText("");
      scheduleYoutubeRecovery();

      // Generic stall recovery: if still buffering after 2 s, use flush-seek
      // to cancel the stale pending request without a full source reload.
      // Escalation: flush-seek → source reload (last resort).
      if (stallRecoveryTimerRef.current) clearTimeout(stallRecoveryTimerRef.current);
      const ctAtWaiting = video.currentTime;
      stallRecoveryTimerRef.current = setTimeout(() => {
        stallRecoveryTimerRef.current = null;
        const v = videoRef.current;
        if (!v || v.paused || v.ended) return;
        // Playhead moved — buffer refilled naturally. Not a real stall.
        if (v.currentTime > ctAtWaiting + 0.5) { if (!youtubeQualitySwitchPendingRef.current) setIsOnlineLoading(false); return; }
        if (v.readyState >= 3) { if (!youtubeQualitySwitchPendingRef.current) setIsOnlineLoading(false); return; }

        if (!dashRef.current && !hlsRef.current) {
          // Native progressive streams do not need stall recovery. 
          // Forcing a seek or source reload here aborts the active HTTP request and destroys buffering.
          return;
        }

        const ct = v.currentTime;
        const attempt = stallRecoveryAttemptRef.current;
        stallRecoveryAttemptRef.current = attempt + 1;

        if (attempt >= 3) {
          console.warn('[STALL RECOVERY] Max attempts reached, stopping');
          setIsOnlineLoading(false);
          stallRecoveryAttemptRef.current = 0;
          return;
        }

        if (attempt >= 2 && videoSrcRef.current && /^https?:\/\//i.test(v.currentSrc || videoSrcRef.current)) {
          // For DASH/HLS streams, NEVER do raw src assignment — it destroys the MSE pipeline.
          // Instead, use the library's seek to force segment re-fetch.
          if (dashRef.current) {
            console.log('[STALL RECOVERY] DASH seek recovery at', ct);
            try { dashRef.current.seek(ct); } catch { v.currentTime = ct; }
          } else if (hlsRef.current) {
            console.log('[STALL RECOVERY] HLS seek recovery at', ct);
            v.currentTime = ct;
          } else {
            console.log('[STALL RECOVERY] Source reload at', ct);
            pendingRetrySeekTimeRef.current = ct;
            autoPlayPendingRef.current = true;
            setOnlineLoadingText('Reconnecting...');
            v.src = videoSrcRef.current;
            v.load();
          }
        } else {
          // Zero-offset seek: re-set currentTime to the same position to force
          // Chromium to issue a fresh byte-range request without ever rendering
          // a frame from a different position (avoids ghost-frame flicker).
          console.log('[STALL RECOVERY] Zero-offset seek attempt', attempt + 1, 'at', ct);
          if (dashRef.current) {
            try { dashRef.current.seek(ct); } catch { v.currentTime = ct; }
          } else {
            v.currentTime = ct;
          }
        }
      }, video.readyState === 0 ? 20_000 : 2_000);
    };
    const onStalled = () => {
      const isOnline = /^https?:\/\//i.test(video.currentSrc || videoSrcRef.current || "");
      if (video.paused && !isOnline) return;
      if (audioRef.current) audioRef.current.pause();
      setIsOnlineLoading(true);
      setOnlineLoadingText("");
      scheduleYoutubeRecovery();

      if (stallRecoveryTimerRef.current) clearTimeout(stallRecoveryTimerRef.current);
      const ctAtStalled = video.currentTime;
      stallRecoveryTimerRef.current = setTimeout(() => {
        stallRecoveryTimerRef.current = null;
        const v = videoRef.current;
        if (!v || v.paused || v.ended) return;
        if (v.currentTime > ctAtStalled + 0.5) { if (!youtubeQualitySwitchPendingRef.current) setIsOnlineLoading(false); return; }
        if (v.readyState >= 3) { if (!youtubeQualitySwitchPendingRef.current) setIsOnlineLoading(false); return; }

        if (!dashRef.current && !hlsRef.current) {
          // Native progressive streams do not need stall recovery.
          // Forcing a seek or source reload here aborts the active HTTP request and destroys buffering.
          return;
        }

        const ct = v.currentTime;
        const attempt = stallRecoveryAttemptRef.current;
        stallRecoveryAttemptRef.current = attempt + 1;

        if (attempt >= 3) {
          console.warn('[STALL RECOVERY] Max attempts reached, stopping');
          setIsOnlineLoading(false);
          stallRecoveryAttemptRef.current = 0;
          return;
        }

        if (attempt >= 2 && videoSrcRef.current && /^https?:\/\//i.test(v.currentSrc || videoSrcRef.current)) {
          // For DASH/HLS streams, NEVER do raw src assignment — it destroys the MSE pipeline.
          if (dashRef.current) {
            console.log('[STALL RECOVERY] DASH seek recovery at', ct);
            try { dashRef.current.seek(ct); } catch { v.currentTime = ct; }
          } else if (hlsRef.current) {
            console.log('[STALL RECOVERY] HLS seek recovery at', ct);
            v.currentTime = ct;
          } else {
            console.log('[STALL RECOVERY] Source reload at', ct);
            pendingRetrySeekTimeRef.current = ct;
            autoPlayPendingRef.current = true;
            setOnlineLoadingText('Reconnecting...');
            v.src = videoSrcRef.current;
            v.load();
          }
        } else {
          console.log('[STALL RECOVERY] Zero-offset seek attempt', attempt + 1, 'at', ct);
          if (dashRef.current) {
            try { dashRef.current.seek(ct); } catch { v.currentTime = ct; }
          } else {
            v.currentTime = ct;
          }
        }
      }, video.readyState === 0 ? 20_000 : 3_000);
    };
    const onLoadedMetadata = () => {
      updateQualityText();
      updateTracks();
      if (!/^https?:\/\//i.test(video.currentSrc || videoSrcRef.current)) {
        setIsOnlineLoading(false);
      }
      if (pendingRetrySeekTimeRef.current !== null) {
        try {
          console.log("Restoring seek time to:", pendingRetrySeekTimeRef.current);
          video.currentTime = Math.min(pendingRetrySeekTimeRef.current, video.duration || 0);
        } catch (e) { }
        pendingRetrySeekTimeRef.current = null;
      }
      tryAutoPlay();
    };
    const onPlaying = () => {
      unfreezeFrame();
      // Restore playback rate if we froze it during a buffer stall
      if (bufferStallPlaybackRateRef.current !== null) {
        video.playbackRate = bufferStallPlaybackRateRef.current;
        bufferStallPlaybackRateRef.current = null;
      }
      // Stream recovered — cancel any pending stall-recovery seek
      if (stallRecoveryTimerRef.current) {
        clearTimeout(stallRecoveryTimerRef.current);
        stallRecoveryTimerRef.current = null;
      }
      if (seekWatchdogRef.current) {
        clearTimeout(seekWatchdogRef.current);
        seekWatchdogRef.current = null;
      }
      // Reset escalation counter since playback recovered successfully
      stallRecoveryAttemptRef.current = 0;
      clearYoutubeRecoveryTimeout();

      // For online streams, do NOT hide the spinner here. Chromium fires 'playing'
      // the instant it decodes a single GOP, even if it has nowhere near enough
      // buffered data to sustain smooth playback. The watchdog below will verify
      // that currentTime is genuinely advancing before hiding the spinner.
      const isOnlineStream = /^https?:\/\//i.test(video.currentSrc || videoSrcRef.current || "");
      if (!isOnlineStream) {
        setIsOnlineLoading(false);
      }

      if (stableVideoTitleRef.current) {
        setVideoTitle(stableVideoTitleRef.current);
      }
      if (youtubeQualitySwitchPendingRef.current) {
        youtubeQualitySwitchPendingRef.current = false;
      }
      youtubeRecoveryInFlightRef.current = false;
      if (audioRef.current) {
        syncSeparateAudio(true);
        audioRef.current.play().catch(() => { });
      }
      scheduleYoutubePreferredUpgrade();

      // Playback-verification watchdog: confirm currentTime is actually advancing
      // before hiding the spinner. For MSE streams (DASH/HLS), a frozen decoder
      // gets a nudge seek. For progressive streams, we just keep the spinner visible.
      if (playingWatchdogRef.current) clearTimeout(playingWatchdogRef.current);
      const ctAtPlaying = video.currentTime;

      const checkFrozenDecoder = () => {
        playingWatchdogRef.current = null;
        const v = videoRef.current;
        if (!v || v.paused || v.ended) {
          setIsOnlineLoading(false);
          return;
        }
        if (v.currentTime > ctAtPlaying + 0.15) {
          setIsOnlineLoading(false);
          return; // advancing normally — safe to hide spinner
        }

        if (hlsRef.current || dashRef.current) {
          // Frozen MSE stream — nudge the decoder past the gap
          console.warn('[PLAYING WATCHDOG] MSE frozen at', v.currentTime, '— nudging');
          v.currentTime += 0.5;
        } else {
          // Frozen progressive stream — browser prematurely fired 'playing' but
          // immediately starved without firing 'waiting'. DO NOT nudge (it aborts download).
          console.warn('[PLAYING WATCHDOG] Progressive frozen at', v.currentTime, '— keeping spinner');
          setIsOnlineLoading(true);
          playingWatchdogRef.current = setTimeout(checkFrozenDecoder, 500);
        }
      };

      // Short initial delay (300ms) so we verify quickly, then poll every 500ms if frozen.
      playingWatchdogRef.current = setTimeout(checkFrozenDecoder, isOnlineStream ? 300 : 1500);
    };
    const onCanPlay = () => {
      if (youtubeQualitySwitchPendingRef.current) return;
      unfreezeFrame();

      const isOnline = /^https?:\/\//i.test(video.currentSrc || videoSrcRef.current || "");
      if (video.paused || !isOnline) {
        setIsOnlineLoading(false);
      }

      tryAutoPlay();
    };
    const onCanPlayThrough = () => {
      if (youtubeQualitySwitchPendingRef.current) return;
      const isOnline = /^https?:\/\//i.test(video.currentSrc || videoSrcRef.current || "");
      if (video.paused || !isOnline) {
        setIsOnlineLoading(false);
      }
    };
    const onRateChange = () => {
      syncSeparateAudio();
    };
    const onVolumeChange = () => {
      if (!audioRef.current) return;
      audioRef.current.volume = video.volume;
      // If audioSrc is active, video is intentionally muted. Don't copy that mute state!
      if (!audioSrcRef.current) {
        audioRef.current.muted = video.muted;
      }
    };
    const onFullscreenChange = () => {
      setIsFullscreen(!!(document.fullscreenElement || (document as any).webkitFullscreenElement));
    };

    document.addEventListener("fullscreenchange", onFullscreenChange);
    document.addEventListener("webkitfullscreenchange", onFullscreenChange);

    video.addEventListener("timeupdate", updateTime);
    video.addEventListener("loadeddata", updateDuration);
    video.addEventListener("durationchange", updateDuration);
    video.addEventListener("loadedmetadata", onLoadedMetadata);
    video.addEventListener("canplay", onCanPlay);

    if (video.audioTracks) video.audioTracks.addEventListener("addtrack", updateTracks);
    if (video.textTracks) video.textTracks.addEventListener("addtrack", updateTracks);

    video.addEventListener("play", onPlay);
    video.addEventListener("pause", onPause);
    video.addEventListener("ended", onEnded);
    video.addEventListener("seeking", onSeeking);
    video.addEventListener("seeked", onSeeked);
    video.addEventListener("waiting", onWaiting);
    video.addEventListener("stalled", onStalled);
    video.addEventListener("playing", onPlaying);
    video.addEventListener("canplaythrough", onCanPlayThrough);
    video.addEventListener("ratechange", onRateChange);
    video.addEventListener("volumechange", onVolumeChange);

    if (video.readyState >= 1) {
      updateQualityText();
      updateTracks();
      updateSubtitleClock();
    }

    if (!video.paused && !video.ended) {
      startSubtitleClock();
    }

    const electron = getElectronApi();
    let handleTracksInfo: any;
    let handleExtractedCues: any;
    let handleTrackSwitched: any;
    let handleStreamReady: any;
    let handleStreamError: any;
    let handleLocalTrackError: any;

    if (electron) {
      handleTracksInfo = (_event: any, data: { audioTracks: any[]; subtitleTracks: any[] }) => {
        console.log("[IPC EVENT] media-tracks-info", data);
        if (data.audioTracks && data.audioTracks.length > 0) {
          const normalizedAudioTracks = data.audioTracks.map((track: any) => {
            const rawLabel = String(track.label || `Audio Track ${Number(track.index || 0) + 1}`);
            return {
              ...track,
              label: formatTrackLabel(rawLabel, track.language),
              badge: deriveLocalAudioBadge(track, rawLabel),
              title: buildLocalTrackTitle(rawLabel, track.language),
            };
          });
          setAvailableAudioTracks(normalizedAudioTracks);
          setAudioTrack(normalizedAudioTracks[0].title || normalizedAudioTracks[0].label || "Track 1");
          setSelectedAudioTrackId(String(normalizedAudioTracks[0].id || normalizedAudioTracks[0].index || "default"));
        }
        if (data.subtitleTracks && data.subtitleTracks.length > 0) {
          const normalizedSubtitleTracks = data.subtitleTracks.map((track: any) => {
            const rawLabel = String(track.label || `Subtitle ${Number(track.index || 0) + 1}`);
            return {
              ...track,
              label: formatTrackLabel(rawLabel, track.language),
              badge: deriveLocalSubtitleBadge(track, rawLabel),
              title: buildLocalTrackTitle(rawLabel, track.language),
            };
          });
          setAvailableTextTracks(normalizedSubtitleTracks);
        }
      };

      handleExtractedCues = (_event: any, cues: { start: number; end: number; text: string }[]) => {
        disableAssMode();
        setSubtitles(cues);
        setCaption("Custom");
      };

      handleTrackSwitched = (_event: any, data: { streamUrl: string; currentTime: number }) => {
        setIsOnlineLoading(false);
        setVideoSrc(data.streamUrl);
        if (videoRef.current) {
          videoRef.current.currentTime = data.currentTime;
          if (autoPlayPendingRef.current) {
            videoRef.current.play().catch(() => { });
          }
        }
      };

      handleStreamReady = async (_event: any, payload: any) => {
        // Guard: if the user switched to a local file, ignore stale stream responses
        if (!loadedUrlInputRef.current) return;
        disableAssMode();
        resetTrackUiState();
        setCaption("Off");
        setSelectedSubtitleLabel("Off");
        setSelectedSubtitleId("off");
        if (videoRef.current) {
          videoRef.current.pause();
          videoRef.current.src = "";
          videoRef.current.load();
        }
        if (hlsRef.current) {
          hlsRef.current.destroy();
          hlsRef.current = null;
        }
        if (dashRef.current) {
          dashRef.current.reset();
          dashRef.current = null;
        }
        pendingRetrySeekTimeRef.current = null;

        const streamUrl = typeof payload === "string" ? payload : payload?.url;
        const streamAudioUrl = typeof payload === "string" ? null : payload?.audioUrl || null;
        const streamTitle = typeof payload === "string" ? "Online Video" : payload?.title || "Online Video";
        const fallbackUrl = typeof payload === "string" ? null : payload?.fallbackUrl || null;
        if (!streamUrl) return;

        setStreamFormat(payload?.format || null);
        setStreamFileSize(payload?.fileSize || null);
        setStreamVideoCodec(payload?.videoCodec || null);
        setStreamAudioCodec(payload?.audioCodec || null);

        const nextDrmKeys = payload?.drmKeys || pendingDrmKeysForNextStreamRef.current || null;
        setStreamDrmKeys(nextDrmKeys);
        streamDrmKeysRef.current = nextDrmKeys;
        pendingDrmKeysForNextStreamRef.current = null;
        console.log('[IPC-DRM] Resolved drmKeys for stream:', streamDrmKeysRef.current ? JSON.stringify(streamDrmKeysRef.current) : 'NONE');

        if (payload?.disablePreview) {
          setPreviewDisabled(true);
        }

        const pendingSeekTime = pendingRetrySeekTimeRef.current;

        if (payload && typeof payload === "object" && Array.isArray(payload.albumFiles)) {
          setFolderFiles(payload.albumFiles);
          setFolderName(payload.albumName || "Album");
          const matchedFile = payload.albumFiles.find((f: any) => f.originalUrl === payload.url || f.url === streamUrl);
          if (matchedFile) {
            setSelectedFolder(matchedFile.id);
          } else {
            setSelectedFolder(payload.albumFiles[0].id);
          }
        } else {
          const pdTarget = parsePixeldrainUrl(loadedUrlInputRef.current);
          const isPdFolder = pdTarget && (pdTarget.type === 'album' || pdTarget.type === 'd_unknown' || pdTarget.type === 'folder_file');
          if (!isPdFolder) {
            setFolderFiles([]);
            setCurrentFolderId(null);
          }
        }

        if (isDrivePlaybackLike(loadedUrlInputRef.current)) {
          const derivedRetryUrls = getDriveRetryUrls(streamUrl);
          driveRetryUrlsRef.current = derivedRetryUrls.filter((url) => url !== streamUrl);
        }

        let finalTitle = streamTitle;
        if (plPlayingEntryId && activePlaylistId) {
          const pl = playlists.find(p => p.id === activePlaylistId);
          const entry = pl?.entries.find(e => e.id === plPlayingEntryId);
          if (entry && entry.name) {
            finalTitle = entry.name;
          }
        } else if (stableVideoTitleRef.current && stableVideoTitleRef.current !== "Awaiting Media Source" && (streamTitle === "Direct Stream" || streamTitle === "Online Video")) {
          // Fallback: If it's a generic title but we had a valid title before, preserve it
          finalTitle = stableVideoTitleRef.current;
        }

        setVideoSrc(streamUrl);
        setAudioSrc(streamAudioUrl);
        setVideoTitle(finalTitle);
        stableVideoTitleRef.current = finalTitle;

        const normalizedAnimeAudioTracks = Array.isArray(payload?.audioTracks)
          ? payload.audioTracks.map((track: any, index: number) => ({
            id: String(track?.id || `anime-audio-${index}`),
            index,
            label: String(track?.label || track?.title || `Track ${index + 1}`),
            title: String(track?.title || track?.label || `Track ${index + 1}`),
            badge: /dub/i.test(String(track?.kind || track?.label || '')) ? 'DUB' : 'SUB',
            url: typeof track?.url === 'string' ? track.url : null,
            selectedQuality: typeof track?.selectedQuality === 'string' ? track.selectedQuality : null,
            qualities: Array.isArray(track?.qualities)
              ? track.qualities.map((entry: any) => ({
                label: cleanQualityLabel(String(entry?.label || 'undefined')),
                value: String(entry?.value || track?.url || streamUrl),
                audioTrackId: String(entry?.audioTrackId || track?.id || `anime-audio-${index}`)
              })).filter((opt: any, index: number, self: any[]) => index === self.findIndex((t: any) => t.label === opt.label))
              : []
          }))
          : [];

        animeAudioTrackMapRef.current = Object.fromEntries(
          normalizedAnimeAudioTracks.map((track: any) => [track.id, track])
        );

        if (normalizedAnimeAudioTracks.length > 0) {
          setAvailableAudioTracks(normalizedAnimeAudioTracks);
          const selectedAudioTrack =
            normalizedAnimeAudioTracks.find((track: any) => track.id === String(payload?.selectedAudioTrackId || '')) ||
            normalizedAnimeAudioTracks.find((track: any) => track.url === streamUrl) ||
            normalizedAnimeAudioTracks[0];

          if (selectedAudioTrack) {
            setAudioTrack(selectedAudioTrack.title || selectedAudioTrack.label);
            setSelectedAudioTrackId(selectedAudioTrack.id);
            const trackQualities = Array.isArray(selectedAudioTrack.qualities) && selectedAudioTrack.qualities.length > 0
              ? selectedAudioTrack.qualities.map((q: any) => ({
                ...q,
                format: q.format || detectFormat(String(q.value || ''), String(q.label || ''))
              }))
              : [{ label: 'undefined', value: selectedAudioTrack.url || streamUrl, audioTrackId: selectedAudioTrack.id, format: 'UND' }];
            setQualityOptions(trackQualities);
            const matchingTrackQuality = trackQualities.find((opt: any) => opt.value === streamUrl) ||
              trackQualities.find((opt: any) => opt.value === selectedAudioTrack.selectedQuality) ||
              trackQualities[0];
            setQuality(matchingTrackQuality?.label || 'Default');
          }
        }

        const normalizedIncomingSubtitles = Array.isArray(payload?.subtitles)
          ? payload.subtitles
            .filter((sub: any) => sub && typeof sub.url === "string" && sub.url.trim())
            .map((sub: any) => normalizeOnlineSubtitleEntry(sub))
          : [];
        setExtractedSubtitles(normalizedIncomingSubtitles);
        defaultExtractedSubtitleUrlRef.current = typeof payload?.defaultSubtitleUrl === "string"
          ? String(payload.defaultSubtitleUrl)
          : null;
        if (normalizedIncomingSubtitles.length > 0) {
          const preferredSubtitle = pickPreferredExtractedSubtitle(normalizedIncomingSubtitles);
          if (preferredSubtitle) {
            void loadExtractedSubtitle(preferredSubtitle).catch((error) => {
              console.error("Failed to auto-load preferred extracted subtitle", error);
            });
          }
        }

        if (normalizedAnimeAudioTracks.length === 0) {
          if (payload?.qualities && Array.isArray(payload.qualities)) {
            const filtered = payload.qualities.filter((q: any) => {
              const val = q.value || q.url || '';
              return !val.includes('blank.mp4') && !val.includes('cdn.plyr.io/static/blank');
            });
            const qOpts = filtered.map((q: any) => {
              const url = String(q.value || q.videoUrl || q.url || streamUrl);
              const rawLabel = String(q.label || "undefined");
              return {
                label: cleanQualityLabel(rawLabel),
                value: url,
                audioUrl: q.audioUrl || null,
                format: detectFormat(url, rawLabel, q.format || payload.format)
              };
            }).filter((opt: any, index: number, self: any[]) => index === self.findIndex((t: any) => t.label === opt.label));
            setQualityOptions(qOpts);

            if (qOpts.length > 1) {
              preserveQualityOptionsRef.current = true;
            } else {
              preserveQualityOptionsRef.current = false;
            }

            const classifyQualityLabel = (text: string) => {
              const value = String(text || '').toLowerCase();
              if (/2160p|\b4k\b/.test(value)) return 2160;
              if (/1440p|\b2k\b/.test(value)) return 1440;
              if (/1080p/.test(value)) return 1080;
              if (/720p/.test(value)) return 720;
              if (/480p/.test(value)) return 480;
              if (/360p/.test(value)) return 360;
              if (/240p/.test(value)) return 240;
              return 0;
            };

            const sortedQOpts = [...qOpts].sort((a, b) => classifyQualityLabel(b.label) - classifyQualityLabel(a.label));

            const findQualityByValue = (value: string) => qOpts.find((opt: any) => opt.value === value);
            const findQualityByLabel = (label: string) => qOpts.find((opt: any) => opt.label === label);

            if (payload?.selectedQuality) {
              const selectedByValue = findQualityByValue(payload.selectedQuality);
              if (selectedByValue) {
                selectedQualityValueRef.current = selectedByValue.value;
                setQuality(selectedByValue.label);
              } else {
                const selectedByLabel = findQualityByLabel(payload.selectedQuality);
                if (selectedByLabel) {
                  selectedQualityValueRef.current = selectedByLabel.value;
                  setQuality(selectedByLabel.label);
                }
              }
            } else {
              const matching = qOpts.find((opt: any) => opt.value === streamUrl);
              if (matching) {
                selectedQualityValueRef.current = matching.value;
                setQuality(matching.label);
              } else if (sortedQOpts.length > 0) {
                selectedQualityValueRef.current = sortedQOpts[0].value;
                setQuality(sortedQOpts[0].label);
              } else {
                selectedQualityValueRef.current = "Default";
                setQuality("Default");
                setFormat("UND");
              }
            }
          } else {
            setQualityOptions([{ label: "undefined", value: "undefined", format: "UND" }]);
            selectedQualityValueRef.current = "undefined";
            setQuality("undefined");
          }
        }

        const isPixeldrainPayload = isPixelDrainUrl(String(streamUrl || "")) || /\/pixeldrain-(stream|folder-stream)\b/i.test(String(streamUrl || ""));
        const incomingRetryUrls = !isPixeldrainPayload && Array.isArray(payload?.retryUrls)
          ? payload.retryUrls.filter((u: string) => typeof u === "string" && u.trim())
          : [];
        const mergedRetries = [...incomingRetryUrls];
        if (!isPixeldrainPayload && fallbackUrl) mergedRetries.push(fallbackUrl);
        streamRetryUrlsRef.current = mergedRetries.filter(
          (u, i, arr) => !!u && u !== streamUrl && arr.indexOf(u) === i
        );
        driveProxyRetryUrlRef.current = fallbackUrl;
        setIsYoutubeStream(false);
        isYoutubeStreamRef.current = false;
        setIsYoutubeLive(!!payload?.isLive);
        setFormat(payload?.format || 'UND');
        setIsPlaying(true);
        autoPlayPendingRef.current = true;
        if (videoRef.current) {
          const restorePendingSeek = () => {
            if (pendingSeekTime !== null && videoRef.current) {
              try {
                console.log("Restoring seek time to:", pendingSeekTime);
                videoRef.current.currentTime = Math.min(
                  pendingSeekTime,
                  videoRef.current.duration || pendingSeekTime
                );
              } catch { }
              pendingRetrySeekTimeRef.current = null;
            }
            videoRef.current?.removeEventListener("loadedmetadata", restorePendingSeek);
          };

          videoRef.current.addEventListener("loadedmetadata", restorePendingSeek);
          videoRef.current.src = streamUrl;
          videoRef.current.load();
          tryAutoPlay();
        }
      };

      handleStreamError = (_event: any, data: { message?: string }) => {
        preserveQualityOptionsRef.current = false;
        const message = data?.message || "Unable to load this URL.";
        youtubeQualitySwitchPendingRef.current = false;
        youtubeRecoveryInFlightRef.current = false;
        setIsOnlineLoading(false);
        setVideoSrc("");
        setAudioSrc(null);
        driveProxyRetryUrlRef.current = null;
        streamRetryUrlsRef.current = [];
        setIsPlaying(false);
        setVideoTitle(message);
        setIsYoutubeStream(false);
        setFormat("UND");
        isYoutubeStreamRef.current = false;
      };

      handleLocalTrackError = (_event: any, data: { message?: string }) => {
        const message = data?.message || "Failed to switch local track.";
        console.error("[LOCAL TRACK ERROR]", message);
        setIsOnlineLoading(false);
        setVideoTitle(message);
      };

      electron.ipcRenderer.on("capture-progress", (_event: any, data: { message: string }) => {
        setVideoTitle(data.message);
        setOnlineLoadingText(data.message);
      });

      electron.ipcRenderer.on("media-tracks-info", handleTracksInfo);
      electron.ipcRenderer.on("extracted-subtitles", handleExtractedCues);
      electron.ipcRenderer.on("audio-track-switched", handleTrackSwitched);
      electron.ipcRenderer.on("media-stream-ready", handleStreamReady);
      electron.ipcRenderer.on("stream-error", handleStreamError);
      electron.ipcRenderer.on("local-track-error", handleLocalTrackError);

      electron.ipcRenderer.on("youtube-stream-ready", (_event: any, data: any) => {
        // Guard: if the user switched to a local file, ignore stale stream responses
        if (!loadedUrlInputRef.current) return;
        console.log("youtube-stream-ready", data);
        const streamUrl = data?.url || (typeof data === "string" ? data : "");
        const transport = String(data?.transport || "direct");
        const isManifestTransport = transport === "dash-manifest" || transport === "hls-manifest" || isDashLikeUrl(streamUrl) || isHlsLikeUrl(streamUrl);
        const aUrl = isManifestTransport ? null : (data?.audioUrl || null);
        const title = data?.title || "YouTube Video";
        if (!streamUrl) return;

        setCaption("Off");
        setSelectedSubtitleLabel("Off");
        setSelectedSubtitleId("off");

        const normalizedQualities = normalizeYoutubeQualityOptions(data?.qualities);
        const normalizedIncomingSubtitles = Array.isArray(data?.subtitles)
          ? data.subtitles
            .filter((sub: any) => sub && typeof sub.url === "string" && sub.url.trim())
            .map((sub: any) => normalizeOnlineSubtitleEntry(sub))
          : [];

        const normalizedYoutubeAudioTracks = Array.isArray(data?.audioTracks)
          ? data.audioTracks.map((track: any, index: number) => ({
            id: String(track?.id || `yt-audio-${index}`),
            index,
            label: String(track?.label || track?.title || `Track ${index + 1}`),
            title: String(track?.title || track?.label || `Track ${index + 1}`),
            badge: track?.badge || (/dub/i.test(String(track?.kind || track?.label || '')) ? 'DUB' : 'SUB'),
            url: typeof track?.url === 'string' ? track.url : null,
            isMissingPot: !!track?.isMissingPot,
            selectedQuality: typeof track?.selectedQuality === 'string' ? track.selectedQuality : null,
            qualities: Array.isArray(track?.qualities)
              ? track.qualities.map((entry: any) => ({
                label: entry.label || "Source",
                value: entry.value || entry.url || "",
                audioTrackId: entry.audioTrackId || track?.id
              }))
              : []
          }))
          : [];

        setVideoSrc(streamUrl);
        setAudioSrc(aUrl);
        setVideoTitle(title);
        stableVideoTitleRef.current = title;
        setIsYoutubeStream(true);
        isYoutubeStreamRef.current = true;
        setIsYoutubeLive(!!data?.isLive);
        setIsPlaying(true);
        setQualityOptions(normalizedQualities);
        setExtractedSubtitles(normalizedIncomingSubtitles);
        setAvailableAudioTracks(normalizedYoutubeAudioTracks);
        defaultExtractedSubtitleUrlRef.current = typeof data?.defaultSubtitleUrl === "string"
          ? String(data.defaultSubtitleUrl)
          : null;

        if (normalizedIncomingSubtitles.length > 0) {
          const preferredSubtitle = pickPreferredExtractedSubtitle(normalizedIncomingSubtitles);
          if (preferredSubtitle) {
            void loadExtractedSubtitle(preferredSubtitle).catch((error) => {
              console.error("Failed to auto-load preferred extracted subtitle", error);
            });
          }
        }

        youtubeAutoUpgradeDoneRef.current = false;
        if (youtubeAutoUpgradeTimerRef.current) {
          clearTimeout(youtubeAutoUpgradeTimerRef.current);
          youtubeAutoUpgradeTimerRef.current = null;
        }

        if (data?.selectedQuality) {
          const selectedQualityValue = String(data.selectedQuality);
          selectedYoutubeQualityIdRef.current = selectedQualityValue;
          selectedQualityValueRef.current = selectedQualityValue;
          const selected = normalizedQualities.find((opt) => opt.value === selectedQualityValue);
          const nextLabel = selected?.label || selectedQualityValue;
          currentQualityLabelRef.current = nextLabel;
          setQuality(nextLabel);
        } else {
          selectedYoutubeQualityIdRef.current = normalizedQualities[0]?.value || "Default";
          selectedQualityValueRef.current = normalizedQualities[0]?.value || "Default";
          currentQualityLabelRef.current = normalizedQualities[0]?.label || "Default";
          setQuality(normalizedQualities[0]?.label || "Default");
        }

        preferredYoutubeQualityIdRef.current = String(data?.preferredQuality || data?.selectedQuality || normalizedQualities[0]?.value || "Default");
        if (preferredYoutubeQualityIdRef.current === selectedYoutubeQualityIdRef.current) {
          youtubeAutoUpgradeDoneRef.current = true;
        }

        if (videoRef.current) {
          videoRef.current.preload = "auto";
          if (!isManifestTransport) {
            videoRef.current.src = streamUrl;
            videoRef.current.load();
          }
        }
        if (aUrl && audioRef.current) {
          audioRef.current.preload = "auto";
          audioRef.current.src = aUrl;
          audioRef.current.load();
        }
        autoPlayPendingRef.current = true;
        if (!isManifestTransport) {
          tryAutoPlay();
        }
      });
    }

    return () => {
      clearYoutubeAutoUpgradeTimer();
      if (electron) {
        electron.ipcRenderer.removeListener("media-tracks-info", handleTracksInfo);
        electron.ipcRenderer.removeListener("extracted-subtitles", handleExtractedCues);
        electron.ipcRenderer.removeListener("audio-track-switched", handleTrackSwitched);
        electron.ipcRenderer.removeListener("media-stream-ready", handleStreamReady);
        electron.ipcRenderer.removeListener("stream-error", handleStreamError);
        electron.ipcRenderer.removeAllListeners("capture-progress");
        electron.ipcRenderer.removeAllListeners("youtube-stream-ready");
      }
      video.removeEventListener("timeupdate", updateTime);
      video.removeEventListener("loadeddata", updateDuration);
      video.removeEventListener("durationchange", updateDuration);
      video.removeEventListener("loadedmetadata", onLoadedMetadata);
      video.removeEventListener("canplay", onCanPlay);
      video.removeEventListener("play", onPlay);
      clearYoutubeRecoveryTimeout();
      if (stallRecoveryTimerRef.current) {
        clearTimeout(stallRecoveryTimerRef.current);
        stallRecoveryTimerRef.current = null;
      }
      if (playingWatchdogRef.current) {
        clearTimeout(playingWatchdogRef.current);
        playingWatchdogRef.current = null;
      }
      video.removeEventListener("pause", onPause);
      video.removeEventListener("ended", onEnded);
      video.removeEventListener("seeking", onSeeking);
      video.removeEventListener("seeked", onSeeked);
      video.removeEventListener("waiting", onWaiting);
      video.removeEventListener("stalled", onStalled);
      video.removeEventListener("playing", onPlaying);
      video.removeEventListener("canplaythrough", onCanPlayThrough);
      video.removeEventListener("ratechange", onRateChange);
      video.removeEventListener("volumechange", onVolumeChange);
      if (video.audioTracks) video.audioTracks.removeEventListener("addtrack", updateTracks);
      if (video.textTracks) video.textTracks.removeEventListener("addtrack", updateTracks);
      document.removeEventListener("fullscreenchange", onFullscreenChange);
      document.removeEventListener("webkitfullscreenchange", onFullscreenChange);
      stopSubtitleClock();
    };
  }, [tryAutoPlay, requestYoutubeQualityRefresh, stableHandleVideoError, resetTrackUiState]);

  useEffect(() => {
    const electron = getElectronApi();
    if (!electron) return;

    const onYoutubeQualitySwitched = (_event: any, data: any) => {
      console.log("youtube-quality-switched", data);
      const streamUrl = data?.url || "";
      const transport = String(data?.transport || "direct");
      const isManifestTransport = transport === "dash-manifest" || transport === "hls-manifest" || isDashLikeUrl(streamUrl) || isHlsLikeUrl(streamUrl);
      const aUrl = isManifestTransport ? null : (data?.audioUrl || null);
      const seekTime = Number(data?.currentTime || 0);
      if (!streamUrl) return;

      // Always restore seek time via the central HTML5 loadedmetadata handler
      pendingRetrySeekTimeRef.current = seekTime;

      const normalizedQualities = normalizeYoutubeQualityOptions(data?.qualities);

      const normalizedYoutubeAudioTracks = Array.isArray(data?.audioTracks)
        ? data.audioTracks.map((track: any, index: number) => ({
          id: String(track?.id || `yt-audio-${index}`),
          index,
          label: String(track?.label || track?.title || `Track ${index + 1}`),
          title: String(track?.title || track?.label || `Track ${index + 1}`),
          badge: track?.badge || (/dub/i.test(String(track?.kind || track?.label || '')) ? 'DUB' : 'SUB'),
          url: typeof track?.url === 'string' ? track.url : null,
          isMissingPot: !!track?.isMissingPot,
          selectedQuality: typeof track?.selectedQuality === 'string' ? track.selectedQuality : null,
          qualities: Array.isArray(track?.qualities)
            ? track.qualities.map((entry: any) => ({
              label: entry.label || "Source",
              value: entry.value || entry.url || "",
              audioTrackId: entry.audioTrackId || track?.id
            }))
            : []
        }))
        : [];

      youtubeQualitySwitchPendingRef.current = true;

      // Reset the HLS/DASH instances synchronously to clear internal browser source buffers
      // before setting the state variables, just like other manifest-based online videos do.
      if (isManifestTransport) {
        try {
          hlsRef.current?.destroy();
        } catch { }
        hlsRef.current = null;

        try {
          dashRef.current?.reset();
        } catch { }
        dashRef.current = null;

        if (videoRef.current) {
          try {
            videoRef.current.removeAttribute('src');
            videoRef.current.load();
          } catch { }
        }
      }

      setVideoSrc(streamUrl);
      setAudioSrc(aUrl);
      setIsYoutubeStream(true);
      isYoutubeStreamRef.current = true;
      setIsYoutubeLive(!!data?.isLive);
      setIsPlaying(resumeAfterQualitySwitchRef.current);
      setQualityOptions(normalizedQualities);
      if (normalizedYoutubeAudioTracks.length > 0) {
        setAvailableAudioTracks(normalizedYoutubeAudioTracks);
      }

      youtubeAutoUpgradeDoneRef.current = true;
      if (youtubeAutoUpgradeTimerRef.current) {
        clearTimeout(youtubeAutoUpgradeTimerRef.current);
        youtubeAutoUpgradeTimerRef.current = null;
      }

      if (data?.selectedQuality) {
        const selectedQualityValue = String(data.selectedQuality);
        selectedYoutubeQualityIdRef.current = selectedQualityValue;
        selectedQualityValueRef.current = selectedQualityValue;
        preferredYoutubeQualityIdRef.current = selectedQualityValue;
        const selected = normalizedQualities.find((opt) => opt.value === selectedQualityValue);
        const nextLabel = selected?.label || selectedQualityValue;
        currentQualityLabelRef.current = nextLabel;
        setQuality(nextLabel);
      }

      const videoEl = videoRef.current;
      if (!videoEl) return;

      // Synchronously configure separate audio track properties so they are ready for event listeners
      if (audioRef.current) {
        audioRef.current.pause();
        if (aUrl) {
          audioRef.current.src = aUrl;
          audioRef.current.load();
          audioRef.current.playbackRate = videoEl.playbackRate || playbackSpeed;
        } else {
          audioRef.current.removeAttribute("src");
          audioRef.current.load();
        }
      }

      // Synchronously mute the video if a separate audio track is present
      videoEl.muted = aUrl ? true : isMuted;
      videoEl.preload = "auto";

      // For non-manifest progressive transports, we need to imperatively assign
      // the new source and trigger load, letting standard HTML5 'canplay'/'playing'
      // event listeners seamlessly trigger unfreezeFrame() and tryAutoPlay().
      if (!isManifestTransport) {
        videoEl.src = streamUrl;
        videoEl.load();
      }
    };

    const onStreamError = (_event: any, data: any) => {
      preserveQualityOptionsRef.current = false;
      const message = data?.message || "Failed to load this online URL.";
      youtubeQualitySwitchPendingRef.current = false;
      youtubeRecoveryInFlightRef.current = false;
      unfreezeFrame();
      setIsPlaying(false);
      setVideoSrc("");
      setAudioSrc(null);
      streamRetryUrlsRef.current = [];
      setIsYoutubeStream(false);
      isYoutubeStreamRef.current = false;
      setVideoTitle(message);
      setQuality("Default");
      setFormat("UND");
      setQualityOptions([{ label: "Default", value: "Default" }]);
    };

    // Fired while main process runs Playwright to resolve a MISSING POT dubbed URL.
    // freezeFrame() is already active from handleAudioTrackChange — just log.
    const onYoutubeAudioResolving = (_event: any, data: any) => {
      console.log("[YT-AUDIO] Resolving dubbed track via Playwright:", data?.trackLabel);
    };

    // Fired when Playwright resolution failed. Restore playback and show brief error.
    const onYoutubeAudioUnavailable = (_event: any, data: any) => {
      console.warn("[YT-AUDIO] Dubbed track unavailable:", data?.reason, data?.trackLabel);
      unfreezeFrame();
      autoPlayPendingRef.current = resumeAfterQualitySwitchRef.current;
      tryAutoPlay();
      const msg = data?.reason === 'pot_resolution_failed'
        ? `⚠ Could not load "${data?.trackLabel || 'Dubbed track'}" — try again`
        : `⚠ "${data?.trackLabel || 'Dubbed track'}" is not available`;
      setVideoTitle(msg);
      setTimeout(() => setVideoTitle((prev: string) => (prev === msg ? "" : prev)), 4000);
    };

    electron.ipcRenderer.on("youtube-quality-switched", onYoutubeQualitySwitched);
    electron.ipcRenderer.on("stream-error", onStreamError);
    electron.ipcRenderer.on("youtube-audio-resolving", onYoutubeAudioResolving);
    electron.ipcRenderer.on("youtube-audio-unavailable", onYoutubeAudioUnavailable);

    return () => {
      electron.ipcRenderer.removeListener("youtube-quality-switched", onYoutubeQualitySwitched);
      electron.ipcRenderer.removeListener("stream-error", onStreamError);
      electron.ipcRenderer.removeListener("youtube-audio-resolving", onYoutubeAudioResolving);
      electron.ipcRenderer.removeListener("youtube-audio-unavailable", onYoutubeAudioUnavailable);
    };
  }, [tryAutoPlay, audioSrc, playbackSpeed]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        isSettingsOpen &&
        settingsMenuRef.current &&
        !settingsMenuRef.current.contains(e.target as Node) &&
        settingsBtnRef.current &&
        !settingsBtnRef.current.contains(e.target as Node)
      ) {
        setIsSettingsOpen(false);
        setActiveSubmenu(null);
      }
    };
    document.addEventListener("click", handleClickOutside);
    return () => document.removeEventListener("click", handleClickOutside);
  }, [isSettingsOpen]);

  const handleRetryDownload = useCallback((downloadId: string) => {
    const electron = getElectronApi();
    const info = dlProgress[downloadId];
    if (!electron?.ipcRenderer || !info) return;

    if (!info.url && !info.pageUrl) {
      console.error("[RETRY] Cannot retry: Missing URL metadata", info);
      return;
    }

    setDlProgress((prev) => ({
      ...prev,
      [downloadId]: {
        ...prev[downloadId],
        percent: 0,
        speed: "",
        downloaded: "0 B",
        total: "?",
        status: "downloading",
        isMerging: false,
        errorMessage: undefined,
        startTime: Date.now()
      }
    }));

    electron.ipcRenderer.send("start-download", {
      downloadId,
      url: info.url,
      audioUrl: info.audioUrl,
      pageUrl: info.pageUrl,
      qualityLabel: info.qualityLabel,
      fileName: info.fileName,
      savePath: dlSavePath,
      threads: dlThreads
    });
  }, [dlProgress, dlSavePath]);

  // ── Download IPC listeners ──
  useEffect(() => {
    const electron = getElectronApi();
    if (!electron?.ipcRenderer) return;

    const handleDlProgress = (_event: any, data: any) => {
      const id = String(data?.downloadId || "");
      if (!id) return;
      setDlProgress((prev) => {
        const existing = prev[id];

        // Ignore progress events for downloads that are no longer active
        if (!existing) return prev;
        if (existing.status === "paused" || existing.status === "error" || existing.status === "complete") {
          return prev;
        }

        const newPercent = Math.min(100, Math.max(0, Math.round(Number(data?.percent || 0))));
        // Preserve LIVE state: once a download is marked as live, keep it live
        const isLiveDownload = data?.isLive || data?.total === 'LIVE' || existing?.total === 'LIVE';
        return {
          ...prev,
          [id]: {
            ...(existing || { fileName: "", label: "" }),
            startTime: existing?.startTime || Date.now(),
            percent: existing ? Math.max(existing.percent, newPercent) : newPercent,
            speed: String(data?.speed || ""),
            downloaded: String(data?.downloaded || "0 B"),
            total: isLiveDownload ? 'LIVE' : String(data?.total || "?"),
            status: "downloading" as const,
            isMerging: existing?.isMerging || !!data.isMerging,
            fileName: existing?.fileName || String(data?.fileName || ""),
            label: existing?.label || "",
          }
        };
      });
    };

    const handleDlComplete = (_event: any, data: any) => {
      const id = String(data?.downloadId || "");
      if (!id) return;
      setDlProgress((prev) => ({
        ...prev,
        [id]: {
          ...(prev[id] || { fileName: "", label: "", speed: "", downloaded: "", total: "" }),
          percent: 100,
          status: "complete" as const,
          isMerging: false,
          fileName: prev[id]?.fileName || String(data?.fileName || ""),
          label: prev[id]?.label || "",
          filePath: data?.filePath || prev[id]?.filePath || "",
          // Show final file size if available (especially important for live recordings)
          downloaded: data?.size || prev[id]?.downloaded || "",
          total: data?.size || prev[id]?.total || "",
        }
      }));
    };

    const handleDlError = (_event: any, data: any) => {
      const id = String(data?.downloadId || "");
      if (!id) return;
      setDlProgress((prev) => ({
        ...prev,
        [id]: {
          ...(prev[id] || { fileName: "", label: "", speed: "", downloaded: "", total: "", percent: 0 }),
          status: "error" as const,
          isMerging: false,
          errorMessage: String(data?.message || "Error"),
          fileName: prev[id]?.fileName || String(data?.fileName || ""),
          label: prev[id]?.label || "",
        }
      }));
    };

    const handleDlPaused = (_event: any, data: any) => {
      const id = String(data?.downloadId || "");
      if (!id) return;
      setDlProgress((prev) => ({
        ...prev,
        [id]: {
          ...(prev[id] || { fileName: "", label: "", speed: "", downloaded: "", total: "", percent: 0 }),
          status: "paused" as const,
          isMerging: false,
        }
      }));
    };

    const handleDlCancelled = (_event: any, data: any) => {
      const id = String(data?.downloadId || "");
      if (!id) return;
      setDlProgress((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    };

    electron.ipcRenderer.on("download-progress", handleDlProgress);
    electron.ipcRenderer.on("download-complete", handleDlComplete);
    electron.ipcRenderer.on("download-error", handleDlError);
    electron.ipcRenderer.on("download-paused", handleDlPaused);
    electron.ipcRenderer.on("download-cancelled", handleDlCancelled);

    return () => {
      electron.ipcRenderer.removeListener("download-progress", handleDlProgress);
      electron.ipcRenderer.removeListener("download-complete", handleDlComplete);
      electron.ipcRenderer.removeListener("download-error", handleDlError);
      electron.ipcRenderer.removeListener("download-paused", handleDlPaused);
      electron.ipcRenderer.removeListener("download-cancelled", handleDlCancelled);
    };
  }, []);

  useEffect(() => {
    if (audioDriftIntervalRef.current) {
      clearInterval(audioDriftIntervalRef.current);
      audioDriftIntervalRef.current = null;
    }

    if (!audioSrc || !isPlaying) return;
  }, [audioSrc, isPlaying]);

  useEffect(() => {
    return () => {
      const canPlayRetryHandler = previewCanPlayRetryHandlerRef.current;
      if (canPlayRetryHandler && previewVideoRef.current) {
        previewVideoRef.current.removeEventListener("canplay", canPlayRetryHandler);
        previewCanPlayRetryHandlerRef.current = null;
      }
      if (statusHideTimeoutRef.current) {
        clearTimeout(statusHideTimeoutRef.current);
        statusHideTimeoutRef.current = null;
      }
      if (settingsCloseTimeoutRef.current) {
        clearTimeout(settingsCloseTimeoutRef.current);
        settingsCloseTimeoutRef.current = null;
      }
    };
  }, []);

  const toggleMute = () => {
    if (!videoRef.current) return;
    const newMuted = !isMuted;
    setIsMuted(newMuted);
    videoRef.current.muted = newMuted;
    if (!newMuted && volume === 0) {
      setVolume(0.5);
      videoRef.current.volume = 0.5;
    }
  };

  const applyVolume = useCallback((nextRawVolume: number) => {
    const nextVolume = Math.max(0, Math.min(1, nextRawVolume));
    const shouldMute = nextVolume === 0;

    setVolume(nextVolume);
    setIsMuted(shouldMute);

    if (videoRef.current) {
      videoRef.current.volume = nextVolume;
      // If audio proxy is active, the video MUST remain muted
      videoRef.current.muted = audioSrc ? true : shouldMute;
    }

    if (audioRef.current) {
      audioRef.current.volume = nextVolume;
      audioRef.current.muted = shouldMute;
    }
  }, [audioSrc]);

  useEffect(() => {
    const video = videoRef.current;
    if (video) {
      // If we are using the audio proxy (audioSrc is present), force mute the video
      // so the native embedded audio track doesn't overlap with the proxy audio.
      video.muted = audioSrc ? true : isMuted;
      video.volume = volume;
    }

    const audio = audioRef.current;
    if (audio) {
      audio.muted = isMuted;
      audio.volume = volume;
    }
  }, [isMuted, volume, videoSrc, audioSrc]);

  const toggleFullscreen = async () => {
    try {
      if (!document.fullscreenElement && !(document as any).webkitFullscreenElement) {
        if (containerRef.current?.requestFullscreen) {
          await containerRef.current.requestFullscreen();
        } else if ((containerRef.current as any)?.webkitRequestFullscreen) {
          await (containerRef.current as any).webkitRequestFullscreen();
        }
      } else if (document.exitFullscreen) {
        await document.exitFullscreen();
      } else if ((document as any).webkitExitFullscreen) {
        await (document as any).webkitExitFullscreen();
      }
    } catch { }
  };

  const togglePip = async () => {
    try {
      const electron = getElectronApi();
      if (electron?.ipcRenderer?.send) {
        const entering = !isCustomPipActive;
        const video = videoRef.current;
        const videoWidth = video?.videoWidth || 1920;
        const videoHeight = video?.videoHeight || 1080;
        electron.ipcRenderer.send('toggle-custom-pip', entering, videoWidth, videoHeight);
      }
    } catch { }
  };

  const changeSpeed = (speed: number) => {
    setPlaybackSpeed(speed);
    if (videoRef.current) videoRef.current.playbackRate = speed;
    if (audioRef.current) audioRef.current.playbackRate = speed;
  };

  const syncSeparateAudio = useCallback((hardSync = false) => {
    const video = videoRef.current;
    const audio = audioRef.current;
    if (!video || !audio || !audioSrcRef.current) return;

    // Check if the video is stalling/buffering (playhead not advancing during playback)
    const now = Date.now();
    const currentVideoTime = video.currentTime;

    let isStalled = false;

    if (!video.paused && !video.ended) {
      if (lastVideoProgressRef.current) {
        const timeDiff = now - lastVideoProgressRef.current.timestamp;
        const progressDiff = currentVideoTime - lastVideoProgressRef.current.currentTime;

        // If 200ms+ has elapsed in wall clock time, but the playhead has advanced less than 30ms,
        // it's a buffer stall!
        if (timeDiff >= 200 && progressDiff <= 0.03) {
          isStalled = true;
        }
      }

      // Update the tracker ref with current values
      lastVideoProgressRef.current = {
        currentTime: currentVideoTime,
        timestamp: now
      };
    } else {
      // If paused or ended, clear the progress tracker
      lastVideoProgressRef.current = null;
    }

    if (isStalled) {
      // Pause the audio immediately to match the stalled video playhead
      if (!audio.paused) {
        console.log("[AUDIO-SYNC] Video stall detected via playhead monitoring. Pausing audio.");
        audio.pause();
        setIsOnlineLoading(true);
        isVideoStalledDetectionRef.current = true;
      }
      return;
    } else {
      // If we recovered from a detected stall, resume the audio
      if (isVideoStalledDetectionRef.current && audio.paused && !video.paused && !video.ended) {
        console.log("[AUDIO-SYNC] Video stall recovered. Resuming audio.");
        audio.currentTime = video.currentTime;
        audio.play().catch(() => { });
        setIsOnlineLoading(false);
        isVideoStalledDetectionRef.current = false;
      }
    }

    const drift = audio.currentTime - video.currentTime;
    const absDrift = Math.abs(drift);

    // Only hard seek if drift is very large (>1 second) or forced
    if (hardSync || absDrift > 1.0) {
      audio.currentTime = video.currentTime;
      audio.playbackRate = video.playbackRate;
    }
    // Use smooth playback rate adjustment for moderate drift (0.1-1.0 seconds)
    else if (absDrift > 0.1 && absDrift <= 1.0) {
      const baseRate = video.playbackRate;
      // Gradually speed up or slow down audio to catch up
      if (drift > 0) {
        // Audio is ahead, slow it down slightly
        audio.playbackRate = baseRate * 0.98;
      } else {
        // Audio is behind, speed it up slightly
        audio.playbackRate = baseRate * 1.02;
      }
    }
    // Small drift - just match playback rates
    else if (audio.playbackRate !== video.playbackRate) {
      audio.playbackRate = video.playbackRate;
    }
  }, []);

  useEffect(() => {
    if (audioDriftIntervalRef.current) {
      clearInterval(audioDriftIntervalRef.current);
      audioDriftIntervalRef.current = null;
    }

    if (!audioSrc || !isPlaying) return;

    // Sync more frequently but gently (250ms instead of 500ms)
    audioDriftIntervalRef.current = setInterval(() => {
      syncSeparateAudio();
    }, 250);

    return () => {
      if (audioDriftIntervalRef.current) {
        clearInterval(audioDriftIntervalRef.current);
        audioDriftIntervalRef.current = null;
      }
    };
  }, [audioSrc, isPlaying, syncSeparateAudio]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();

      if ((e.ctrlKey || e.metaKey) && k === "o") {
        e.preventDefault();
        setIsLoaderOpen(true);
        return;
      }

      if (e.ctrlKey || e.altKey || e.metaKey) return;
      if (isTypingInEditableField()) return;

      const isShortcut = [" ", "k", "f", "i", "m", "arrowup", "arrowdown", "arrowleft", "arrowright", "l", "j"].includes(k)
        || (!isNaN(Number(k)) && e.code.startsWith("Digit"))
        || (e.shiftKey && (e.key === ">" || e.key === "<" || e.key === "." || e.key === ","));

      if (isShortcut && document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }

      if (k === "f") {
        toggleFullscreen();
        return;
      }

      if (k === "m") {
        toggleMute();
        showStatus(isMuted ? "volume-2" : "volume-x");
        return;
      }

      if (k === "arrowup") {
        e.preventDefault();
        const baseVolume = isMuted ? 0 : volume;
        const newVol = Math.min(1, baseVolume + 0.05);
        applyVolume(newVol);
        showStatus(newVol > 0.5 ? "volume-2" : "volume-1", Math.round(newVol * 100) + "%");
        return;
      }

      if (k === "arrowdown") {
        e.preventDefault();
        const baseVolume = isMuted ? 0 : volume;
        const newVol = Math.max(0, baseVolume - 0.05);
        applyVolume(newVol);
        showStatus(
          newVol === 0 ? "volume-x" : newVol > 0.5 ? "volume-2" : "volume-1",
          Math.round(newVol * 100) + "%"
        );
        return;
      }

      const video = videoRef.current;
      if (!video || !videoSrc) return;

      if (k === " " || k === "k") {
        e.preventDefault();
        handlePlayPause();
      } else if (k === "i") {
        togglePip();
      } else if (k === "arrowright" || k === "l") {
        video.currentTime += 5;
        triggerRipple("right");
      } else if (k === "arrowleft" || k === "j") {
        video.currentTime -= 5;
        triggerRipple("left");
      } else if (!isNaN(Number(k)) && e.code.startsWith("Digit")) {
        video.currentTime = (parseInt(k) / 10) * (duration || 0);
        showStatus("play", k + "0%");
      } else if (e.shiftKey && (e.key === ">" || e.key === ".")) {
        const newSpeed = Math.min(2, playbackSpeed + 0.25);
        changeSpeed(newSpeed);
        showStatus("gauge", newSpeed + "x");
      } else if (e.shiftKey && (e.key === "<" || e.key === ",")) {
        const newSpeed = Math.max(0.25, playbackSpeed - 0.25);
        changeSpeed(newSpeed);
        showStatus("gauge", newSpeed + "x");
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isMuted, volume, playbackSpeed, duration, handlePlayPause, applyVolume, videoSrc]);

  const resetControlsTimer = () => {
    setShowControls(true);
    if (hideControlsTimeout.current) {
      clearTimeout(hideControlsTimeout.current);
    }
    if (!isPlaying || isSettingsOpen) return;
    hideControlsTimeout.current = setTimeout(() => {
      setShowControls(false);
    }, 3000);
  };

  useEffect(() => {
    resetControlsTimer();
  }, [isPlaying, isSettingsOpen]);

  useEffect(() => {
    // Ensure the window is focused on mount so shortcuts work immediately
    window.focus();
  }, []);

  const handleProgressClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!progressAreaRef.current || !videoRef.current) return;
    const rect = progressAreaRef.current.getBoundingClientRect();
    const percent = (e.clientX - rect.left) / rect.width;
    videoRef.current.currentTime = percent * duration;
  };

  const handleProgressMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!progressAreaRef.current || !duration) return;
    const rect = progressAreaRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;

    const time = Math.max(0, Math.min(duration, (x / rect.width) * duration));
    setHoverTime(time);

    const previewWidth = 140;
    const halfWidth = previewWidth / 2;
    let boundedX = x;
    if (boundedX < halfWidth) boundedX = halfWidth;
    if (boundedX > rect.width - halfWidth) boundedX = rect.width - halfWidth;
    setHoverX(boundedX);

    pendingPreviewTimeRef.current = time;
    applyPreviewSeek(time);
  };

  useEffect(() => {
    setPreviewVideoEnabled(canUseDedicatedPreview);
    previewSeekInFlightRef.current = false;
    previewLastAppliedTimeRef.current = null;
    pendingPreviewTimeRef.current = null;
  }, [canUseDedicatedPreview, previewVideoSrc]);

  useEffect(() => {
    console.log("Preview decision:", {
      videoSrc,
      isHlsLikeUrl: isHlsLikeUrl(videoSrc),
      isDashSource,
      isAuthenticatedStream,
      canUseDedicatedPreview,
      previewVideoSrc,
      previewVideoEnabled,
    });

    const existingCanPlayRetryHandler = previewCanPlayRetryHandlerRef.current;
    if (existingCanPlayRetryHandler && previewVideoRef.current) {
      previewVideoRef.current.removeEventListener("canplay", existingCanPlayRetryHandler);
      previewCanPlayRetryHandlerRef.current = null;
    }

    previewSeekInFlightRef.current = false;
    previewLastAppliedTimeRef.current = null;

    const preview = previewVideoRef.current;
    if (!preview || !canUseDedicatedPreview || !previewVideoSrc || !previewVideoEnabled) return;

    const onLoadedMetadata = () => {
      console.log("Preview video metadata loaded, duration:", preview.duration);
      if (pendingPreviewTimeRef.current != null) {
        applyPreviewSeek(pendingPreviewTimeRef.current);
      }
    };

    const onCanPlay = () => {
      if (pendingPreviewTimeRef.current != null) {
        applyPreviewSeek(pendingPreviewTimeRef.current);
      }
    };

    const onSeeked = () => {
      previewSeekInFlightRef.current = false;
      if (pendingPreviewTimeRef.current != null) {
        applyPreviewSeek(pendingPreviewTimeRef.current);
      }
    };

    const onError = (e: Event) => {
      console.error("Preview video error:", e, (e.target as HTMLVideoElement).error);
      previewSeekInFlightRef.current = false;
      setPreviewVideoEnabled(false);
    };

    preview.addEventListener("loadedmetadata", onLoadedMetadata);
    preview.addEventListener("canplay", onCanPlay);
    preview.addEventListener("seeked", onSeeked);
    preview.addEventListener("error", onError);
    preview.load();

    return () => {
      const canPlayRetryHandler = previewCanPlayRetryHandlerRef.current;
      if (canPlayRetryHandler) {
        preview.removeEventListener("canplay", canPlayRetryHandler);
        previewCanPlayRetryHandlerRef.current = null;
      }
      preview.removeEventListener("loadedmetadata", onLoadedMetadata);
      preview.removeEventListener("canplay", onCanPlay);
      preview.removeEventListener("seeked", onSeeked);
      preview.removeEventListener("error", onError);
    };
  }, [previewVideoSrc, canUseDedicatedPreview, previewVideoEnabled, applyPreviewSeek, videoSrc, isAuthenticatedStream]);

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    applyVolume(val);
  };

  function isTypingInEditableField() {
    const active = document.activeElement as HTMLElement | null;
    if (!active) return false;
    if (active.isContentEditable) return true;
    if (active.tagName === "TEXTAREA") return true;
    if (active.tagName !== "INPUT") return false;

    const input = active as HTMLInputElement;
    const type = String(input.type || "text").toLowerCase();
    const textLikeTypes = ["text", "search", "url", "email", "password", "tel", "number"];
    if (!textLikeTypes.includes(type)) return false;
    if (input.readOnly || input.disabled) return false;

    return input.offsetParent !== null;
  }

  const renderStatusIcon = () => {
    const s = statusOverlay;
    if (!s.icon) return null;
    let IconComp: any = RoundedPlay;
    switch (s.icon) {
      case "play":
        IconComp = RoundedPlay;
        break;
      case "pause":
        IconComp = RoundedPause;
        break;
      case "volume-x":
        IconComp = VolumeX;
        break;
      case "volume-1":
        IconComp = Volume1;
        break;
      case "volume-2":
        IconComp = Volume2;
        break;
      case "gauge":
        IconComp = Gauge;
        break;
    }
    return (
      <>
        {IconComp && <IconComp className={s.text ? "mb-1 h-8 w-8" : "h-10 w-10"} />}
        {s.text && <span className="text-lg font-medium">{s.text}</span>}
      </>
    );
  };

  void togglePlay;
  const VolumeIcon = isMuted || volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2;

  return (
    <>
      <style>{`
        .spinner {
          width: 64px;
          height: 64px;
          animation: rotate 2.33s linear infinite;
        }
        .path {
          fill: none;
          stroke: #ffffff;
          stroke-width: 3.5;
          stroke-linecap: round;
          animation: dash 1.87s cubic-bezier(0.4, 0.0, 0.2, 1) infinite;
        }
        @keyframes rotate {
          100% { transform: rotate(360deg); }
        }
        @keyframes dash {
          0% { stroke-dasharray: 1, 150; stroke-dashoffset: 0; }
          50% { stroke-dasharray: 90, 150; stroke-dashoffset: -35px; }
          100% { stroke-dasharray: 90, 150; stroke-dashoffset: -124px; }
        }

        .settings-scroll-area::-webkit-scrollbar {
          width: 8px;
        }
        .settings-scroll-area::-webkit-scrollbar-track {
          background: transparent;
        }
        .settings-scroll-area::-webkit-scrollbar-thumb {
          background: rgba(255, 255, 255, 0.2);
          border-radius: 10px;
        }
        .settings-scroll-area::-webkit-scrollbar-thumb:hover {
          background: rgba(255, 255, 255, 0.3);
        }
        .settings-scroll-area {
          scrollbar-width: thin;
          scrollbar-color: rgba(255, 255, 255, 0.2) transparent;
        }
        .submenu-options {
          max-height: 300px;
          overflow-y: auto;
        }
        .settings-pane .settings-scroll-area {
          max-height: 300px;
          overflow-y: auto;
        }

        .libassjs-canvas-parent {
          z-index: 3 !important;
          pointer-events: none !important;
        }
        .libassjs-canvas-parent canvas {
          z-index: 3 !important;
          pointer-events: none !important;
        }
        .subtitle-overlay {
          z-index: 2147483647 !important;
        }
        .settings-menu {
          z-index: 500 !important;
        }
        .video-controls {
          z-index: 600 !important;
        }
        .progress-area,
        .control-bar-content {
          position: relative;
          z-index: 610 !important;
        }
      `}</style>
      <div
        className={`main-wrapper relative flex h-screen w-screen flex-col items-center justify-center bg-black ${isCustomPipActive ? "custom-pip-mode" : ""}`}
        ref={containerRef}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      >
        {/* ── Drop Zone Overlay ── */}
        <div
          className={`drop-zone-overlay ${isDragOver ? "active" : ""}`}
        >
          <div className="drop-zone-content">
            <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-white/60"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
            <span className="text-sm font-medium text-white/60 tracking-wide">Drop media file to play</span>
          </div>
        </div>

        <div
          className={`fixed inset-0 z-[900] flex items-center justify-center ${isMediaDetailsOpen ? "pointer-events-auto" : "pointer-events-none"
            }`}
        >
          <div
            className={`absolute inset-0 transition-all duration-300 ease-out ${isMediaDetailsOpen
              ? "bg-black/40 opacity-100"
              : "bg-transparent opacity-0 pointer-events-none"
              }`}
            onClick={() => setIsMediaDetailsOpen(false)}
          ></div>

          <div
            className={`glass-panel app-modal-window relative z-10 mx-4 flex transform flex-col gap-6 p-6 shadow-xl shadow-black/20 transition-all duration-300 ease-out overflow-hidden ${isMediaDetailsOpen ? "scale-100 opacity-100" : "scale-95 opacity-0"
              }`}
          >
            <div className="flex items-center justify-between border-b border-white/10 pb-4">
              <h3 className="text-lg font-normal text-white flex items-center gap-2">
                <Info className="h-5 w-5" /> Media Information
              </h3>
              <button
                onClick={() => setIsMediaDetailsOpen(false)}
                className="rounded-full p-1 text-white/40 transition-colors hover:bg-white/5 hover:text-white/80"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="flex flex-col gap-2 overflow-y-auto flex-1 pr-2 custom-scrollbar">
              <div className="flex flex-col gap-3 p-2">
                <div className="flex justify-between items-center gap-4">
                  <span className="text-sm text-white shrink-0">Title</span>
                  <ModalMarqueeTitle text={videoTitle} />
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-white">Type</span>
                  <span className="text-sm text-white/50">{isOnlineVideo ? "Online Stream" : "Local File"}</span>
                </div>
                {isOnlineVideo && (
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-white">Format</span>
                    <span className="text-sm text-white/50">
                      {streamFormat ? (
                        (() => {
                          const parts = streamFormat.split(',');
                          const preferred = parts.find(f => f === 'mp4' || f === 'matroska' || f === 'webm') || parts[0];
                          return preferred === 'matroska' ? 'MKV' : preferred.toUpperCase();
                        })()
                      ) : (isHlsSource ? "HLS (.m3u8)" : isDashSource ? "DASH (.mpd)" : isPixelDrainStream ? "Pixeldrain Network" : "Unknown")}
                    </span>
                  </div>
                )}
                {(!isYoutubeLive && streamFileSize) && (
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-white">File Size</span>
                    <span className="text-sm text-white/50">
                      {streamFileSize >= 1024 * 1024 * 1024
                        ? (streamFileSize / (1024 * 1024 * 1024)).toFixed(2) + ' GB'
                        : (streamFileSize / (1024 * 1024)).toFixed(2) + ' MB'}
                    </span>
                  </div>
                )}
                {streamBitrate && (
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-white">Bitrate</span>
                    <span className="text-sm text-white/50">
                      {streamBitrate >= 1000 * 1000
                        ? (streamBitrate / (1000 * 1000)).toFixed(2) + ' Mbps'
                        : (streamBitrate / 1000).toFixed(0) + ' Kbps'}
                    </span>
                  </div>
                )}
                <div className="flex justify-between items-center">
                  <span className="text-sm text-white">Video Codec</span>
                  <span className="text-sm text-white/50">
                    {streamVideoCodec && streamVideoCodec !== "Unknown"
                      ? streamVideoCodec.toUpperCase()
                      : (qualityOptions.find(opt => opt.value === videoSrc)?.format?.toUpperCase() || (isProbing ? "Probing..." : "Unknown"))}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-white">Audio Codec</span>
                  <span className="text-sm text-white/50">
                    {streamAudioCodec && streamAudioCodec !== "Unknown"
                      ? streamAudioCodec.toUpperCase()
                      : (audioTrack && audioTrack !== "Auto" ? audioTrack : (isProbing ? "Probing..." : "Unknown"))}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-white">Resolution</span>
                  <span className="text-sm text-white/50">
                    {videoRef.current?.videoWidth || 0} x {videoRef.current?.videoHeight || 0}
                  </span>
                </div>
                <FrameRateRow videoRef={videoRef} streamFps={streamFps} />

                {!isYoutubeLive && (
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-white">Duration</span>
                    <span className="text-sm text-white/50">
                      {formatTime(videoRef.current?.duration || 0)}
                    </span>
                  </div>
                )}
                {(!isYoutubeLive && isOnlineVideo && qualityOptions.length > 1) && (
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-white">Video Qualities</span>
                    <span className="text-sm text-white/50">{qualityOptions.length}</span>
                  </div>
                )}
                {!isYoutubeLive && (
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-white">Audio Tracks</span>
                    <span className="text-sm text-white/50">{availableAudioTracks.length || 1} Tracks</span>
                  </div>
                )}
                {!isYoutubeLive && (
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-white">Subtitles</span>
                    <span className="text-sm text-white/50">{availableTextTracks.length} Tracks</span>
                  </div>
                )}
                <div className="flex flex-col gap-1 mt-2">
                  <span className="text-sm text-white">Source URL</span>
                  <p className="text-xs text-white/50 break-all select-all font-mono leading-relaxed mt-1">
                    {(isOnlineVideo && loadedUrlInputRef.current)
                      ? loadedUrlInputRef.current
                      : (videoSrc ? decodeURIComponent(videoSrc) : "No active source")}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div
          className={`fixed inset-0 z-[900] flex items-center justify-center ${isLoaderOpen ? "pointer-events-auto" : "pointer-events-none"
            }`}
        >
          <div
            className={`absolute inset-0 transition-all duration-300 ease-out ${isLoaderOpen
              ? "bg-black/40 opacity-100"
              : "bg-transparent opacity-0 pointer-events-none"
              }`}
            onClick={() => setIsLoaderOpen(false)}
          ></div>

          <div
            className={`glass-panel app-modal-window relative z-10 mx-4 flex transform flex-col p-6 shadow-xl shadow-black/20 transition-all duration-300 ease-out ${isLoaderOpen ? "scale-100 opacity-100" : "scale-95 opacity-0"
              }`}
          >
            {/* ── Animated Header and Tabs ── */}
            <div
              className={`flex flex-col transition-all duration-500 ease-[cubic-bezier(0.4,0,0.2,1)] overflow-hidden origin-top ${(loaderTab === "playlist" && activePlaylistId)
                ? "max-h-0 opacity-0 transform -translate-y-4 pointer-events-none mb-0 gap-0"
                : `max-h-[150px] opacity-100 transform translate-y-0 ${loaderOnlyPlaylist ? "mb-4 gap-4" : "mb-6 gap-6"}`
                }`}
            >
              <div className="flex items-center justify-between border-b border-white/10 pb-4">
                <h3 className="text-lg font-medium text-white/80">{loaderOnlyPlaylist ? "Playlists" : "Open Media"}</h3>
                <button
                  onClick={() => setIsLoaderOpen(false)}
                  className="rounded-full p-1 text-white/40 transition-colors hover:bg-white/5 hover:text-white/80"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              {!loaderOnlyPlaylist && (
                <div className="dl-tabs" ref={(el) => {
                  if (!el) return;
                  const activeBtn = el.querySelector('.dl-tab.active') as HTMLElement;
                  const indicator = el.querySelector('.dl-tab-indicator') as HTMLElement;
                  if (activeBtn && indicator) {
                    indicator.style.left = `${activeBtn.offsetLeft}px`;
                    indicator.style.width = `${activeBtn.offsetWidth}px`;
                  }
                }}>
                  <button className={`dl-tab ${loaderTab === "local" ? "active" : ""}`} onClick={() => setLoaderTab("local")}>Local Media</button>
                  <button className={`dl-tab ${loaderTab === "online" ? "active" : ""}`} onClick={() => setLoaderTab("online")}>Online Stream</button>
                  <button className={`dl-tab ${loaderTab === "playlist" ? "active" : ""}`} onClick={() => { setLoaderTab("playlist"); setPlImportMode(false); }}>Playlist</button>
                  <div className="dl-tab-indicator" />
                </div>
              )}
            </div>

            {/* ── Content area ── */}
            <div className={`dl-content ${(loaderTab === "playlist" && activePlaylistId) ? '!pt-0 !px-0' : ''}`}>
              {loaderTab === "local" && (
                <div className="flex flex-col gap-3 pt-2">
                  <span className="text-sm font-medium text-white/60">Local File</span>
                  <button
                    onClick={async () => {
                      setIsLoaderOpen(false);
                      const electron = getElectronApi();
                      if (electron?.ipcRenderer?.invoke) {
                        try {
                          const picked = await electron.ipcRenderer.invoke("open-local-media-file");
                          if (picked?.path) {
                            await loadLocalFileSource({
                              fileName: String(picked.name || picked.path.split(/[\\/]/).pop() || "Local Video"),
                              filePath: String(picked.path),
                              file: null,
                            });
                            return;
                          }
                        } catch {
                        }
                      }
                      fileInputRef.current?.click();
                    }}
                    className="glass-panel flex items-center justify-center gap-2 py-3 text-sm font-normal text-white/70 transition-all hover:bg-white/10"
                  >
                    <FilePlus2 className="h-4 w-4" />
                    Browse files
                  </button>
                </div>
              )}

              {loaderTab === "online" && (
                <div className="flex flex-col gap-4 pt-2">
                  <div className="flex flex-col gap-2">
                    <span className="text-sm font-medium text-white/60">Online Video URL</span>
                    <input
                      type="text"
                      ref={urlInputRef}
                      value={urlInput}
                      onChange={(e) => setUrlInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          void submitUrlInput();
                        }
                      }}
                      placeholder="https://example.com/video.mp4"
                      className="glass-panel w-full px-3 py-2 text-sm text-white/80 placeholder-white/20 outline-none transition-colors focus:border-white/40"
                    />
                  </div>

                  <div className="flex flex-col gap-2">
                    <span className="text-sm font-medium text-white/60">Custom Referer (Optional)</span>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={refererInput}
                        onChange={(e) => setRefererInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            void submitUrlInput();
                          }
                        }}
                        placeholder="https://example.com"
                        className="glass-panel flex-1 px-3 py-2 text-sm text-white/80 placeholder-white/20 outline-none transition-colors focus:border-white/40"
                      />
                      <button
                        onClick={() => {
                          void submitUrlInput();
                        }}
                        disabled={isProbingUrl}
                        className="glass-panel px-5 py-2 text-sm font-normal text-white/70 transition-all hover:bg-white/10 disabled:opacity-50 flex items-center justify-center min-w-[76px]"
                      >
                        {isProbingUrl ? <LoaderCircleIcon size={16} className="text-white/50" /> : "Load"}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* ── Playlist tab ── */}
              {loaderTab === "playlist" && (
                <div className="flex flex-col gap-0 h-full overflow-hidden">
                  <AnimatePresence mode="wait" initial={false}>
                    {!activePlaylistId ? (
                      /* ── Playlist Manager View ── */
                      <motion.div
                        key="manager"
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: -10 }}
                        transition={{ duration: 0.15, ease: "easeOut" }}
                        className="flex flex-col gap-3 h-full"
                      >
                        <AnimatePresence mode="wait" initial={false}>
                          {!plImportMode ? (
                            <motion.div
                              key="list"
                              initial={{ opacity: 0, scale: 0.97 }}
                              animate={{ opacity: 1, scale: 1 }}
                              exit={{ opacity: 0, scale: 0.97 }}
                              transition={{ duration: 0.15, ease: "easeOut" }}
                              className="flex flex-col gap-3 h-full"
                            >
                              <div className="flex items-center justify-between">
                                <span className="text-sm font-medium text-white/60">My Playlists</span>
                                <button
                                  onClick={() => setPlImportMode(true)}
                                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-white/60 hover:text-white bg-white/5 hover:bg-white/10 rounded-full transition-colors border-none cursor-pointer"
                                >
                                  <Plus className="w-3 h-3" /> Import
                                </button>
                              </div>

                              {playlists.length === 0 ? (
                                <div className="flex flex-col items-center justify-center py-12 gap-3">
                                  <ListMusic className="w-8 h-8 text-white/10" />
                                  <span className="text-xs text-white/25">No playlists yet</span>
                                  <button
                                    onClick={() => setPlImportMode(true)}
                                    className="mt-2 px-4 py-2 text-xs text-white/50 hover:text-white bg-white/5 hover:bg-white/10 rounded-lg transition-colors border-none cursor-pointer"
                                  >
                                    Import your first playlist
                                  </button>
                                </div>
                              ) : (
                                <div className="pl-scroll-area" style={{ maxHeight: '340px', overflowY: 'auto' }}>
                                  {playlists.map(pl => (
                                    <div
                                      key={pl.id}
                                      className="pl-card"
                                      onClick={() => { setActivePlaylistId(pl.id); setPlSearchQuery(''); setPlGroupFilter('all'); setPlSortMode('original'); setPlShowFavoritesOnly(false); }}
                                    >
                                      <div className="flex items-center gap-3 min-w-0 flex-1">
                                        <div className="w-9 h-9 rounded-lg bg-white/5 flex items-center justify-center flex-shrink-0">
                                          <ListMusic className="w-4 h-4 text-white/30" />
                                        </div>
                                        <div className="flex flex-col min-w-0 flex-1">
                                          {plListRenamingId === pl.id ? (
                                            <input
                                              autoFocus
                                              defaultValue={pl.name}
                                              onClick={e => e.stopPropagation()}
                                              onBlur={e => renamePlaylist(pl.id, e.target.value)}
                                              onKeyDown={e => {
                                                if (e.key === 'Enter') renamePlaylist(pl.id, (e.target as HTMLInputElement).value);
                                                if (e.key === 'Escape') setPlListRenamingId(null);
                                              }}
                                              className="bg-black/40 border border-white/20 rounded px-2 py-0.5 text-sm text-white focus:outline-none focus:border-white/40 w-full"
                                            />
                                          ) : (
                                            <span className="text-sm text-white/90 truncate">{pl.name}</span>
                                          )}
                                          <div className="flex items-center gap-2 mt-0.5">
                                            <span className="text-[10px] text-white/30">{pl.entries.filter(e => !e.isHidden).length} items</span>
                                            <span className="text-[10px] text-white/20">·</span>
                                            <span className="text-[10px] text-white/30 uppercase">{pl.source}</span>
                                            {pl.autoRefresh && <span className="text-[10px] text-white/20">· Auto-refresh</span>}
                                          </div>
                                        </div>
                                      </div>
                                      <div className="flex items-center gap-1 flex-shrink-0" onClick={e => e.stopPropagation()}>
                                        <button
                                          className="p-1.5 rounded-full text-white/20 hover:text-white/60 hover:bg-white/5 transition-colors border-none bg-transparent cursor-pointer"
                                          title="Rename Playlist"
                                          onClick={(e) => { e.stopPropagation(); setPlListRenamingId(pl.id); }}
                                        >
                                          <Edit3 className="w-3.5 h-3.5" />
                                        </button>
                                        {pl.source === 'remote' && (
                                          <button
                                            className={`p-1.5 rounded-full text-white/20 hover:text-white/60 hover:bg-white/5 transition-colors border-none bg-transparent cursor-pointer ${pl.autoRefresh ? 'text-white/40' : ''}`}
                                            title={pl.autoRefresh ? 'Auto-refresh ON' : 'Auto-refresh OFF'}
                                            onClick={() => togglePlaylistAutoRefresh(pl.id)}
                                          >
                                            <RefreshCw className={`w-3.5 h-3.5 ${pl.autoRefresh ? 'text-white/50' : ''}`} />
                                          </button>
                                        )}
                                        <button
                                          className="p-1.5 rounded-full text-white/20 hover:text-white/60 hover:bg-white/5 transition-colors border-none bg-transparent cursor-pointer"
                                          title="Delete Playlist"
                                          onClick={() => deletePlaylist(pl.id)}
                                        >
                                          <X className="w-3.5 h-3.5" />
                                        </button>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </motion.div>
                          ) : (
                            /* ── Import Mode ── */
                            <motion.div
                              key="import"
                              initial={{ opacity: 0, scale: 0.97 }}
                              animate={{ opacity: 1, scale: 1 }}
                              exit={{ opacity: 0, scale: 0.97 }}
                              transition={{ duration: 0.15, ease: "easeOut" }}
                              className="flex flex-col gap-4"
                            >
                              <div className="flex items-center justify-between">
                                <span className="text-sm font-medium text-white/60">Import Playlist</span>
                                <button
                                  onClick={() => { setPlImportMode(false); setPlImportUrl(''); }}
                                  className="p-1 rounded-full text-white/40 hover:text-white/80 hover:bg-white/5 transition-colors border-none bg-transparent cursor-pointer"
                                >
                                  <X className="w-4 h-4" />
                                </button>
                              </div>

                              <button
                                onClick={() => void importPlaylistFromFile()}
                                className="glass-panel flex items-center justify-center gap-2 py-3 text-sm font-normal text-white/70 transition-all hover:bg-white/10 cursor-pointer border-none"
                              >
                                <FilePlus2 className="h-4 w-4" />
                                Browse .m3u / .m3u8 file
                              </button>

                              <div className="flex items-center gap-2 text-white/20 text-xs">
                                <div className="flex-1 h-px bg-white/10" />
                                <span>or paste URL</span>
                                <div className="flex-1 h-px bg-white/10" />
                              </div>

                              <div className="flex gap-2">
                                <input
                                  type="text"
                                  value={plImportUrl}
                                  onChange={e => setPlImportUrl(e.target.value)}
                                  onKeyDown={e => { if (e.key === 'Enter') void importPlaylistFromUrl(plImportUrl); }}
                                  placeholder="https://example.com/playlist.m3u"
                                  className="glass-panel flex-1 px-3 py-2 text-sm text-white/80 placeholder-white/20 outline-none transition-colors focus:border-white/40 border-none"
                                />
                                <button
                                  onClick={() => void importPlaylistFromUrl(plImportUrl)}
                                  disabled={plRefreshing || !plImportUrl.trim()}
                                  className="glass-panel px-4 py-2 text-sm text-white/70 hover:bg-white/10 transition-all cursor-pointer border-none disabled:opacity-30 disabled:cursor-default"
                                >
                                  {plRefreshing ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Load'}
                                </button>
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </motion.div>
                    ) : (
                      /* ── Playlist Detail View ── */
                      (() => {
                        const pl = playlists.find(p => p.id === activePlaylistId);
                        if (!pl) { setActivePlaylistId(null); return null; }

                        // Filter & sort entries
                        let filtered = pl.entries.filter(e => !e.isHidden);
                        if (plShowFavoritesOnly) filtered = filtered.filter(e => e.isFavorite);
                        if (plGroupFilter !== 'all') filtered = filtered.filter(e => e.group === plGroupFilter);
                        if (plSearchQuery) {
                          const q = plSearchQuery.toLowerCase();
                          filtered = filtered.filter(e => e.name.toLowerCase().includes(q) || e.group.toLowerCase().includes(q));
                        }
                        if (plSortMode === 'az') filtered.sort((a, b) => a.name.localeCompare(b.name));
                        else if (plSortMode === 'za') filtered.sort((a, b) => b.name.localeCompare(a.name));
                        else if (plSortMode === 'duration') filtered.sort((a, b) => b.duration - a.duration);

                        const visibleEntries = filtered.slice(0, plVisibleCount);
                        const hasMore = filtered.length > plVisibleCount;

                        return (
                          <motion.div
                            key="active"
                            initial={{ opacity: 0, x: 10 }}
                            animate={{ opacity: 1, x: 0 }}
                            exit={{ opacity: 0, x: 10 }}
                            transition={{ duration: 0.15, ease: "easeOut" }}
                            className="flex flex-col gap-2 h-full overflow-hidden"
                          >
                            {/* Top bar */}
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => setActivePlaylistId(null)}
                                className="p-1 rounded-full text-white/40 hover:text-white/80 hover:bg-white/5 transition-colors border-none bg-transparent cursor-pointer flex-shrink-0"
                              >
                                <ArrowLeft className="w-4 h-4" />
                              </button>
                              <div className="flex flex-col min-w-0 flex-1">
                                <span className="text-sm text-white/80 font-medium truncate">{pl.name}</span>
                                <span className="text-[10px] text-white/30">{filtered.length} items{plSearchQuery ? ` matching "${plSearchQuery}"` : ''}</span>
                              </div>
                              <div className="flex items-center gap-1.5 flex-shrink-0">
                                {pl.source === 'remote' && (
                                  <button
                                    onClick={() => void refreshPlaylist(pl.id)}
                                    disabled={plRefreshing}
                                    className="p-1.5 rounded-full text-white/30 hover:text-white/70 hover:bg-white/5 transition-colors border-none bg-transparent cursor-pointer"
                                    title="Refresh"
                                  >
                                    <RefreshCw className={`w-3.5 h-3.5 ${plRefreshing ? 'animate-spin' : ''}`} />
                                  </button>
                                )}
                                <button
                                  onClick={() => exportPlaylist(pl)}
                                  className="p-1.5 rounded-full text-white/30 hover:text-white/70 hover:bg-white/5 transition-colors border-none bg-transparent cursor-pointer"
                                  title="Export as .m3u"
                                >
                                  <FileDown className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  onClick={() => setIsLoaderOpen(false)}
                                  className="p-1.5 rounded-full text-white/30 hover:text-white/70 hover:bg-white/5 transition-colors border-none bg-transparent cursor-pointer ml-1"
                                  title="Close"
                                >
                                  <X className="w-4 h-4" />
                                </button>
                              </div>
                            </div>

                            {/* Search bar */}
                            <div className="flex items-center gap-2 bg-white/5 rounded-lg px-3 py-1.5 border border-white/5">
                              <Search className="w-3.5 h-3.5 text-white/30 flex-shrink-0" />
                              <input
                                type="text"
                                value={plSearchQuery}
                                onChange={e => setPlSearchQuery(e.target.value)}
                                placeholder="Search tracks..."
                                className="bg-transparent text-white/80 placeholder-white/20 text-xs outline-none border-none w-full"
                              />
                              {plSearchQuery && (
                                <button onClick={() => setPlSearchQuery('')} className="text-white/30 hover:text-white/60 border-none bg-transparent cursor-pointer p-0">
                                  <X className="w-3 h-3" />
                                </button>
                              )}
                            </div>

                            {/* Filter bar */}
                            <div className="flex items-center gap-2 flex-wrap">
                              {/* Group filters */}
                              <div className="flex gap-1 flex-1 overflow-x-auto pl-scroll-hide" style={{ scrollbarWidth: 'none' }}>
                                <button
                                  className={`px-2.5 py-1 rounded-full text-[10px] whitespace-nowrap transition-colors border-none cursor-pointer ${plGroupFilter === 'all' ? 'bg-white/15 text-white' : 'bg-white/5 text-white/40 hover:bg-white/10 hover:text-white/60'}`}
                                  onClick={() => setPlGroupFilter('all')}
                                >
                                  All
                                </button>
                                {pl.groups.map(g => (
                                  <button
                                    key={g}
                                    className={`px-2.5 py-1 rounded-full text-[10px] whitespace-nowrap transition-colors border-none cursor-pointer ${plGroupFilter === g ? 'bg-white/15 text-white' : 'bg-white/5 text-white/40 hover:bg-white/10 hover:text-white/60'}`}
                                    onClick={() => setPlGroupFilter(g)}
                                  >
                                    {g}
                                  </button>
                                ))}
                              </div>

                              {/* Favorites toggle */}
                              <button
                                className={`p-1.5 rounded-full transition-colors border-none cursor-pointer ${plShowFavoritesOnly ? 'bg-white/15 text-yellow-400' : 'bg-white/5 text-white/30 hover:text-white/60'}`}
                                onClick={() => setPlShowFavoritesOnly(!plShowFavoritesOnly)}
                                title="Show favorites only"
                              >
                                {plShowFavoritesOnly ? <StarFilled className="w-3 h-3" /> : <Star className="w-3 h-3" />}
                              </button>

                              {/* Sort dropdown */}
                              <select
                                value={plSortMode}
                                onChange={e => setPlSortMode(e.target.value as any)}
                                className="bg-white/5 text-white/50 text-[10px] rounded-full px-2.5 py-1 border-none outline-none cursor-pointer appearance-none"
                                title="Sort"
                              >
                                <option value="original" className="bg-[#1a1a1a]">Original</option>
                                <option value="az" className="bg-[#1a1a1a]">A → Z</option>
                                <option value="za" className="bg-[#1a1a1a]">Z → A</option>
                                <option value="duration" className="bg-[#1a1a1a]">Duration</option>
                              </select>
                            </div>

                            {/* Entry list */}
                            <div className="pl-scroll-area flex-1 overflow-y-auto grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-4 p-2" ref={plScrollRef} style={{ minHeight: 0, alignContent: "start" }}>
                              {visibleEntries.length === 0 ? (
                                <div className="flex flex-col items-center justify-center py-12 gap-2 col-span-full">
                                  <Search className="w-6 h-6 text-white/10" />
                                  <span className="text-xs text-white/25">{plSearchQuery ? 'No matches found' : 'No entries'}</span>
                                </div>
                              ) : (
                                visibleEntries.map((entry, idx) => (
                                  <div
                                    key={entry.id}
                                    className={`pl-entry group ${plPlayingEntryId === entry.id ? 'playing' : ''} ${plDragOverId === entry.id ? 'drag-over' : ''}`}
                                    style={{ animationDelay: `${Math.min(idx, 20) * 15}ms` }}
                                    draggable
                                    onDragStart={e => { e.dataTransfer.setData('text/plain', entry.id); e.dataTransfer.effectAllowed = 'move'; }}
                                    onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setPlDragOverId(entry.id); }}
                                    onDragLeave={() => setPlDragOverId(null)}
                                    onDrop={e => { e.preventDefault(); const fromId = e.dataTransfer.getData('text/plain'); if (fromId && fromId !== entry.id) reorderPlaylistEntries(pl.id, fromId, entry.id); }}
                                    onClick={() => playPlaylistEntry(entry)}
                                  >
                                    {/* Drag handle */}
                                    <div className="pl-drag-handle absolute top-2 left-2 z-10" onMouseDown={e => e.stopPropagation()}>
                                      <GripVertical className="w-4 h-4" />
                                    </div>

                                    {/* Logo */}
                                    <div className="pl-logo-square flex-shrink-0 relative w-16 h-16 rounded-xl overflow-hidden flex items-center justify-center mb-3 transition-transform duration-300 group-hover:scale-105">
                                      {entry.logo ? (
                                        <img
                                          src={entry.logo}
                                          alt=""
                                          className="w-full h-full object-contain p-2"
                                          loading="lazy"
                                          onError={e => { (e.target as HTMLImageElement).style.display = 'none'; (e.target as HTMLImageElement).nextElementSibling?.classList.remove('hidden'); }}
                                        />
                                      ) : null}
                                      <div className={`w-full h-full flex items-center justify-center ${entry.logo ? 'hidden' : ''}`}>
                                        <img src={playIconUrl} alt="" className="w-6 h-6 invert opacity-20 select-none pointer-events-none" />
                                      </div>
                                    </div>

                                    {/* Info */}
                                    <div className="flex flex-col min-w-0 w-full flex-1 gap-1.5 items-center text-center overflow-hidden">
                                      {plEditingEntryId === entry.id ? (
                                        <input
                                          autoFocus
                                          defaultValue={entry.name}
                                          className="bg-white/10 text-white text-xs rounded px-1.5 py-0.5 outline-none border border-white/20 w-full text-center"
                                          onBlur={e => renamePlaylistEntry(pl.id, entry.id, e.target.value)}
                                          onKeyDown={e => { if (e.key === 'Enter') renamePlaylistEntry(pl.id, entry.id, (e.target as HTMLInputElement).value); if (e.key === 'Escape') setPlEditingEntryId(null); }}
                                          onClick={e => e.stopPropagation()}
                                        />
                                      ) : (
                                        <PlCardMarquee text={entry.name} className="w-full" textClassName="text-xs font-medium text-white/90 leading-tight w-full" />
                                      )}
                                      <div className="flex items-center gap-1.5 justify-center flex-nowrap w-full overflow-hidden">
                                        {entry.group && (
                                          <PlCardMarquee
                                            text={entry.group}
                                            className="max-w-[60px] flex-shrink-0"
                                            textClassName="text-[10px] text-white/50 uppercase leading-none"
                                            style={{ flex: '0 1 auto' }}
                                          />
                                        )}
                                        {entry.duration > 0 && (
                                          <span className="text-[10px] text-white/25 flex-shrink-0">
                                            {entry.duration >= 3600
                                              ? `${Math.floor(entry.duration / 3600)}:${String(Math.floor((entry.duration % 3600) / 60)).padStart(2, '0')}:${String(entry.duration % 60).padStart(2, '0')}`
                                              : `${Math.floor(entry.duration / 60)}:${String(entry.duration % 60).padStart(2, '0')}`
                                            }
                                          </span>
                                        )}
                                      </div>
                                    </div>

                                    {/* Actions */}
                                    <div className="absolute top-2 right-2 flex flex-col items-center gap-1 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" onClick={e => e.stopPropagation()}>
                                      <button
                                        className="p-1.5 rounded-full text-white/20 hover:text-yellow-400 hover:bg-white/10 transition-colors border-none bg-black/20 backdrop-blur-md cursor-pointer"
                                        onClick={() => toggleFavorite(pl.id, entry.id)}
                                        title="Toggle favorite"
                                      >
                                        {entry.isFavorite ? <StarFilled className="w-3.5 h-3.5 text-yellow-400" /> : <Star className="w-3.5 h-3.5" />}
                                      </button>
                                      <button
                                        className="p-1.5 rounded-full text-white/20 hover:text-white/80 hover:bg-white/10 transition-colors border-none bg-black/20 backdrop-blur-md cursor-pointer"
                                        onClick={() => setPlEditingEntryId(entry.id)}
                                        title="Rename"
                                      >
                                        <Edit3 className="w-3.5 h-3.5" />
                                      </button>
                                      <button
                                        className="p-1.5 rounded-full text-white/20 hover:text-red-400 hover:bg-white/10 transition-colors border-none bg-black/20 backdrop-blur-md cursor-pointer"
                                        onClick={() => deletePlaylistEntry(pl.id, entry.id)}
                                        title="Remove"
                                      >
                                        <X className="w-3.5 h-3.5" />
                                      </button>
                                    </div>
                                  </div>
                                ))
                              )}
                              {/* Lazy loading sentinel */}
                              {hasMore && <div ref={plSentinelRef} className="col-span-full h-12 flex items-center justify-center w-full mt-2"><Loader2 className="w-5 h-5 text-white/20 animate-spin" /></div>}
                            </div>
                          </motion.div>
                        );
                      })()
                    )}
                  </AnimatePresence>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── TV / Live Streams Popup ── */}
        <div
          className={`fixed inset-0 z-[900] flex items-center justify-center ${isTvOpen ? "pointer-events-auto" : "pointer-events-none"}`}
        >
          <div
            className={`absolute inset-0 transition-all duration-300 ease-out ${isTvOpen
              ? "bg-black/40 opacity-100"
              : "bg-transparent opacity-0 pointer-events-none"}`}
            onClick={() => setIsTvOpen(false)}
          ></div>

          <div
            className={`glass-panel app-modal-window relative z-10 mx-4 flex transform flex-col gap-4 p-5 shadow-2xl shadow-black/40 transition-all duration-300 ease-out ${isTvOpen ? "scale-100 opacity-100" : "scale-95 opacity-0"}`}
          >
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <div className="flex items-center gap-2.5 min-w-0">
                <Tv className="h-4 w-4 text-white/40 flex-shrink-0" />
                <h3 className="text-sm font-medium text-white/70">Live Streams</h3>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <button
                  onClick={() => fetchPpvStreams()}
                  className="rounded-full p-1 text-white/30 transition-colors hover:bg-white/5 hover:text-white/60"
                  title="Refresh"
                >
                  <RotateCcw className={`h-3.5 w-3.5 ${tvLoading ? "animate-spin" : ""}`} />
                </button>
                <button
                  onClick={() => setIsTvOpen(false)}
                  className="rounded-full p-1 text-white/40 transition-colors hover:bg-white/5 hover:text-white/80 flex-shrink-0"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* Category filter tabs */}
            {tvStreams.length > 0 && (() => {
              const categories = ["all", ...Array.from(new Set(tvStreams.map(s => s.category))).sort()];
              return (
                <div className="tv-category-tabs">
                  {categories.map(cat => (
                    <button
                      key={cat}
                      className={`tv-cat-tab ${tvFilter === cat ? "active" : ""}`}
                      onClick={() => setTvFilter(cat)}
                    >
                      {cat === "all" ? "All" : cat}
                    </button>
                  ))}
                </div>
              );
            })()}

            {/* Stream list */}
            <div className="tv-scroll-area">
              {tvLoading && tvStreams.length === 0 ? (
                <div className="col-span-full flex flex-col items-center justify-center gap-3 py-12 min-h-[280px]">
                  <div className="tv-spinner"></div>
                  <span className="text-xs text-white/30">Loading streams...</span>
                </div>
              ) : tvError && tvStreams.length === 0 ? (
                <div className="col-span-full flex h-full min-h-[280px] flex-col items-center justify-center gap-2 py-12">
                  <AlertCircle className="h-5 w-5 text-white/20" />
                  <span className="text-xs text-white/30">Connection Error</span>
                  <button
                    onClick={() => fetchPpvStreams()}
                    className="mt-1 rounded-lg px-3 py-1 text-[11px] text-white/40 ring-1 ring-white/10 transition-all hover:bg-white/5 hover:text-white/60"
                  >
                    Retry
                  </button>
                </div>
              ) : (() => {
                const now = Math.floor(Date.now() / 1000);
                void tvTick; // force re-render on tick
                const filtered = tvStreams
                  .filter(s => tvFilter === "all" || String(s.category).toLowerCase() === tvFilter.toLowerCase())
                  .sort((a, b) => {
                    const aLive = a.alwaysLive || (now >= a.startsAt && now < a.endsAt);
                    const bLive = b.alwaysLive || (now >= b.startsAt && now < b.endsAt);
                    if (aLive && !bLive) return -1;
                    if (!aLive && bLive) return 1;
                    if (aLive && bLive) {
                      const aViewers = parseInt(String(a.viewers || "0").replace(/\D/g, "")) || 0;
                      const bViewers = parseInt(String(b.viewers || "0").replace(/\D/g, "")) || 0;
                      if (aViewers !== bViewers) return bViewers - aViewers;
                    }
                    return (a.startsAt || 0) - (b.startsAt || 0);
                  });

                if (filtered.length === 0) {
                  return (
                    <div className="col-span-full flex items-center justify-center py-12 text-xs text-white/25">
                      No streams in this category
                    </div>
                  );
                }

                return filtered.map((stream, idx) => {
                  const isLive = stream.alwaysLive || (now >= stream.startsAt && now < stream.endsAt);
                  const isUpcoming = !isLive && stream.startsAt > now;
                  const isEnded = !isLive && stream.endsAt <= now;

                  let timeLabel = "";
                  if (isLive) {
                    timeLabel = "LIVE";
                  } else if (isUpcoming) {
                    const diff = stream.startsAt - now;
                    const h = Math.floor(diff / 3600);
                    const m = Math.floor((diff % 3600) / 60);
                    const s = diff % 60;
                    if (h > 0) {
                      timeLabel = `${h}h ${m}m`;
                    } else if (m > 0) {
                      timeLabel = `${m}m ${s}s`;
                    } else {
                      timeLabel = `${s}s`;
                    }
                  } else if (isEnded) {
                    timeLabel = "Ended";
                  }

                  return (
                    <div
                      key={stream.id || idx}
                      className={`tv-stream-item ${isEnded ? "opacity-40" : ""}`}
                      style={{ animationDelay: `${idx * 30}ms` }}
                      onClick={() => {
                        if (!stream.iframe || isEnded) return;
                        setIsTvOpen(false);
                        setUrlInput(stream.iframe);
                        setIsLoaderOpen(false);
                        // Load the pooembed URL through existing flow
                        setTimeout(() => {
                          const electron = getElectronApi();
                          if (electron?.ipcRenderer) {
                            const cleanUrl = sanitizeOnlineUrl(stream.iframe);
                            if (cleanUrl) {
                              setVideoTitle(stream.name || "Live Stream");
                              stableVideoTitleRef.current = stream.name || "Live Stream";
                              setIsOnlineLoading(true);
                              setOnlineLoadingText("Connecting to stream...");
                              loadedUrlInputRef.current = cleanUrl;
                              setActiveOnlineUrl(cleanUrl);
                              electron.ipcRenderer.send("fetch-online-video", cleanUrl);
                            }
                          }
                        }, 100);
                      }}
                    >
                      <div className="tv-poster-wrap">
                        <div className="tv-poster-inner">
                          {stream.poster ? (
                            <img
                              src={stream.poster}
                              alt=""
                              className="tv-poster"
                              loading="lazy"
                              onError={(e) => {
                                (e.target as HTMLImageElement).style.display = "none";
                              }}
                            />
                          ) : (
                            <div className="tv-poster-placeholder">
                              <Tv className="h-8 w-8 text-white/5" />
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="tv-item-content">
                        <span className="tv-item-title" title={stream.name}>
                          {stream.name}
                        </span>
                        <div className="tv-item-meta">
                          <span className="tv-item-tag">{stream.tag}</span>
                          {Number(stream.viewers) > 0 && isLive && (
                            <>
                              <span className="tv-meta-divider">•</span>
                              <span className="tv-item-viewers">{stream.viewers} watching</span>
                            </>
                          )}
                        </div>
                        <div className="tv-item-category-row">
                          <div className="tv-item-category">
                            <span>{stream.category}</span>
                          </div>

                          <div className="tv-status-badge">
                            {isLive ? (
                              <div className="tv-live-badge">
                                <span>LIVE</span>
                              </div>
                            ) : isUpcoming ? (
                              <div className="tv-countdown">
                                <span>{timeLabel}</span>
                              </div>
                            ) : (
                              <div className="tv-ended-badge">
                                <span>ENDED</span>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                });
              })()}
            </div>
          </div>
        </div>

        <div
          className={`fixed inset-0 z-[900] flex items-center justify-center ${isDownloadOpen ? "pointer-events-auto" : "pointer-events-none"}`}
        >
          <div
            className={`absolute inset-0 transition-all duration-300 ease-out ${isDownloadOpen
              ? "bg-black/40 opacity-100"
              : "bg-transparent opacity-0 pointer-events-none"}`}
            onClick={() => setIsDownloadOpen(false)}
          ></div>

          <div
            className={`glass-panel app-modal-window relative z-10 mx-4 shadow-xl shadow-black/20 transition-all duration-300 ease-out ${isDownloadOpen ? "scale-100 opacity-100" : "scale-95 opacity-0"}`}
          >
            {/* ── Header ── */}
            <div className="dl-header">
              <div className="dl-header-title">
                <ArrowDownToLine className="h-4 w-4 text-white/35 flex-shrink-0" />
                <h3>Download Manager</h3>
              </div>
              <button className="dl-header-close" onClick={() => setIsDownloadOpen(false)}>
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* ── Tabs with animated indicator ── */}
            <div className="dl-tabs" ref={(el) => {
              if (!el) return;
              const activeBtn = el.querySelector('.dl-tab.active') as HTMLElement;
              const indicator = el.querySelector('.dl-tab-indicator') as HTMLElement;
              if (activeBtn && indicator) {
                indicator.style.left = `${activeBtn.offsetLeft}px`;
                indicator.style.width = `${activeBtn.offsetWidth}px`;
              }
            }}>
              {(() => {
                const isYoutubePage = activeOnlineUrl && (activeOnlineUrl.includes('youtube.com') || activeOnlineUrl.includes('youtu.be'));
                return (
                  <>
                    <button className={`dl-tab ${dlTab === "links" ? "active" : ""}`} onClick={() => setDlTab("links")}>Video</button>
                    <button
                      className={`dl-tab ${dlTab === "audio" ? "active" : ""} ${!isYoutubePage ? "opacity-50 cursor-not-allowed" : ""}`}
                      title={!isYoutubePage ? "Audio download is available for YouTube only" : ""}
                      onClick={() => {
                        if (isYoutubePage) setDlTab("audio");
                      }}
                    >
                      Audio
                    </button>
                  </>
                );
              })()}
              <button className={`dl-tab ${dlTab === "progress" ? "active" : ""}`} onClick={() => setDlTab("progress")}>
                <div className="flex items-center justify-center gap-2">
                  Progress
                  {(() => {
                    const isActive = Object.values(dlProgress).some(d => d.status === "downloading");
                    if (!isActive) return null;
                    return (
                      <span className="h-1.5 w-1.5 rounded-full bg-white opacity-80" />
                    );
                  })()}
                </div>
              </button>
              <button className={`dl-tab ${dlTab === "settings" ? "active" : ""}`} onClick={() => setDlTab("settings")}>Settings</button>
              <div className="dl-tab-indicator" />
            </div>

            {/* ── Content area ── */}
            <div className="dl-content">

              {/* ── Qualities tab ── */}
              {dlTab === "links" && (
                <div className="dl-scroll-area flex flex-col gap-1">
                  {!videoSrc ? (
                    <div className="flex-1 flex items-center justify-center text-xs text-white/30">No video is currently loaded</div>
                  ) : isDemuxedLocalFile || videoSrc.startsWith("file://") || videoSrc.startsWith("safe-file://") ? (
                    <div className="flex-1 flex items-center justify-center text-xs text-white/30">Local file — nothing to download</div>
                  ) : qualityOptions.length > 0 && qualityOptions[0]?.value !== "undefined" && qualityOptions[0]?.value !== "Default" ? (
                    <>
                      {qualityOptions.map((opt: any, i: number) => {
                        const baseId = activeOnlineUrl || videoSrc || videoTitle || "video";
                        let hash = 0;
                        for (let j = 0; j < baseId.length; j++) {
                          hash = ((hash << 5) - hash) + baseId.charCodeAt(j);
                          hash |= 0;
                        }
                        const videoHash = Math.abs(hash).toString(36);
                        const dlId = `dl-${videoHash}-${i}-${String(opt.label || "").replace(/\s+/g, "")}`;
                        const existing = dlProgress[dlId];
                        return (
                          <div key={dlId} className="dl-item">
                            <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <span className="text-xs font-medium text-white/70 truncate">{opt.label || "Unknown"}</span>

                                {existing && existing.status === "error" && (
                                  <span className="text-[10px] text-red-500/90 flex items-center gap-1 flex-shrink-0 ml-1">
                                    <AlertCircle className="h-3 w-3" /> Failed
                                  </span>
                                )}
                              </div>
                            </div>
                            <div className="flex items-center gap-3">
                              {opt.format && opt.format !== "UND" && (
                                <span className="dl-quality-badge">{opt.format}</span>
                              )}
                              <div className="flex items-center justify-center w-[30px] h-[30px]">
                                {existing && existing.status === "downloading" ? (
                                  <button className={`dl-btn ${existing.total === 'LIVE' ? '' : 'cancel'}`} title={existing.total === 'LIVE' ? 'Finish Recording' : 'Cancel'} onClick={(e) => { e.preventDefault(); e.stopPropagation(); getElectronApi()?.ipcRenderer?.send("cancel-download", { downloadId: dlId, filePath: existing?.filePath }); }}>
                                    <CircleStop className="h-5 w-5" />
                                  </button>
                                ) : existing && existing.status === "complete" && !isYoutubeLive ? (
                                  <CheckCircle2 className="h-4.5 w-4.5 text-green-400/70" />
                                ) : (
                                  <button
                                    className="dl-btn"
                                    title="Download"
                                    onClick={(e) => {
                                      e.preventDefault(); e.stopPropagation();
                                      const electron = getElectronApi();
                                      if (!electron?.ipcRenderer) return;
                                      const safeTitle = String(videoTitle || "video").replace(/[<>:"/\\|?*]+/g, "_").slice(0, 100);
                                      const qualityLabel = String(opt.label || "").replace(/[<>:"/\\|?*]+/g, "_");
                                      const rawOptVal = String(opt.value || "");
                                      const isUrl = /^(https?|file|blob):/.test(rawOptVal);
                                      const isYoutubePage = activeOnlineUrl && (activeOnlineUrl.includes('youtube.com') || activeOnlineUrl.includes('youtu.be'));
                                      const targetUrl = (isUrl ? rawOptVal : (isYoutubePage ? activeOnlineUrl : (videoSrc || activeOnlineUrl))) || "";
                                      const ext = /\.m3u8/i.test(targetUrl) ? "ts" : /\.mpd/i.test(targetUrl) ? "mp4" : "mp4";
                                      const fileName = qualityLabel && qualityLabel !== "undefined" ? `${safeTitle} [${qualityLabel}].${ext}` : `${safeTitle}.${ext}`;
                                      const metadata = {
                                        url: targetUrl,
                                        audioUrl: opt.audioUrl || null,
                                        pageUrl: activeOnlineUrl,
                                        qualityLabel: opt.label || "",
                                        format: String(opt.format || "").toUpperCase(),
                                        isLive: isYoutubeLive
                                      };
                                      setDlProgress((prev) => ({
                                        ...prev,
                                        [dlId]: { percent: 0, speed: "", downloaded: "0 B", total: isYoutubeLive ? "LIVE" : "?", status: "downloading", fileName, label: opt.label || "", startTime: Date.now(), ...metadata }
                                      }));
                                      electron.ipcRenderer.send("start-download", { downloadId: dlId, ...metadata, fileName, savePath: dlSavePath, threads: dlThreads });
                                    }}
                                  >
                                    <Download className="h-4.5 w-4.5" />
                                  </button>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })}

                      {/* ── Subtitle Downloads ── */}
                      {extractedSubtitles.length > 0 && (
                        <>
                          <div className="my-1.5 flex items-center gap-3 px-1 opacity-40">
                            <div className="h-px flex-1 bg-white/40"></div>
                            <span className="text-[9px] font-medium tracking-widest text-white/50 uppercase">Subtitles</span>
                            <div className="h-px flex-1 bg-white/40"></div>
                          </div>
                          {extractedSubtitles.map((sub, si) => {
                            const subExt = String(sub.format || sub.url.split('.').pop()?.split('?')[0] || "srt").toLowerCase();
                            const subFileName = `${String(videoTitle || "video").replace(/[<>:"/\\|?*]+/g, "_").slice(0, 100)} [${sub.label || sub.language || "sub"}].${subExt}`;
                            return (
                              <div key={`sub-dl-${si}`} className="dl-item">
                                <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                                  <span className="text-xs font-medium text-white/70 truncate">{sub.label || sub.language || `Subtitle ${si + 1}`}</span>
                                </div>
                                <div className="flex items-center gap-3">
                                  <span className="dl-quality-badge">{subExt.toUpperCase()}</span>
                                  <div className="flex items-center justify-center w-[30px] h-[30px]">
                                    <button className="dl-btn" title="Download subtitle" onClick={async () => {
                                      try {
                                        const resp = await fetch(sub.url);
                                        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
                                        const blob = await resp.blob();
                                        const a = document.createElement("a");
                                        a.href = URL.createObjectURL(blob);
                                        a.download = subFileName;
                                        document.body.appendChild(a);
                                        a.click();
                                        setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
                                      } catch (err) { console.error("[DL] Subtitle download failed:", err); }
                                    }}>
                                      <Download className="h-4.5 w-4.5" />
                                    </button>
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </>
                      )}
                    </>
                  ) : (
                    (() => {
                      const baseId = activeOnlineUrl || videoSrc || videoTitle || "video";
                      let hash = 0;
                      for (let j = 0; j < baseId.length; j++) {
                        hash = ((hash << 5) - hash) + baseId.charCodeAt(j);
                        hash |= 0;
                      }
                      const videoHash = Math.abs(hash).toString(36);
                      const directDlId = `dl-direct-${videoHash}`;
                      const ex = dlProgress[directDlId];
                      return (
                        <>
                          <div className="dl-item">
                            <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <span className="text-xs font-medium text-white/70 truncate">{videoTitle || "Current video"}</span>

                                {ex?.status === "error" && <span className="text-[10px] text-red-500/90 flex items-center gap-1 flex-shrink-0 ml-1"><AlertCircle className="h-3 w-3" /> Failed</span>}
                              </div>
                            </div>
                            <div className="flex items-center gap-3">
                              {format && format !== "UND" && <span className="dl-quality-badge">{format}</span>}
                              <div className="flex items-center justify-center w-[30px] h-[30px]">
                                {ex?.status === "downloading" ? (
                                  <button className={`dl-btn ${ex?.total === 'LIVE' ? '' : 'cancel'}`} title={ex?.total === 'LIVE' ? 'Finish Recording' : 'Cancel'} onClick={(e) => { e.preventDefault(); e.stopPropagation(); getElectronApi()?.ipcRenderer?.send("cancel-download", { downloadId: directDlId, filePath: ex?.filePath }); }}>
                                    <CircleStop className="h-5 w-5" />
                                  </button>
                                ) : ex?.status === "complete" && !isYoutubeLive ? (
                                  <CheckCircle2 className="h-4.5 w-4.5 text-green-400/70" />
                                ) : (
                                  <button className="dl-btn" title="Download" onClick={(e) => {
                                    e.preventDefault(); e.stopPropagation();
                                    const electron = getElectronApi();
                                    if (!electron?.ipcRenderer || !videoSrc) return;
                                    const safeTitle = String(videoTitle || "video").replace(/[<>:"/\\|?*]+/g, "_").slice(0, 100);
                                    const fileName = `${safeTitle}.mp4`;
                                    const metadata = { url: videoSrc, audioUrl: audioSrc || null, pageUrl: activeOnlineUrl, qualityLabel: "Default", isLive: isYoutubeLive };
                                    setDlProgress((prev) => ({ ...prev, [directDlId]: { percent: 0, speed: "", downloaded: "0 B", total: isYoutubeLive ? "LIVE" : "?", status: "downloading", fileName, label: "Default", format: format || "MP4", startTime: Date.now(), ...metadata } }));
                                    electron.ipcRenderer.send("start-download", { downloadId: directDlId, ...metadata, fileName, savePath: dlSavePath, threads: dlThreads });
                                  }}>
                                    <Download className="h-5 w-5" />
                                  </button>
                                )}
                              </div>
                            </div>
                          </div>

                          {/* ── Subtitle Downloads (single-quality fallback) ── */}
                          {extractedSubtitles.length > 0 && (
                            <>
                              <div className="my-1.5 flex items-center gap-3 px-1 opacity-40">
                                <div className="h-px flex-1 bg-white/40"></div>
                                <span className="text-[9px] font-medium tracking-widest text-white/50 uppercase">Subtitles</span>
                                <div className="h-px flex-1 bg-white/40"></div>
                              </div>
                              {extractedSubtitles.map((sub, si) => {
                                const subExt = String(sub.format || sub.url.split('.').pop()?.split('?')[0] || "srt").toLowerCase();
                                const subFileName = `${String(videoTitle || "video").replace(/[<>:"/\\|?*]+/g, "_").slice(0, 100)} [${sub.label || sub.language || "sub"}].${subExt}`;
                                return (
                                  <div key={`sub-dl-${si}`} className="dl-item">
                                    <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                                      <span className="text-xs font-medium text-white/70 truncate">{sub.label || sub.language || `Subtitle ${si + 1}`}</span>
                                    </div>
                                    <div className="flex items-center gap-3">
                                      <span className="dl-quality-badge">{subExt.toUpperCase()}</span>
                                      <div className="flex items-center justify-center w-[30px] h-[30px]">
                                        <button className="dl-btn" title="Download subtitle" onClick={async () => {
                                          try {
                                            const resp = await fetch(sub.url);
                                            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
                                            const blob = await resp.blob();
                                            const a = document.createElement("a");
                                            a.href = URL.createObjectURL(blob);
                                            a.download = subFileName;
                                            document.body.appendChild(a);
                                            a.click();
                                            setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
                                          } catch (err) { console.error("[DL] Subtitle download failed:", err); }
                                        }}>
                                          <Download className="h-4.5 w-4.5" />
                                        </button>
                                      </div>
                                    </div>
                                  </div>
                                );
                              })}
                            </>
                          )}
                        </>
                      );
                    })()
                  )}
                </div>
              )}

              {/* ── Audio tab ── */}
              {dlTab === "audio" && (
                <div className="dl-scroll-area flex flex-col gap-5 px-2 py-4">
                  {(() => {
                    const isYoutubePage = activeOnlineUrl && (activeOnlineUrl.includes('youtube.com') || activeOnlineUrl.includes('youtu.be'));
                    if (!isYoutubePage) {
                      return <div className="flex-1 flex items-center justify-center text-xs text-white/30 text-center px-4">Audio download is available for YouTube only</div>;
                    }

                    const audioCodecs = [
                      { id: "m4a", label: "AAC" },
                      { id: "mp3", label: "MP3" },
                      { id: "opus", label: "Opus" },
                      { id: "flac", label: "FLAC" },
                      { id: "wav", label: "PCM (WAV)" },
                      { id: "eac3", label: "EAC-3" },
                      { id: "ac3", label: "AC-3" },
                    ];

                    const bitrates = [
                      { id: "best", label: "Best Available" },
                      { id: "320", label: "320 kbps" },
                      { id: "256", label: "256 kbps" },
                      { id: "192", label: "192 kbps" },
                      { id: "160", label: "160 kbps" },
                      { id: "128", label: "128 kbps" },
                      { id: "96", label: "96 kbps" },
                      { id: "64", label: "64 kbps" },
                    ];

                    return (
                      <>
                        <div className="flex flex-col gap-2">
                          <span className="text-[10px] font-medium tracking-widest text-white/50 uppercase ml-1">Format / Codec</span>
                          <div className="flex flex-wrap gap-2">
                            {audioCodecs.map((codec) => (
                              <button
                                key={codec.id}
                                onClick={() => setAudioCodecPref(codec.id)}
                                className={`px-3 py-1.5 rounded-full text-xs transition-colors duration-200 ${audioCodecPref === codec.id ? "bg-white/15 text-white" : "bg-white/5 text-white/60 hover:bg-white/10 hover:text-white/80"}`}
                              >
                                {codec.label}
                              </button>
                            ))}
                          </div>
                        </div>

                        <div className="flex flex-col gap-2">
                          <span className="text-[10px] font-medium tracking-widest text-white/50 uppercase ml-1">Audio Quality</span>
                          <div className="relative">
                            <select
                              value={audioBitratePref}
                              onChange={(e) => setAudioBitratePref(e.target.value)}
                              className="w-full appearance-none rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-sm text-white focus:border-white/20 focus:outline-none transition-colors"
                            >
                              {bitrates.map(b => (
                                <option key={b.id} value={b.id} className="bg-[#1a1a1a] text-white">
                                  {b.label}
                                </option>
                              ))}
                            </select>
                            <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-3 text-white/50">
                              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6" /></svg>
                            </div>
                          </div>
                        </div>

                        <div className="mt-4 pt-4 border-t border-white/10">
                          {(() => {
                            const baseId = activeOnlineUrl || videoSrc || videoTitle || "audio";
                            let hash = 0;
                            for (let j = 0; j < baseId.length; j++) {
                              hash = ((hash << 5) - hash) + baseId.charCodeAt(j);
                              hash |= 0;
                            }
                            const videoHash = Math.abs(hash).toString(36);
                            const dlId = `dl-audio-${videoHash}-${audioCodecPref}`;
                            const existing = dlProgress[dlId];

                            if (existing && existing.status === "downloading") {
                              return (
                                <button
                                  className="w-full flex items-center justify-center gap-2 rounded-lg bg-white/10 hover:bg-white/15 text-white py-3 text-sm font-medium transition-colors border border-white/5"
                                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); getElectronApi()?.ipcRenderer?.send("cancel-download", { downloadId: dlId, filePath: existing?.filePath }); }}
                                >
                                  <CircleStop className="h-5 w-5" />
                                  Cancel Download
                                </button>
                              );
                            }

                            if (existing && existing.status === "complete") {
                              return (
                                <button className="w-full flex items-center justify-center gap-2 rounded-lg bg-white/5 text-white/50 py-3 text-sm font-medium cursor-default border border-white/5">
                                  <CheckCircle2 className="h-5 w-5" />
                                  Download Complete
                                </button>
                              );
                            }

                            return (
                              <button
                                className="w-full flex items-center justify-center gap-2 rounded-lg bg-white/10 hover:bg-white/15 text-white py-3 text-sm font-medium transition-colors border border-white/5 shadow-[0_0_15px_rgba(255,255,255,0.05)] hover:shadow-[0_0_20px_rgba(255,255,255,0.1)]"
                                onClick={(e) => {
                                  e.preventDefault(); e.stopPropagation();
                                  const electron = getElectronApi();
                                  if (!electron?.ipcRenderer) return;
                                  const safeTitle = String(videoTitle || "video").replace(/[<>:"/\\|?*]+/g, "_").slice(0, 100);
                                  const ext = audioCodecPref === 'm4a' ? 'm4a' : audioCodecPref === 'ac3' ? 'ac3' : audioCodecPref === 'eac3' ? 'eac3' : audioCodecPref;
                                  const fileName = `${safeTitle} [Audio].${ext}`;

                                  const metadata = {
                                    url: activeOnlineUrl,
                                    audioUrl: null,
                                    pageUrl: activeOnlineUrl,
                                    qualityLabel: `${audioCodecPref.toUpperCase()}${audioBitratePref !== 'best' ? ' ' + audioBitratePref + 'kbps' : ''}`,
                                    format: "AUDIO",
                                    isLive: isYoutubeLive,
                                    audioOnly: true,
                                    audioCodec: audioCodecPref,
                                    audioQuality: audioBitratePref
                                  };

                                  setDlProgress((prev) => ({
                                    ...prev,
                                    [dlId]: { percent: 0, speed: "", downloaded: "0 B", total: isYoutubeLive ? "LIVE" : "?", status: "downloading", fileName, label: metadata.qualityLabel, startTime: Date.now(), ...metadata }
                                  }));

                                  electron.ipcRenderer.send("start-download", { downloadId: dlId, ...metadata, fileName, savePath: dlSavePath, threads: dlThreads });
                                }}
                              >
                                <Download className="h-5 w-5" />
                                Download Audio
                              </button>
                            );
                          })()}
                        </div>
                      </>
                    );
                  })()}
                </div>
              )}

              {/* ── Progress tab ── */}
              {dlTab === "progress" && (
                <div className="dl-scroll-area flex flex-col gap-1">
                  {Object.keys(dlProgress).length === 0 ? (
                    <div className="flex-1 flex items-center justify-center text-xs text-white/30">No downloads yet</div>
                  ) : (
                    Object.entries(dlProgress).map(([dlId, info]) => {
                      const isComplete = info.status === "complete";
                      const isError = info.status === "error";
                      const isPaused = info.status === "paused";
                      const isDownloading = info.status === "downloading";
                      return (
                        <div key={dlId} className="dl-item flex-col !items-start !gap-2">
                          <div className="flex items-center gap-2 w-full">
                            <div className="min-w-0 flex-1">
                              <span className="text-xs font-medium text-white/70 truncate block">{info.fileName || info.label}</span>
                            </div>
                            <div className="flex gap-1 flex-shrink-0">
                              {isDownloading && (
                                <>
                                  {info.total === 'LIVE' ? (
                                    <button className="dl-btn" title="Finish Recording" onClick={(e) => { e.preventDefault(); e.stopPropagation(); getElectronApi()?.ipcRenderer?.send("cancel-download", { downloadId: dlId, filePath: info.filePath }); }}>
                                      <CircleStop className="h-5 w-5" />
                                    </button>
                                  ) : (
                                    <>
                                      <button className="dl-btn" title="Pause" onClick={(e) => { e.preventDefault(); e.stopPropagation(); getElectronApi()?.ipcRenderer?.send("pause-download", { downloadId: dlId }); }}>
                                        <CirclePause className="h-5 w-5" />
                                      </button>
                                      <button className="dl-btn cancel" title="Cancel" onClick={(e) => { e.preventDefault(); e.stopPropagation(); getElectronApi()?.ipcRenderer?.send("cancel-download", { downloadId: dlId, filePath: info.filePath, forceCancel: true }); }}>
                                        <X className="h-5 w-5" />
                                      </button>
                                    </>
                                  )}
                                </>
                              )}
                              {isPaused && info.total !== 'LIVE' && (
                                <>
                                  <button className="dl-btn" title="Resume" onClick={(e) => {
                                    e.preventDefault(); e.stopPropagation();
                                    const metadata = { url: info.url, audioUrl: info.audioUrl || null, pageUrl: info.pageUrl, qualityLabel: info.qualityLabel || "" };
                                    setDlProgress((prev) => ({ ...prev, [dlId]: { ...prev[dlId], status: "downloading" as const } }));
                                    getElectronApi()?.ipcRenderer?.send("start-download", { downloadId: dlId, ...metadata, fileName: info.fileName, savePath: dlSavePath, isResume: true, threads: dlThreads });
                                  }}>
                                    <CirclePlay className="h-5 w-5" />
                                  </button>
                                  <button className="dl-btn cancel" title="Delete" onClick={(e) => { e.preventDefault(); e.stopPropagation(); getElectronApi()?.ipcRenderer?.send("cancel-download", { downloadId: dlId, filePath: info.filePath }); }}>
                                    <X className="h-5 w-5" />
                                  </button>
                                </>
                              )}
                              {isError && (
                                <>
                                  <button className="dl-btn" title="Retry" onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleRetryDownload(dlId); }}>
                                    <RotateCcw className="h-4.5 w-4.5" />
                                  </button>
                                  <button className="dl-btn cancel" title="Delete" onClick={(e) => { e.preventDefault(); e.stopPropagation(); getElectronApi()?.ipcRenderer?.send("cancel-download", { downloadId: dlId, filePath: info.filePath }); }}>
                                    <X className="h-4.5 w-4.5" />
                                  </button>
                                </>
                              )}
                              {isComplete && (
                                <>
                                  <div className="flex items-center justify-center w-[30px] h-[30px] mr-1">
                                    <CheckCircle2 className="h-4.5 w-4.5 text-white/50" />
                                  </div>
                                  <button className="dl-btn cancel" title="Delete File & Remove" onClick={(e) => {
                                    e.preventDefault(); e.stopPropagation();
                                    setDeleteConfirm({ dlId, filePath: info.filePath });
                                  }}>
                                    <X className="h-4.5 w-4.5" />
                                  </button>
                                </>
                              )}
                            </div>
                          </div>

                          {!isComplete && !isError && info.total !== 'LIVE' && (
                            <div className="w-full">
                              <div className="dl-progress-track">
                                <div className="dl-progress-fill" style={{ width: `${info.percent}%` }}></div>
                              </div>
                            </div>
                          )}

                          <div className="flex items-center justify-between w-full">
                            <span className="text-[10px] text-white/30">
                              {isDownloading && (
                                info.total === 'LIVE'
                                  ? <span className="text-white/70 font-medium flex items-center gap-1.5">
                                    <span className="recording-text-anim tracking-wide">Recording</span>
                                    <span className="opacity-40">&bull;</span>
                                    <RecordingTimer startTime={info.startTime || Date.now()} />
                                    <span className="opacity-40">&bull;</span>
                                    <span>{info.downloaded}</span>
                                  </span>
                                  : `${info.downloaded} / ${info.total}`
                              )}
                              {isComplete && "Download Complete"}
                              {isError && (
                                <span className="text-red-400/70 flex items-center gap-1.5 truncate max-w-[200px]" title={info.errorMessage}>
                                  <AlertCircle className="h-3 w-3" /> {info.errorMessage || "Error"}
                                </span>
                              )}
                              {isPaused && `Paused (${info.percent}%)`}
                            </span>
                            {(isDownloading || isPaused || isComplete) && (
                              <span className="text-[10px] text-white/30 truncate max-w-[150px]">
                                {info.isMerging ? (
                                  <span className="text-white/70 animate-pulse">{info.fileName?.includes('[Audio]') ? "Processing audio format..." : "Merging video & audio..."}</span>
                                ) : isComplete ? (
                                  info.format || ""
                                ) : (
                                  info.total === 'LIVE' ? info.speed : `${info.speed} · ${info.percent}%`
                                )}
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              )}

              {/* ── Settings tab ── */}
              {dlTab === "settings" && (
                <div className="dl-settings-group">
                  <div className="dl-setting-row">
                    <span className="dl-setting-label">Save Location</span>
                    <div className="dl-save-path">
                      <Folder className="h-3.5 w-3.5 text-white/25 flex-shrink-0" />
                      <span className="dl-save-path-text">{dlSavePath || "Default downloads folder"}</span>
                      <button
                        className="dl-save-browse"
                        onClick={async () => {
                          const electron = getElectronApi();
                          if (!electron?.ipcRenderer?.invoke) return;
                          try {
                            const result = await electron.ipcRenderer.invoke("pick-download-folder");
                            if (result) setDlSavePath(result);
                          } catch { }
                        }}
                      >Browse</button>
                    </div>
                  </div>

                  <div className="dl-setting-row">
                    <span className="dl-setting-label">Concurrent Threads</span>
                    <div className="dl-threads-container">
                      <span className="dl-threads-label">Parallel download connections</span>
                      <div className="dl-threads-control">
                        {(() => {
                          const opts = [1, 2, 4, 8, 16, 24, 32];
                          const idx = opts.indexOf(dlThreads);
                          return (
                            <>
                              <button className="dl-thread-nav" disabled={idx <= 0} onClick={() => idx > 0 && setDlThreads(opts[idx - 1])}>
                                <ChevronLeft className="h-3.5 w-3.5" />
                              </button>
                              <div key={dlThreads} className="dl-thread-value animate-thread">{dlThreads}</div>
                              <button className="dl-thread-nav" disabled={idx >= opts.length - 1} onClick={() => idx < opts.length - 1 && setDlThreads(opts[idx + 1])}>
                                <ChevronRight className="h-3.5 w-3.5" />
                              </button>
                            </>
                          );
                        })()}
                      </div>
                    </div>
                  </div>

                  <div className="dl-setting-row">
                    <span className="dl-setting-label">Proxy Server</span>
                    <div className="flex items-center w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 transition-all duration-300 focus-within:border-white/20 focus-within:bg-white/10 gap-2">
                      <Globe className="h-4 w-4 text-white/40 flex-shrink-0" />
                      <input
                        type="text"
                        placeholder="e.g. http://127.0.0.1:7890"
                        className="bg-transparent text-white placeholder-white/25 text-xs outline-none border-none w-full"
                        value={dlProxy}
                        onChange={(e) => setDlProxy(e.target.value)}
                      />
                    </div>
                  </div>
                </div>
              )}

            </div>
          </div>
        </div>

        {/* ── Delete Confirm Modal ── */}
        <div
          className={`fixed inset-0 z-[1000] flex items-center justify-center ${deleteConfirm ? "pointer-events-auto" : "pointer-events-none"}`}
        >
          <div
            className={`absolute inset-0 transition-all duration-300 ease-out ${deleteConfirm
              ? "bg-black/60 opacity-100"
              : "bg-transparent opacity-0 pointer-events-none"}`}
            onClick={() => setDeleteConfirm(null)}
          ></div>

          <div
            className={`glass-panel relative z-10 mx-4 w-full max-w-[480px] shadow-2xl shadow-black/50 transition-all duration-300 ease-out ${deleteConfirm ? "scale-100 opacity-100" : "scale-95 opacity-0"} flex flex-col p-8`}
          >
            <div className="flex items-center justify-center gap-2.5 mb-4">
              <Trash2 className="w-5 h-5 text-white" />
              <h3 className="text-lg font-medium text-white tracking-wide m-0 leading-none mt-1">Delete File</h3>
            </div>

            <p className="text-center text-[13px] text-white/70 leading-relaxed m-0 px-2 mb-8 max-w-[90%] mx-auto">
              This will permanently delete the file from your computer and clear it from your progress list.
            </p>

            <div className="flex justify-center gap-6 w-full">
              <button
                className="py-2.5 px-8 text-sm font-medium text-white/80 hover:text-white bg-white/10 hover:bg-white/20 rounded-full transition-colors border-none cursor-pointer"
                onClick={() => setDeleteConfirm(null)}
              >
                Cancel
              </button>
              <button
                className="py-2.5 px-8 text-sm font-medium text-white/90 hover:text-white bg-white/10 hover:bg-white/20 rounded-full transition-colors border-none cursor-pointer"
                onClick={() => {
                  if (deleteConfirm) {
                    getElectronApi()?.ipcRenderer?.send("cancel-download", { downloadId: deleteConfirm.dlId, filePath: deleteConfirm.filePath });
                  }
                  setDeleteConfirm(null);
                }}
              >
                Delete
              </button>
            </div>
          </div>
        </div>

        {/* ── Dead Stream Notification Modal ── */}
        <div
          className={`fixed inset-0 z-[1000] flex items-center justify-center ${deadStreamNotify ? "pointer-events-auto" : "pointer-events-none"}`}
        >
          <div
            className={`absolute inset-0 transition-all duration-300 ease-out ${deadStreamNotify
              ? "bg-black/60 opacity-100"
              : "bg-transparent opacity-0 pointer-events-none"}`}
            onClick={() => setDeadStreamNotify(null)}
          ></div>

          <div
            className={`glass-panel relative z-10 mx-4 w-full max-w-[480px] shadow-2xl shadow-black/50 transition-all duration-300 ease-out ${deadStreamNotify ? "scale-100 opacity-100" : "scale-95 opacity-0"} flex flex-col p-8`}
          >
            <div className="flex items-center justify-center gap-2.5 mb-4">
              <AlertCircle className="w-5 h-5 text-white" />
              <h3 className="text-lg font-medium text-white tracking-wide m-0 leading-none mt-1">Dead Stream</h3>
            </div>

            <p className="text-center text-[13px] text-white/70 leading-relaxed m-0 px-2 mb-8 max-w-[90%] mx-auto">
              "{deadStreamNotify?.streamName}" is currently offline or unplayable.
            </p>

            <div className="flex justify-center gap-6 w-full">
              <button
                className="py-2.5 px-8 text-sm font-medium text-white/80 hover:text-white bg-white/10 hover:bg-white/20 rounded-full transition-colors border-none cursor-pointer"
                onClick={() => setDeadStreamNotify(null)}
              >
                Cancel
              </button>
              <button
                className="py-2.5 px-8 text-sm font-medium text-white/90 hover:text-white bg-white/10 hover:bg-white/20 rounded-full transition-colors border-none cursor-pointer"
                onClick={() => {
                  setDeadStreamNotify(null);
                  playNextEntryRef.current();
                }}
              >
                Skip to Next
              </button>
            </div>
          </div>
        </div>

        <div
          className={`video-container group ${!isPlaying ? "paused" : ""} ${isSettingsOpen ? "settings-open" : ""
            } ${!showControls && isPlaying && !isSettingsOpen ? "fade-out" : ""}`}
          id="video-container"
          onMouseMove={resetControlsTimer}
          onMouseLeave={() => isPlaying && !isSettingsOpen && setShowControls(false)}
        >
          <video
            id="main-video"
            ref={videoRef}
            src={(!isHlsSource && !isDashSource) ? videoSrc || undefined : undefined}
            playsInline
            preload="auto"
            onError={stableHandleVideoError}
            onClick={(e) => {
              if (e.detail === 1) handlePlayPause();
            }}
            onDoubleClick={(e) => {
              e.preventDefault();
              toggleFullscreen();
            }}
          ></video>

          <canvas
            ref={overlayCanvasRef}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: '100%',
              objectFit: 'contain',
              pointerEvents: 'none',
              zIndex: 1,
              opacity: 0,
            }}
          />

          {isCustomPipActive && (
            <div className="custom-pip-overlay">
              <div className="custom-pip-top-bar">
                <button onClick={(e) => { e.stopPropagation(); getElectronApi()?.ipcRenderer?.send("window-minimize"); }}>
                  <Minus className="h-4 w-4" />
                </button>
                <button onClick={(e) => { e.stopPropagation(); togglePip(); }}>
                  <SquareArrowOutUpRight className="h-4 w-4" />
                </button>
                <button onClick={(e) => { e.stopPropagation(); getElectronApi()?.ipcRenderer?.send("window-close"); }}>
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="custom-pip-center">
                <button className="custom-pip-btn large" onClick={(e) => { e.stopPropagation(); handlePlayPause(); }}>
                  {isPlaying ? <RoundedPause className="h-8 w-8 text-white" /> : <RoundedPlay className="h-8 w-8 text-white" />}
                </button>
              </div>
            </div>
          )}
          {audioSrc && <audio
            ref={audioRef}
            src={audioSrc}
            preload="auto"
            onLoadedMetadata={() => {
              const audio = audioRef.current;
              const video = videoRef.current;
              if (!audio || !video) return;
              console.log('[AUDIO PROXY] Audio loaded, syncing to video at', video.currentTime);
              // Sync time and volume once on load
              audio.currentTime = video.currentTime;
              audio.volume = volume;
              audio.muted = isMuted;
              audio.playbackRate = video.playbackRate;
              // Auto-play if video is playing
              if (!video.paused && !video.ended) {
                audio.play().catch(() => { });
              }
            }}
            onError={(e) => {
              console.error('[AUDIO PROXY] Audio element error:', (e.target as HTMLAudioElement)?.error);
            }}
          ></audio>}

          <div
            className={`online-loading-overlay ${isOnlineLoading ? "active" : ""}`}
            aria-hidden={!isOnlineLoading}
            aria-label={onlineLoadingText}
          >
            <svg className="spinner" viewBox="0 0 50 50">
              <circle className="path" cx="25" cy="25" r="20"></circle>
            </svg>
          </div>

          {!isFullscreen && !isCustomPipActive && (
            <div
              className="absolute top-4 right-4 z-[520] flex gap-2 transition-opacity duration-300"
              style={{
                opacity: showControls || !isPlaying || isSettingsOpen ? 1 : 0,
                pointerEvents: showControls || !isPlaying || isSettingsOpen ? "auto" : "none",
                WebkitAppRegion: "drag",
              } as React.CSSProperties}
            >
              <button
                onClick={handleMinimize}
                className="flex h-9 w-9 items-center justify-center rounded-full bg-[rgba(20,20,20,0.58)] transition-colors hover:bg-white/10"
                style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
                title="Minimize"
              >
                <Minus className="h-4 w-4 text-white/80" />
              </button>
              <button
                onClick={handleMaximize}
                className="flex h-9 w-9 items-center justify-center rounded-full bg-[rgba(20,20,20,0.58)] transition-colors hover:bg-white/10"
                style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
                title="Maximize"
              >
                <Maximize2 className="h-4 w-4 text-white/80" />
              </button>
              <button
                onClick={handleClose}
                className="flex h-9 w-9 items-center justify-center rounded-full bg-[rgba(20,20,20,0.58)] transition-colors hover:bg-white/10"
                style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
                title="Close"
              >
                <X className="h-4 w-4 text-white/80" />
              </button>
            </div>
          )}




          <input type="file" ref={fileInputRef} accept="video/*,.m3u8,.m3u" onChange={handleFileLoad} className="hidden" />
          <input
            type="file"
            ref={subtitleInputRef}
            accept=".srt,.vtt,.ass,.ssa"
            onChange={handleSubtitleLoad}
            className="hidden"
          />

          {!assMode && (
            <div
              className={`subtitle-overlay md:w-3/4 ${finalSubtitleText ? "opacity-100" : "opacity-0"}`}
              style={{
                bottom: showControls || !isPlaying || isSettingsOpen ? "112px" : "62px",
                transform: `translateX(-50%) ${finalSubtitleText ? "translateY(0)" : "translateY(10px)"} translateZ(0)`,
                backdropFilter: "blur(0px)",
                isolation: "isolate",
              }}
            >
              {finalSubtitleText && (
                <p
                  className="cinematic-subtitle"
                  dangerouslySetInnerHTML={{ __html: finalSubtitleText }}
                />
              )}
            </div>
          )}

          <div className={`status-overlay ${statusOverlay.active ? "active" : ""}`}>{renderStatusIcon()}</div>

          <div className={`ripple ${rippleLeft ? "active" : ""}`} id="seek-ripple-left">
            <ChevronLeft className="h-16 w-16" />
          </div>
          <div className={`ripple ${rippleRight ? "active" : ""}`} id="seek-ripple-right">
            <ChevronRight className="h-16 w-16" />
          </div>

          <div
            className="z-1 absolute inset-y-0 left-0 w-1/4"
            onDoubleClick={(e) => {
              e.stopPropagation();
              if (videoRef.current) {
                videoRef.current.currentTime -= 10;
                triggerRipple("left");
              }
            }}
          ></div>
          <div
            className="z-1 absolute inset-y-0 right-0 w-1/4"
            onDoubleClick={(e) => {
              e.stopPropagation();
              if (videoRef.current) {
                videoRef.current.currentTime += 10;
                triggerRipple("right");
              }
            }}
          ></div>

          <div className={`settings-menu bg-[rgba(20,20,20,0.58)] rounded-[12px] border border-white/10 ${isSettingsOpen ? "active" : ""} z-[120]`} ref={settingsMenuRef}>
            <div
              className="settings-view-container"
              style={{ transform: activeSubmenu ? "translateX(-50%)" : "translateX(0%)" }}
            >
              <div className="settings-pane">
                <div className="settings-scroll-area flex-1 py-1" style={{ overflowY: folderFiles.length > 0 ? "auto" : "hidden" }}>
                  <div className="settings-item" onClick={() => setActiveSubmenu("quality")}>
                    <Monitor className="mr-3 h-4 w-4" />
                    <span>Quality</span>
                    <span className="mr-2 ml-auto text-xs opacity-60">{quality}</span>
                    <ChevronRight className="h-4 w-4" />
                  </div>
                  <div className="settings-item" onClick={() => setActiveSubmenu("speed")}>
                    <Gauge className="mr-3 h-4 w-4" />
                    <span>Playback speed</span>
                    <span className="mr-2 ml-auto text-xs opacity-60">{playbackSpeed}x</span>
                    <ChevronRight className="h-4 w-4" />
                  </div>
                  <div className="settings-item" onClick={() => setActiveSubmenu("captions")}>
                    <div
                      className="cc-box"
                      style={{
                        width: "16px",
                        height: "16px",
                        fontSize: "8px",
                        borderWidth: "1.2px",
                        fontWeight: "500",
                        marginRight: "12px",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        padding: 0,
                      }}
                    >
                      <span>CC</span>
                    </div>
                    <span>Captions</span>
                    <span className="mr-2 ml-auto max-w-[80px] truncate text-right text-xs opacity-60">{caption === "Off" ? "Off" : selectedSubtitleLabel}</span>
                    <ChevronRight className="h-4 w-4" />
                  </div>
                  <div className="settings-item" onClick={() => setActiveSubmenu("audio")}>
                    <Music className="mr-3 h-4 w-4" />
                    <span>Audio Track</span>
                    <span className="mr-2 ml-auto max-w-[80px] truncate text-right text-xs opacity-60">{audioTrack}</span>
                    <ChevronRight className="h-4 w-4" />
                  </div>

                  {folderFiles.length > 0 && (
                    <div className="settings-item gap-2" onClick={() => setActiveSubmenu("folder")}>
                      <ListVideo className="mr-1 h-4 w-4 shrink-0" />
                      <span className="shrink-0">Album</span>
                      <span
                        className="ml-auto mr-1 max-w-[120px] truncate text-right text-xs opacity-60"
                        title={`${folderFiles.length} files`}
                      >
                        {folderFiles.length} files
                      </span>
                      <ChevronRight className="h-4 w-4 shrink-0" />
                    </div>
                  )}
                </div>
              </div>

              <div className="settings-pane">
                {activeSubmenu && (
                  <>
                    <div className="submenu-header">
                      <div
                        className="back-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          setActiveSubmenu(null);
                        }}
                      >
                        <ArrowLeft className="h-5 w-5" />
                      </div>
                      <span className="text-sm font-medium">
                        {activeSubmenu === "quality" && "Quality"}
                        {activeSubmenu === "speed" && "Playback speed"}
                        {activeSubmenu === "captions" && "Captions"}
                        {activeSubmenu === "audio" && "Audio Track"}
                        {activeSubmenu === "folder" && "Album files"}
                      </span>
                    </div>
                    <div className="submenu-options settings-scroll-area flex min-h-0 flex-1 flex-col py-1">
                      {activeSubmenu === "speed" &&
                        [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2].map((speed) => (
                          <div
                            key={speed}
                            className={`settings-item ${playbackSpeed === speed ? "selected" : ""}`}
                            style={{ fontWeight: playbackSpeed === speed ? "500" : "400" }}
                            onClick={(e) => {
                              e.stopPropagation();
                              changeSpeed(speed);
                              setTimeout(() => setActiveSubmenu(null), 200);
                            }}
                          >
                            <span>{speed}x</span>
                            <Check className="check-icon h-4 w-4" style={{ strokeWidth: "2px" }} />
                          </div>
                        ))}
                      {activeSubmenu === "quality" &&
                        qualityOptions.map((opt) => (
                          <div
                            key={opt.value}
                            className={`settings-item ${selectedQualityValueRef.current === opt.value ? "selected" : ""}`}
                            style={{ fontWeight: selectedQualityValueRef.current === opt.value ? "500" : "400" }}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleQualityChange(opt.value, opt.label);
                              setTimeout(() => setActiveSubmenu(null), 200);
                            }}
                          >
                            <div className="flex min-w-0 items-center gap-1.5">
                              {opt.format && opt.format !== 'UND' && (
                                <span className="format-badge">
                                  {opt.format}
                                </span>
                              )}
                              <span>{opt.label}</span>
                            </div>
                            <Check className="check-icon h-4 w-4" style={{ strokeWidth: "2px" }} />
                          </div>
                        ))}
                      {activeSubmenu === "captions" && (
                        <>
                          <div
                            className={`settings-item ${caption === "Off" || selectedSubtitleId === "off" ? "selected" : ""}`}
                            style={{ fontWeight: caption === "Off" || selectedSubtitleId === "off" ? "500" : "400" }}
                            onClick={(e) => {
                              e.stopPropagation();
                              setCaption("Off");
                              setSelectedSubtitleLabel("Off");
                              setSelectedSubtitleId("off");
                              setSubtitles([]);
                              setEmbeddedSubtitleText("");
                              disableAssMode();
                              disableEmbeddedTracks();
                              if (isDemuxedLocalFile) {
                                const electron = getElectronApi();
                                if (electron?.ipcRenderer?.invoke) {
                                  void electron.ipcRenderer.invoke("demux:setTracks", {
                                    subtitleIndex: null,
                                  }).then((trackResult: any) => {
                                    if (trackResult && !trackResult.error) {
                                      applyDemuxTrackState(trackResult);
                                    }
                                  }).catch(() => { });
                                }
                              }
                              setTimeout(() => setActiveSubmenu(null), 200);
                            }}
                          >
                            <div className="flex min-w-0 items-center gap-1.5">
                              <div className="format-badge opacity-0" />
                              <span>Off</span>
                            </div>
                            <Check className="check-icon h-4 w-4" style={{ strokeWidth: "2px" }} />
                          </div>

                          {customCaptionName && selectedSubtitleId.startsWith("custom:") && (
                            <div
                              className={`settings-item ${caption !== "Off" && selectedSubtitleId === `custom:${customCaptionName}` ? "selected" : ""}`}
                              style={{ fontWeight: caption !== "Off" && selectedSubtitleId === `custom:${customCaptionName}` ? "500" : "400" }}
                              onClick={(e) => {
                                e.stopPropagation();
                                setCaption("Custom");
                                setSelectedSubtitleLabel(customCaptionName);
                                setSelectedSubtitleId(`custom:${customCaptionName}`);
                                disableEmbeddedTracks();
                                setTimeout(() => setActiveSubmenu(null), 200);
                              }}
                            >
                              <div className="flex min-w-0 items-center gap-1.5">
                                <div className="format-badge opacity-0" />
                                <span className="max-w-[170px] truncate">{customCaptionName}</span>
                              </div>
                              <Check className="check-icon h-4 w-4" style={{ strokeWidth: "2px" }} />
                            </div>
                          )}

                          <div
                            className="settings-item"
                            onClick={(e) => {
                              e.stopPropagation();
                              subtitleInputRef.current?.click();
                            }}
                          >
                            <div className="flex min-w-0 items-center gap-1.5">
                              <div className="format-badge opacity-0" />
                              <span>Captions</span>
                            </div>
                            <Plus
                              className="ml-auto h-4 w-4"
                              style={{ strokeWidth: "2px", marginLeft: "auto" }}
                            />
                          </div>

                          {availableTextTracks.length > 0 && (
                            <div className="my-1 flex items-center gap-3 px-4 opacity-40">
                              <div className="h-px flex-1 bg-white/40"></div>
                              <span className="text-[10px] font-medium tracking-wider text-white/70 uppercase">
                                Embedded
                              </span>
                              <div className="h-px flex-1 bg-white/40"></div>
                            </div>
                          )}

                          {availableTextTracks.map((track) => (
                            <div
                              key={track.id + track.index}
                              className={`settings-item ${caption !== "Off" && (selectedSubtitleId === `embedded:${track.id}:${track.index}` || selectedSubtitleId === `embedded:${track.index}`) ? "selected" : ""}`}
                              style={{ fontWeight: caption !== "Off" && (selectedSubtitleId === `embedded:${track.id}:${track.index}` || selectedSubtitleId === `embedded:${track.index}`) ? "500" : "400" }}
                              onClick={(e) => {
                                e.stopPropagation();
                                handleEmbeddedSubtitleChange(track.index, track.label);
                                setTimeout(() => setActiveSubmenu(null), 200);
                              }}
                            >
                              <div className="flex min-w-0 items-center gap-1.5">
                                {track.badge ? (
                                  <span className="format-badge">{track.badge}</span>
                                ) : (
                                  <div className="format-badge opacity-0" />
                                )}
                                <span className="max-w-[170px] truncate">{track.title || track.label}</span>
                              </div>
                              <Check className="check-icon h-4 w-4" style={{ strokeWidth: "2px" }} />
                            </div>
                          ))}

                          {extractedSubtitles.length > 0 && (
                            <div className="my-1 flex items-center gap-3 px-4 opacity-40">
                              <div className="h-px flex-1 bg-white/40"></div>
                              <span className="text-[10px] font-medium tracking-wider text-white/70 uppercase">
                                Extracted
                              </span>
                              <div className="h-px flex-1 bg-white/40"></div>
                            </div>
                          )}

                          {extractedSubtitles.map((sub) => (
                            <div
                              key={sub.url}
                              className={`settings-item ${caption !== "Off" && selectedSubtitleId === `extracted:${sub.url}` ? "selected" : ""}`}
                              style={{ fontWeight: caption !== "Off" && selectedSubtitleId === `extracted:${sub.url}` ? "500" : "400" }}
                              onClick={async (e) => {
                                e.stopPropagation();
                                try {
                                  await loadExtractedSubtitle(sub);
                                  setTimeout(() => setActiveSubmenu(null), 200);
                                } catch (err) {
                                  console.error("Failed to load extracted subtitle", err);
                                }
                              }}
                            >
                              <div className="flex min-w-0 items-center gap-1.5">
                                <span className="format-badge">{sub.format || "SUB"}</span>
                                <span className="max-w-[170px] truncate">{sub.label || "Unknown"}</span>
                              </div>
                              <Check className="check-icon h-4 w-4" style={{ strokeWidth: "2px" }} />
                            </div>
                          ))}
                        </>
                      )}
                      {activeSubmenu === "audio" &&
                        (availableAudioTracks.length > 0 ? (
                          availableAudioTracks.map((track) => {
                            const displayLabel = (() => {
                              const rawLabel = track.title || track.label || "";
                              if (track.badge) {
                                const prefix = `[${track.badge}]`;
                                if (rawLabel.startsWith(prefix)) {
                                  return rawLabel.slice(prefix.length).trim();
                                }
                              }
                              return rawLabel;
                            })();
                            return (
                              <div
                                key={track.id + track.index}
                                className={`settings-item ${selectedAudioTrackId === String(track.id || track.index) || selectedAudioTrackId === String(track.index) ? "selected" : ""}`}
                                style={{ fontWeight: selectedAudioTrackId === String(track.id || track.index) || selectedAudioTrackId === String(track.index) ? "500" : "400" }}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleAudioTrackChange(track.index, track.label);
                                  setTimeout(() => setActiveSubmenu(null), 200);
                                }}
                              >
                                <div className="flex min-w-0 items-center gap-1.5">
                                  {track.badge ? (
                                    <span className="format-badge">{track.badge}</span>
                                  ) : (
                                    <div className="format-badge opacity-0" />
                                  )}
                                  <span className="max-w-[170px] truncate">{displayLabel}</span>
                                </div>
                                <Check className="check-icon h-4 w-4" style={{ strokeWidth: "2px" }} />
                              </div>
                            );
                          })
                        ) : (
                          <div
                            className={`settings-item ${selectedAudioTrackId === "default" ? "selected" : ""}`}
                            style={{ fontWeight: selectedAudioTrackId === "default" ? "500" : "400" }}
                            onClick={(e) => {
                              e.stopPropagation();
                              setAudioTrack("Default");
                              setSelectedAudioTrackId("default");
                              setTimeout(() => setActiveSubmenu(null), 200);
                            }}
                          >
                            <span>Default</span>
                            <Check className="check-icon h-4 w-4" style={{ strokeWidth: "2px" }} />
                          </div>
                        ))}

                      {activeSubmenu === "folder" && (
                        <>
                          {folderFiles.map((file) => (
                            <div
                              key={file.id}
                              className={`settings-item ${selectedFolder === file.id ? "selected" : ""}`}
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedFolder(file.id);
                                if (file.url) {
                                  playAlbumFile(file.url, file.name);
                                } else if (currentFolderId) {
                                  playFolderFile(currentFolderId, file.name);
                                } else {
                                  void playAlbumFileWithCdn(file.id, file.name);
                                }
                                setTimeout(() => setActiveSubmenu(null), 300);
                              }}
                            >
                              <span className="max-w-[200px] truncate" title={file.name}>
                                {file.name}
                              </span>
                              <Check className="check-icon h-4 w-4" style={{ strokeWidth: "2px" }} />
                            </div>
                          ))}
                        </>
                      )}
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>

          <div
            className="video-controls z-[130]"
            style={{ opacity: showControls || !isPlaying || isSettingsOpen ? 1 : 0 }}
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div
              className="progress-area"
              ref={progressAreaRef}
              onClick={handleProgressClick}
              onMouseMove={handleProgressMouseMove}
              onMouseEnter={() => {
                if (duration > 0) setIsHoveringProgress(true);
              }}
              onMouseLeave={() => setIsHoveringProgress(false)}
            >
              <div className="progress-track" style={{ background: isYoutubeLive ? "white" : undefined }}>
                <div className="progress-bar" style={{
                  left: isYoutubeLive ? 0 : undefined,
                  right: isYoutubeLive ? 0 : undefined,
                  width: isYoutubeLive ? "auto" : `${!isYoutubeLive && duration && Number.isFinite(duration) ? (currentTime / duration) * 100 : 0}%`,
                  borderRadius: "4px"
                }}></div>
              </div>

              <div
                className="pointer-events-none absolute bottom-full z-50 mb-2 flex flex-col items-center transition-all duration-300 ease-out"
                style={{
                  left: `${hoverX}px`,
                  transform: `translateX(-50%) translateY(${isHoveringProgress ? "0px" : "10px"}) scale(${isHoveringProgress ? 1 : 0.95})`,
                  opacity: isHoveringProgress ? 1 : 0,
                }}
              >
                {!isOnlineVideo && (
                  <div
                    className="relative overflow-hidden rounded-lg bg-[#111] shadow-lg shadow-black/60"
                    style={{ width: "140px", aspectRatio: "16/9" }}
                  >
                    {canUseDedicatedPreview ? (
                      <>
                        <video
                          ref={previewVideoRef}
                          src={previewVideoSrc || undefined}
                          className={`h-full w-full object-cover ${previewVideoEnabled ? "opacity-100" : "opacity-0"}`}
                          preload="auto"
                          muted
                          playsInline
                        />

                        {!previewVideoEnabled && (
                          <div className="absolute inset-0 flex items-center justify-center bg-[#111] text-[11px] text-white/45">
                            No preview
                          </div>
                        )}
                      </>
                    ) : (
                      <div className="flex h-full w-full items-center justify-center bg-[#111] text-[11px] text-white/45">
                        No preview
                      </div>
                    )}
                    <div className="pointer-events-none absolute inset-0 rounded-lg border border-white/10"></div>
                  </div>
                )}
                <div
                  className="time-tooltip-text mt-2 flex items-center justify-center px-3.5 py-1 text-white"
                  style={{
                    borderRadius: "16px",
                    background: "rgba(25, 25, 25, 0.45)",
                    border: "1px solid rgba(255, 255, 255, 0.15)",
                  }}
                >
                  {formatTime(hoverTime)}
                </div>
              </div>
            </div>

            <div className="control-bar-content justify-between">
              <div className="flex items-center gap-2">
                <div className="tooltip-container relative">
                  <button onClick={() => closeSettingsPanel(handlePlayPause)} className="flex h-10 w-10 items-center justify-center rounded-full bg-[rgba(20,20,20,0.58)] transition-colors hover:bg-[rgba(60,60,60,0.6)]">
                    {isPlaying ? <RoundedPause className="h-6 w-6" /> : <RoundedPlay className="h-6 w-6" />}
                  </button>
                  <div className="tooltip">{isPlaying ? "Pause" : "Play"}</div>
                </div>

                <div
                  className="volume-container flex h-10 items-center rounded-full bg-[rgba(20,20,20,0.58)] pl-1 pr-3"
                  onClick={(e) => e.stopPropagation()}
                  onMouseDown={(e) => e.stopPropagation()}
                >
                  <div className="tooltip-container relative">
                    <button
                      className="flex h-10 w-10 items-center justify-center rounded-full transition-colors hover:bg-white/10"
                      onClick={(e) => {
                        e.stopPropagation();
                        closeSettingsPanel(toggleMute);
                      }}
                    >
                      <VolumeIcon className="h-6 w-6" />
                    </button>
                    <div className="tooltip">{isMuted ? "Unmute" : "Mute"}</div>
                  </div>
                  <input
                    type="range"
                    className="volume-slider"
                    min="0"
                    max="1"
                    step="0.05"
                    value={isMuted ? 0 : volume}
                    onChange={handleVolumeChange}
                    onClick={(e) => e.stopPropagation()}
                    onMouseDown={(e) => e.stopPropagation()}
                  />
                </div>

                <div className="flex h-10 items-center rounded-full bg-[rgba(20,20,20,0.58)] px-4 text-sm font-normal">
                  {isYoutubeLive ? (
                    <div className="flex items-center overflow-hidden">
                      <span className="format-badge" style={{ color: "rgba(255, 255, 255, 0.7)", width: "auto", minWidth: "auto", padding: "0 4px" }}>Live</span>
                    </div>
                  ) : (
                    <>
                      <span>{formatTime(currentTime)}</span>&nbsp;/&nbsp;<span>{formatTime(duration)}</span>
                    </>
                  )}
                </div>

                <div
                  className="media-title-bar flex h-10 items-center rounded-full bg-[rgba(20,20,20,0.58)] pl-3 pr-4 text-sm font-normal"
                  style={{
                    width: (isOnlineLoading && onlineLoadingText) || titleOverflows ? '260px' : 'fit-content',
                    maxWidth: '260px',
                    overflow: 'hidden',
                    transition: 'width 0.4s cubic-bezier(0.4, 0, 0.2, 1)',
                  }}
                >
                  <ShimmerTitle
                    text={(isOnlineLoading && onlineLoadingText) ? onlineLoadingText : videoTitle}
                    isShimmering={isOnlineLoading}
                    isLive={isYoutubeLive}
                    onOverflowChange={setTitleOverflows}
                    onInfoClick={() => { setIsMediaDetailsOpen(true); probeCurrentMedia(); }}
                  />
                </div>
              </div>

              <div className="flex h-10 items-center gap-1 rounded-full bg-[rgba(20,20,20,0.58)] px-2">
                {/* File Loader & Subtitle Group */}
                <div className="flex items-center">
                  <div className="tooltip-container relative">
                    <button onClick={() => closeSettingsPanel(() => {
                      setLoaderTab("local");
                      setLoaderOnlyPlaylist(false);
                      setIsLoaderOpen(true);
                    })} className="flex h-10 w-10 items-center justify-center rounded-full transition-colors hover:bg-white/10">
                      <FilePlus2 className="h-6 w-6" />
                    </button>
                    <div className="tooltip">Open file</div>
                  </div>

                  <div
                    className={`overflow-visible transition-all duration-500 ease-[cubic-bezier(0.23,1,0.32,1)] flex items-center ${(extractedSubtitles.length > 0 || availableTextTracks.length > 0 || !!customCaptionName || subtitles.length > 0 || assMode || !!embeddedSubtitleText || selectedSubtitleId !== "off")
                      ? "w-[38px] ml-2 opacity-100 scale-100"
                      : "w-0 ml-0 opacity-0 scale-50 pointer-events-none"
                      }`}
                  >
                    <div className="tooltip-container relative flex-shrink-0">
                      <button onClick={toggleCaptions} className="flex h-10 w-10 items-center justify-center rounded-full transition-colors hover:bg-white/10">
                        {selectedSubtitleId === "off" ? (
                          <CaptionsIcon className="h-6 w-6 translate-y-[2px]" />
                        ) : (
                          <CaptionsEnabledIcon className="h-6 w-6 translate-y-[2px]" />
                        )}
                      </button>
                      <div className="tooltip">{selectedSubtitleId === "off" ? "Enable Subtitles" : "Disable Subtitles"}</div>
                    </div>
                  </div>
                </div>

                <div className="tooltip-container relative">
                  <button onClick={() => closeSettingsPanel(() => {
                    setIsTvOpen(true);
                    if (tvStreams.length === 0 && !tvLoading) {
                      fetchPpvStreams();
                    }
                  })} className="flex h-10 w-10 items-center justify-center rounded-full transition-colors hover:bg-white/10">
                    <Tv className="h-6 w-6" />
                  </button>
                  <div className="tooltip">Live Streams</div>
                </div>

                <div className="tooltip-container relative">
                  <button onClick={() => closeSettingsPanel(() => {
                    setLoaderTab("playlist");
                    setLoaderOnlyPlaylist(true);
                    setIsLoaderOpen(true);
                  })} className="flex h-10 w-10 items-center justify-center rounded-full transition-colors hover:bg-white/10">
                    <ListVideo className="h-6 w-6" />
                  </button>
                  <div className="tooltip">Playlists</div>
                </div>

                <div className="tooltip-container relative">
                  <button onClick={() => closeSettingsPanel(() => {
                    setIsDownloadOpen(true);
                    if (!dlSavePath) {
                      const electron = getElectronApi();
                      if (electron?.ipcRenderer?.invoke) {
                        electron.ipcRenderer.invoke("get-downloads-path").then((p: string) => {
                          if (p) setDlSavePath(p);
                        }).catch(() => { });
                      }
                    }
                  })} className="flex h-10 w-10 items-center justify-center rounded-full transition-colors hover:bg-white/10">
                    <Download className="h-6 w-6" />
                  </button>
                  <div className="tooltip">Download</div>
                </div>

                <div className="tooltip-container relative">
                  <button onClick={() => closeSettingsPanel(() => { void togglePip(); })} className="flex h-10 w-10 items-center justify-center rounded-full transition-colors hover:bg-white/10">
                    <CustomPictureInPicture className="h-6 w-6" />
                  </button>
                  <div className="tooltip">Miniplayer</div>
                </div>

                <div className="tooltip-container relative">
                  <button
                    id="settings-btn"
                    ref={settingsBtnRef}
                    className="flex h-10 w-10 items-center justify-center rounded-full transition-colors hover:bg-white/10"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (settingsCloseTimeoutRef.current) {
                        clearTimeout(settingsCloseTimeoutRef.current);
                        settingsCloseTimeoutRef.current = null;
                      }
                      setIsSettingsOpen((prev) => {
                        if (prev) {
                          setActiveSubmenu(null);
                        }
                        return !prev;
                      });
                    }}
                  >
                    <Settings className="h-6 w-6" />
                  </button>
                  <div className="tooltip">Settings</div>
                </div>

                <div className="tooltip-container relative">
                  <button onClick={() => closeSettingsPanel(() => { void toggleFullscreen(); })} className="flex h-10 w-10 items-center justify-center rounded-full transition-colors hover:bg-white/10">
                    <RectangleHorizontal className="h-6 w-6" />
                  </button>
                  <div className="tooltip">Fullscreen</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}