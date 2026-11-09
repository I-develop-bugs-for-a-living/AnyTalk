import {
  Match,
  Switch,
  createEffect,
  createSignal,
  onCleanup,
  onMount,
  untrack,
} from "solid-js";

import { Trans, useLingui } from "@lingui/solid/macro";
import { styled } from "styled-system/jsx";

import { decodeQrFromImage } from "@revolt/client/qrDecode";
import { checkQrLogin } from "@revolt/client/qrLoginCode";
import { CircularProgress, Dialog, DialogProps, Text } from "@revolt/ui";

import { useModals } from "..";
import { Modals } from "../types";

/** How the camera ended up unusable */
type ScanError = "insecure" | "no-camera" | "denied" | "other";

/** How long a live stream may take to deliver its first frame */
const FIRST_FRAME_TIMEOUT = 5000;

/**
 * Square viewport that clips the camera preview
 */
const Viewport = styled("div", {
  base: {
    position: "relative",
    // explicit width: the dialog shrinks to its content, so a percentage
    // here would collapse the preview to nothing
    width: "min(80vw, 360px)",
    height: "min(80vw, 360px)",
    margin: "0 auto",
    overflow: "hidden",
    borderRadius: "var(--borderRadius-lg)",
    background: "black",
  },
});

/**
 * Modal with a live camera preview that looks for a login QR code. When it
 * finds one, it hands over to the approve step.
 */
