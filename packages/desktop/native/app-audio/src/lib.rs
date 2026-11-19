//! Per-process audio capture for the AnyTalk desktop app.
//!
//! On Windows it records what a single process (and its child processes) plays,
//! using WASAPI process loopback. On other platforms the module still loads, so
//! the JS side can ask `isSupported()`, which is then always false.

#![deny(clippy::all)]

use napi::bindgen_prelude::Float32Array;
use napi::threadsafe_function::ThreadsafeFunction;
use napi::{Error, Result, Status};
use napi_derive::napi;

#[cfg(windows)]
mod capture;

/// Oldest Windows build with process loopback (Windows 10 2004 server core / Windows 11).
#[cfg(windows)]
const MIN_BUILD: u32 = 20348;

/// Callback that receives interleaved 48 kHz stereo float32 chunks.
type DataCallback = ThreadsafeFunction<Float32Array, (), Float32Array, Status, false>;

/// Callback that receives an error message when the capture ends on its own.
type ErrorCallback = ThreadsafeFunction<String, (), String, Status, false>;

/// Whether per-process capture works here (Windows build 20348 or newer).
#[napi]
pub fn is_supported() -> bool {
    #[cfg(windows)]
    {
        capture::windows_build().is_some_and(|build| build >= MIN_BUILD)
    }
    #[cfg(not(windows))]
    {
        false
    }
}

/// The id of the process that owns a window.
///
/// `hwnd` is the window handle (a number or a bigint). Throws when the handle is
/// not a window, or off Windows.
#[napi]
pub fn process_id_for_window(
    hwnd: napi::bindgen_prelude::Either<i64, napi::bindgen_prelude::BigInt>,
) -> Result<u32> {
    #[cfg(windows)]
    {
        let value = match hwnd {
            napi::bindgen_prelude::Either::A(n) => n,
            napi::bindgen_prelude::Either::B(b) => b.get_i64().0,
        };
        capture::process_id_for_window(value).map_err(|m| Error::new(Status::GenericFailure, m))
    }
    #[cfg(not(windows))]
    {
        let _ = hwnd;
        Err(Error::new(
            Status::GenericFailure,
            "process_id_for_window is only available on Windows",
        ))
    }
}

/// The file name of a process's program (for example `chrome.exe`).
///
/// Returns undefined when the process can't be opened or has exited, and
/// always undefined off Windows.
#[napi]
pub fn process_image_name(pid: u32) -> Option<String> {
    #[cfg(windows)]
    {
        capture::process_image_name(pid)
    }
    #[cfg(not(windows))]
    {
        let _ = pid;
        None
    }
}

/// A running capture, returned by `startCapture`.
#[napi]
pub struct AppAudioCapture {
    #[cfg(windows)]
    inner: capture::Capture,
}

#[napi]
impl AppAudioCapture {
    /// Stops the capture and waits for its thread to end. Safe to call twice.
    #[napi]
    pub fn stop(&mut self) {
        #[cfg(windows)]
        self.inner.stop();
    }
}

/// Starts capturing the sound of process `pid` and its children.
///
/// Chunks of about 10 ms (480 frames) arrive in `on_data` as 48 kHz stereo
/// interleaved float32. `on_error` is called once if the capture ends on its
/// own, for example because the process exited. Throws if it can't start.
#[napi]
pub fn start_capture(
    pid: u32,
    on_data: DataCallback,
    on_error: Option<ErrorCallback>,
) -> Result<AppAudioCapture> {
    #[cfg(windows)]
    {
        let inner = capture::Capture::start(pid, on_data, on_error)
            .map_err(|m| Error::new(Status::GenericFailure, m))?;
        Ok(AppAudioCapture { inner })
    }
    #[cfg(not(windows))]
    {
        let _ = (pid, on_data, on_error);
        Err(Error::new(
            Status::GenericFailure,
            "per-process capture is only available on Windows",
        ))
    }
}
