//! WASAPI process loopback capture (Windows only).

use std::panic::{catch_unwind, AssertUnwindSafe};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::sync::Arc;
use std::thread::JoinHandle;
use std::time::Duration;

use napi::bindgen_prelude::Float32Array;
use napi::threadsafe_function::{ThreadsafeFunction, ThreadsafeFunctionCallMode};
use napi::Status;
use wasapi::{AudioClient, Direction, SampleType, StreamMode, WasapiError, WaveFormat};
use windows::core::PWSTR;
use windows::Wdk::System::SystemServices::RtlGetVersion;
use windows::Win32::Foundation::{CloseHandle, HWND, WAIT_OBJECT_0};
use windows::Win32::System::SystemInformation::OSVERSIONINFOW;
use windows::Win32::System::Threading::{
    OpenProcess, QueryFullProcessImageNameW, WaitForSingleObject, PROCESS_NAME_WIN32,
    PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_SYNCHRONIZE,
};
use windows::Win32::UI::WindowsAndMessaging::{GetWindowThreadProcessId, IsWindow};

/// Output sample rate.
const SAMPLE_RATE: usize = 48_000;
/// Output channel count.
const CHANNELS: usize = 2;
/// Floats per delivered chunk: 10 ms of stereo.
const CHUNK_FLOATS: usize = SAMPLE_RATE / 100 * CHANNELS;
/// Longest wait for the stream to start before `start` gives up.
const START_TIMEOUT: Duration = Duration::from_secs(3);
/// How long one wait for new audio lasts, which also bounds how fast `stop` reacts.
const WAIT_MS: u32 = 50;

/// Callback that receives the captured chunks on the JS thread.
type DataCallback = ThreadsafeFunction<Float32Array, (), Float32Array, Status, false>;
/// Callback that receives the message of a capture that ended by itself.
type ErrorCallback = ThreadsafeFunction<String, (), String, Status, false>;

/// The Windows build number, or None if it can't be read.
pub fn windows_build() -> Option<u32> {
    let mut info = OSVERSIONINFOW {
        dwOSVersionInfoSize: std::mem::size_of::<OSVERSIONINFOW>() as u32,
        ..Default::default()
    };
    // SAFETY: `info` is a valid, correctly sized OSVERSIONINFOW.
    let status = unsafe { RtlGetVersion(&mut info) };
    status.is_ok().then_some(info.dwBuildNumber)
}

/// The process id owning the window with handle `hwnd`.
pub fn process_id_for_window(hwnd: i64) -> Result<u32, String> {
    let handle = HWND(hwnd as isize as *mut _);
    // SAFETY: both calls accept any handle value and just report failure.
    unsafe {
        if !IsWindow(Some(handle)).as_bool() {
            return Err(format!("{hwnd} is not a window"));
        }
        let mut pid = 0u32;
        let thread = GetWindowThreadProcessId(handle, Some(&mut pid));
        if thread == 0 || pid == 0 {
            return Err(format!("no process found for window {hwnd}"));
        }
        Ok(pid)
    }
}

/// The file name of the program a process runs, None if it can't be read.
pub fn process_image_name(pid: u32) -> Option<String> {
    // SAFETY: plain Win32 calls, the handle is closed before returning and
    // the buffer outlives the call.
    unsafe {
        let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
        let mut buffer = [0u16; 1024];
        let mut len = buffer.len() as u32;
        let result = QueryFullProcessImageNameW(
            handle,
            PROCESS_NAME_WIN32,
            PWSTR(buffer.as_mut_ptr()),
            &mut len,
        );
        let _ = CloseHandle(handle);
        result.ok()?;
        let path = String::from_utf16_lossy(&buffer[..len as usize]);
        path.rsplit(['\\', '/']).next().map(str::to_string)
    }
}

/// A running capture thread.
pub struct Capture {
    stop: Arc<AtomicBool>,
    thread: Option<JoinHandle<()>>,
}

impl Capture {
    /// Starts the thread and waits until the stream runs or failed to start.
    pub fn start(
        pid: u32,
        on_data: DataCallback,
        on_error: Option<ErrorCallback>,
    ) -> Result<Self, String> {
        let stop = Arc::new(AtomicBool::new(false));
        let (ready_tx, ready_rx) = mpsc::channel::<Result<(), String>>();
        let thread_stop = stop.clone();
        let thread = std::thread::Builder::new()
            .name("anytalk-app-audio".into())
            .spawn(move || {
                let mut was_ready = false;
                // a panic must not unwind into the runtime, report it instead
                let result = catch_unwind(AssertUnwindSafe(|| {
                    run(pid, &thread_stop, &on_data, &ready_tx, &mut was_ready)
                }))
                .unwrap_or_else(|_| Err("the capture thread panicked".to_string()));
                if let Err(message) = result {
                    if was_ready {
                        // the capture ended by itself after it had started
                        if let Some(cb) = &on_error {
                            cb.call(message, ThreadsafeFunctionCallMode::NonBlocking);
                        }
                    } else {
                        // a start failure goes back to `start` as a throw only
                        let _ = ready_tx.send(Err(message));
                    }
                }
            })
            .map_err(|e| format!("could not start the capture thread: {e}"))?;
        match ready_rx.recv_timeout(START_TIMEOUT) {
            Ok(Ok(())) => Ok(Self {
                stop,
                thread: Some(thread),
            }),
            Ok(Err(message)) => {
                let _ = thread.join();
                Err(message)
            }
            Err(RecvTimeoutError::Timeout) => {
                // A hung activation must not freeze the caller: let the thread
                // end by itself whenever it gets unstuck, and don't join it.
                stop.store(true, Ordering::SeqCst);
                Err("starting the audio capture timed out".into())
            }
            Err(RecvTimeoutError::Disconnected) => {
                let _ = thread.join();
                Err("the capture thread ended before it started".into())
            }
        }
    }

