// Webcam access. One stream for the whole session, so switching cams is instant.
import { startTestSource } from "./testSource";

const testMode = new URLSearchParams(location.search).get("source") === "test";

let video: HTMLVideoElement | null = null;
let starting: Promise<HTMLVideoElement> | null = null;

export const cameraVideo = (): HTMLVideoElement | null => video;

export class CameraError extends Error {}

function explain(err: unknown): string {
  if (!window.isSecureContext) return "The camera only works over https or on localhost.";
  const name = (err as { name?: string })?.name;
  switch (name) {
    case "NotAllowedError":
    case "SecurityError":
      return "Camera access was blocked. Allow the camera for this site in your browser settings, then try again.";
    case "NotFoundError":
    case "OverconstrainedError":
      return "No camera found. Plug one in and try again.";
    case "NotReadableError":
      return "Your camera is busy in another app (Zoom, FaceTime…). Close it and try again.";
    default:
      return `Couldn't start the camera: ${(err as Error)?.message ?? err}`;
  }
}

/** True when the browser already allows the camera, so we can start without a click. */
export async function cameraAllowed(): Promise<boolean> {
  if (testMode) return true;
  try {
    const status = await navigator.permissions.query({ name: "camera" as PermissionName });
    return status.state === "granted";
  } catch {
    return false;
  }
}

export function startCamera(): Promise<HTMLVideoElement> {
  if (video) return Promise.resolve(video);
  starting ??= (async () => {
    let stream: MediaStream;
    if (testMode) stream = startTestSource();
    else {
      if (!navigator.mediaDevices?.getUserMedia) throw new CameraError("This browser can't use cameras.");
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
          audio: false,
        });
      } catch (err) {
        throw new CameraError(explain(err));
      }
    }
    const v = document.createElement("video");
    v.playsInline = true;
    v.muted = true;
    v.autoplay = true;
    v.className = "cam-source";
    v.setAttribute("aria-hidden", "true");
    // iOS Safari stops decoding a camera <video> that isn't in the page
    document.body.append(v);
    v.srcObject = stream;
    await v.play();
    if (!v.videoWidth) await new Promise((r) => v.addEventListener("loadedmetadata", r, { once: true }));
    video = v;
    return v;
  })().finally(() => (starting = null));
  return starting;
}