export function QrScannerModal(
  props: DialogProps & Modals & { type: "qr_scanner" },
) {
  const { t } = useLingui();
  const { openModal } = useModals();

  const [error, setError] = createSignal<ScanError>();
  const [ready, setReady] = createSignal(false);
  const [wrongCode, setWrongCode] = createSignal<
    "invalid" | "foreign" | "local"
  >();
  let wrongTimer: ReturnType<typeof setTimeout> | undefined;

  // The video element and the stream arrive independently (the dialog renders
  // its content after this component mounted), so both are signals and an
  // effect joins them once both exist
  const [video, setVideo] = createSignal<HTMLVideoElement>();
  const [previewCanvas, setPreviewCanvas] = createSignal<HTMLCanvasElement>();
  const [stream, setStream] = createSignal<MediaStream>();
  const [noFrames, setNoFrames] = createSignal(false);
  let frameTimer: ReturnType<typeof setTimeout> | undefined;
  let frame = 0;
  let stopped = false;

  /** Stop the camera and the scan loop */
  function stop() {
    stopped = true;
    cancelAnimationFrame(frame);
    clearTimeout(wrongTimer);
    clearTimeout(frameTimer);
    stream()
      ?.getTracks()
      .forEach((track) => track.stop());
    const element = video();
    if (element) element.srcObject = null;
  }

  onMount(async () => {
    // getUserMedia only exists on HTTPS and localhost
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setError("insecure");
      return;
    }

    try {
      const media = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });

      // The modal may have been closed while the permission prompt was open
      if (stopped) {
        media.getTracks().forEach((track) => track.stop());
        return;
      }

      setStream(media);
    } catch (err) {
      // closing the modal can abort the pending camera request
      if (stopped) return;
      const name = err instanceof DOMException ? err.name : "";
      if (name === "NotAllowedError" || name === "SecurityError") {
        setError("denied");
      } else if (name === "NotFoundError" || name === "OverconstrainedError") {
        setError("no-camera");
      } else {
        setError("other");
      }
    }
  });

  // Attach the stream as soon as both the stream and the element exist
  createEffect(() => {
    const element = video();
    const media = stream();
    if (!element || !media || stopped) return;

    // Set as properties, not only attributes: Safari ignores a late attribute
    // and refuses to autoplay a video that is not muted and inline
    element.muted = true;
    element.autoplay = true;
    element.playsInline = true;
    element.setAttribute("playsinline", "");
    element.setAttribute("muted", "");
    element.srcObject = media;

    // play() after srcObject; may be rejected until the user taps on iPhone
    element.play().catch(() => {
      if (!stopped && !ready()) setNoFrames(true);
    });

    // Tell the user when the camera is on but no picture advances
    frameTimer = setTimeout(() => {
      if (!stopped && !ready()) setNoFrames(true);
    }, FIRST_FRAME_TIMEOUT);

    // Draw and decode from now on
    frame = requestAnimationFrame(scan);
  });

  onCleanup(stop);

  /** Off-screen canvas that frames are decoded from */
  const canvas = document.createElement("canvas");

  /** Last playback position seen, to tell that frames really advance */
  let lastTime = -1;

  /** When the last decode ran */
  let lastDecode = 0;

  /**
   * Draw the current frame onto the visible canvas, cropped like
   * `object-fit: cover` and sharp on high density screens
   * @param element Source video
   * @param target Visible canvas
   */
  function drawPreview(element: HTMLVideoElement, target: HTMLCanvasElement) {
    const ratio = window.devicePixelRatio || 1;
    const width = Math.round(target.clientWidth * ratio);
    const height = Math.round(target.clientHeight * ratio);
    if (!width || !height) return;
    if (target.width !== width) target.width = width;
    if (target.height !== height) target.height = height;

    // Crop the video to the target's aspect ratio, centred
    const scale = Math.max(
      width / element.videoWidth,
      height / element.videoHeight,
    );
    const sw = width / scale;
    const sh = height / scale;
    target
      .getContext("2d")
      ?.drawImage(
        element,
        (element.videoWidth - sw) / 2,
        (element.videoHeight - sh) / 2,
        sw,
        sh,
        0,
        0,
        width,
        height,
      );
  }

  /** Show one frame, decode now and then, then schedule the next */
  function scan() {
    const element = untrack(video);
    const preview = untrack(previewCanvas);
    if (stopped || !element) return;

    if (element.readyState >= element.HAVE_CURRENT_DATA && element.videoWidth) {
      if (preview) drawPreview(element, preview);

      // Frames count as arriving once the picture has advanced
      if (!ready() && lastTime >= 0 && element.currentTime !== lastTime) {
        clearTimeout(frameTimer);
        setNoFrames(false);
        setReady(true);
      }
      lastTime = element.currentTime;

      // Decoding is the expensive part: about 8 times a second is plenty
      const now = performance.now();
      if (now - lastDecode >= 120) {
        lastDecode = now;

        // Scale down large frames: decoding cost grows with the pixel count
        const scale = Math.min(1, 1280 / element.videoWidth);
        canvas.width = Math.round(element.videoWidth * scale);
        canvas.height = Math.round(element.videoHeight * scale);

        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (context) {
          context.drawImage(element, 0, 0, canvas.width, canvas.height);
          const image = context.getImageData(0, 0, canvas.width, canvas.height);
          const text = decodeQrFromImage(image.data, image.width, image.height);

          if (text) {
            const result = checkQrLogin(text, location.origin);
            if (result.kind === "ok") {
              stop();
              props.onClose();
              openModal({ type: "qr_login_approve", id: result.id });
              return;
            }
            // Show the hint for a few seconds after the code left the view
            setWrongCode(result.kind);
            clearTimeout(wrongTimer);
            wrongTimer = setTimeout(() => setWrongCode(undefined), 3000);
          }
        }
      }
    }

    frame = requestAnimationFrame(scan);
  }

  return (
    <Dialog
      show={props.show}
      onClose={props.onClose}
      title={<Trans>Scan QR code</Trans>}
      actions={[{ text: <Trans>Cancel</Trans> }]}
    >
      <Switch>
        <Match when={error()}>
          <div role="alert">
            <Text>
              <Switch>
                <Match when={error() === "insecure"}>
                  <Trans>
                    Scanning needs a secure connection (HTTPS). This page is
                    opened over plain HTTP, so the browser blocks the camera.
                  </Trans>
                </Match>
                <Match when={error() === "denied"}>
                  <Trans>
                    Camera access was denied. Allow the camera for this site in
                    your browser settings and try again.
                  </Trans>
                </Match>
                <Match when={error() === "no-camera"}>
                  <Trans>No camera was found on this device.</Trans>
                </Match>
                <Match when={true}>
                  <Trans>The camera could not be started.</Trans>
                </Match>
              </Switch>
            </Text>
          </div>
        </Match>
        <Match when={true}>
          <Viewport>
            {/* what the user sees: iOS Safari can show a playing <video> in a
                transformed dialog as black, a canvas always paints */}
            <canvas
              ref={setPreviewCanvas}
              role="img"
              aria-label={t`Camera preview`}
              style={{
                display: "block",
                width: "100%",
                height: "100%",
              }}
            />
            {/* the real video stays rendered (iOS pauses hidden ones) but
                invisible */}
            <video
              ref={setVideo}
              playsinline
              muted
              autoplay
              aria-hidden="true"
              style={{
                position: "absolute",
                width: "1px",
                height: "1px",
                opacity: 0,
                "pointer-events": "none",
              }}
            />
            <Switch>
              <Match when={!ready()}>
                <div
                  style={{
                    position: "absolute",
                    inset: 0,
                    display: "grid",
                    "place-items": "center",
                  }}
                >
                  <CircularProgress />
                </div>
              </Match>
            </Switch>
          </Viewport>
          <div
            role={wrongCode() ? "alert" : "status"}
            aria-live={wrongCode() ? "assertive" : "polite"}
            style={
              wrongCode()
                ? {
                    padding: "12px",
                    "margin-top": "12px",
                    "border-radius": "var(--borderRadius-md)",
                    background: "var(--md-sys-color-error-container)",
                    color: "var(--md-sys-color-on-error-container)",
                  }
                : undefined
            }
          >
            <Text>
              <Switch>
                <Match when={wrongCode() === "foreign"}>
                  <Trans>
                    This code is from a different AnyTalk server. Open the login
                    page of this server on the new device instead.
                  </Trans>
                </Match>
                <Match when={wrongCode() === "local"}>
                  <Trans>
                    This code was made on an address that only works on the
                    other device (localhost). Open the login page there with the
                    same address you use on this device.
                  </Trans>
                </Match>
                <Match when={wrongCode()}>
                  <Trans>
                    That QR code is not an AnyTalk login code. Point the camera
                    at the code on the login screen of the new device.
                  </Trans>
                </Match>
                <Match when={noFrames()}>
                  <Trans>
                    The camera is on but no picture arrives. Close this window
                    and try again, or check that no other app is using the
                    camera.
                  </Trans>
                </Match>
                <Match when={ready()}>
                  <Trans>
                    Point the camera at the QR code on the login screen of the
                    new device.
                  </Trans>
                </Match>
              </Switch>
            </Text>
          </div>
        </Match>
      </Switch>
    </Dialog>
  );
}