    /// Asks the thread to end and waits for it.
    pub fn stop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

impl Drop for Capture {
    /// Makes sure the thread never outlives its handle.
    fn drop(&mut self) {
        self.stop();
    }
}

/// Whether the process is still running. Unknown counts as running.
struct ProcessWatch(Option<windows::Win32::Foundation::HANDLE>);

impl ProcessWatch {
    /// Opens a handle that can be waited on.
    fn new(pid: u32) -> Self {
        // SAFETY: plain Win32 call, the handle is closed in `drop`.
        Self(unsafe { OpenProcess(PROCESS_SYNCHRONIZE, false, pid) }.ok())
    }

    /// True once the process has exited.
    fn exited(&self) -> bool {
        match self.0 {
            Some(h) => {
                // SAFETY: the handle is valid until `drop`.
                let status = unsafe { WaitForSingleObject(h, 0) };
                status == WAIT_OBJECT_0
            }
            None => false,
        }
    }
}

impl Drop for ProcessWatch {
    /// Closes the handle.
    fn drop(&mut self) {
        if let Some(h) = self.0 {
            // SAFETY: the handle came from OpenProcess and is closed once.
            unsafe {
                let _ = CloseHandle(h);
            }
        }
    }
}

/// Turns a WASAPI error into a message.
fn msg(context: &str, e: WasapiError) -> String {
    format!("{context}: {e}")
}

/// The capture loop. Reports readiness once the stream started; an Err after
/// that is a runtime failure (e.g. the process exited).
fn run(
    pid: u32,
    stop: &AtomicBool,
    on_data: &DataCallback,
    ready: &mpsc::Sender<Result<(), String>>,
    was_ready: &mut bool,
) -> Result<(), String> {
    // The thread owns its COM apartment for the whole capture.
    wasapi::initialize_mta()
        .ok()
        .map_err(|e| format!("COM init failed: {e}"))?;
    let outcome = capture_loop(pid, stop, on_data, ready, was_ready);
    wasapi::deinitialize();
    outcome
}

/// Sets up the client and pumps audio until stopped or failed.
fn capture_loop(
    pid: u32,
    stop: &AtomicBool,
    on_data: &DataCallback,
    ready: &mpsc::Sender<Result<(), String>>,
    was_ready: &mut bool,
) -> Result<(), String> {
    let mut client = AudioClient::new_application_loopback_client(pid, true)
        .map_err(|e| msg("could not attach to the process", e))?;
    // autoconvert lets Windows resample and remix to exactly this format
    let format = WaveFormat::new(32, 32, SampleType::Float, SAMPLE_RATE, CHANNELS, None);
    client
        .initialize_client(
            &format,
            Direction::Capture,
            StreamMode::EventsShared {
                autoconvert: true,
                buffer_duration_hns: 200_000,
            },
            None,
        )
        .map_err(|e| msg("could not start the audio stream", e))?;
    let event = client
        .set_get_eventhandle()
        .map_err(|e| msg("could not get the audio event", e))?;
    let capture = client
        .get_audiocaptureclient()
        .map_err(|e| msg("could not get the capture client", e))?;
    client
        .start_stream()
        .map_err(|e| msg("could not start the stream", e))?;
    let watch = ProcessWatch::new(pid);
    let _ = ready.send(Ok(()));
    *was_ready = true;

    let bytes_per_frame = CHANNELS * 4;
    let mut pending: Vec<f32> = Vec::with_capacity(CHUNK_FLOATS * 4);
    let mut packet: Vec<u8> = Vec::new();
    let mut result = Ok(());

    'outer: while !stop.load(Ordering::SeqCst) {
        if watch.exited() {
            result = Err("the captured process exited".to_string());
            break;
        }
        match event.wait_for_event(WAIT_MS) {
            Ok(()) | Err(WasapiError::EventTimeout) => {}
            Err(e) => {
                result = Err(msg("waiting for audio failed", e));
                break;
            }
        }
        // Drain every packet that is ready
        loop {
            let frames = match capture.get_next_packet_size() {
                Ok(Some(n)) => n as usize,
                Ok(None) => 0,
                Err(e) => {
                    result = Err(msg("reading audio failed", e));
                    break 'outer;
                }
            };
            if frames == 0 {
                break;
            }
            packet.resize(frames * bytes_per_frame, 0);
            if let Err(e) = capture.read_from_device(&mut packet) {
                result = Err(msg("reading audio failed", e));
                break 'outer;
            }
            pending.extend(
                packet
                    .chunks_exact(4)
                    .map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]])),
            );
            while pending.len() >= CHUNK_FLOATS {
                let chunk: Vec<f32> = pending.drain(..CHUNK_FLOATS).collect();
                on_data.call(
                    Float32Array::new(chunk),
                    ThreadsafeFunctionCallMode::NonBlocking,
                );
            }
        }
    }
    let _ = client.stop_stream();
    result
}
