//! Download speed test through PewPew's own core, so the result is the speed
//! of the route the user is connected to.

use super::{CmdResult, StringifyErr as _};
use crate::config::Config;
use serde::Serialize;
use std::sync::{
    Arc,
    atomic::{AtomicBool, AtomicU64, Ordering},
};
use std::time::{Duration, Instant};
use tauri::ipc::Channel;

/// Cloudflare's speed test file; its servers sit close to most route exits.
const TEST_URL: &str = "https://speed.cloudflare.com/__down?bytes=25000000";

#[derive(Debug, Clone, Copy)]
struct Limits {
    /// Parallel downloads, so one slow connection does not hide the route's speed.
    streams: usize,
    duration: Duration,
    /// Stops early on fast routes so a test never uses much of the user's plan.
    max_bytes: u64,
    /// Connections start slowly; samples from this period are not counted.
    warm_up: Duration,
    sample_every: Duration,
}

const LIMITS: Limits = Limits {
    streams: 4,
    duration: Duration::from_secs(8),
    max_bytes: 300 * 1024 * 1024,
    warm_up: Duration::from_secs(1),
    sample_every: Duration::from_millis(200),
};

static RUNNING: AtomicBool = AtomicBool::new(false);
static CANCELLED: AtomicBool = AtomicBool::new(false);

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeedProgress {
    pub elapsed_ms: u64,
    pub bytes: u64,
    /// Speed over the last sample interval.
    pub mbps: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeedResult {
    /// 90th percentile of the samples after warm-up, as Cloudflare's own test reports.
    pub mbps: f64,
    pub average_mbps: f64,
    pub bytes: u64,
    pub elapsed_ms: u64,
}

/// Runs one download test and streams progress while it runs.
#[tauri::command]
pub async fn run_speed_test(on_progress: Channel<SpeedProgress>) -> CmdResult<SpeedResult> {
    if RUNNING.swap(true, Ordering::AcqRel) {
        return Err("pewpew-speed-test-running".into());
    }
    CANCELLED.store(false, Ordering::Release);
    let result = measure(&on_progress).await;
    RUNNING.store(false, Ordering::Release);
    result
}

/// Stops a running test, for example when its window is closed.
#[tauri::command]
pub fn cancel_speed_test() {
    CANCELLED.store(true, Ordering::Release);
}

async fn proxy_port() -> u16 {
    let verge_port = Config::verge().await.latest_arc().verge_mixed_port;
    match verge_port {
        Some(port) => port,
        None => Config::clash().await.latest_arc().get_mixed_port(),
    }
}

async fn measure(progress: &Channel<SpeedProgress>) -> CmdResult<SpeedResult> {
    let proxy = reqwest::Proxy::all(format!("http://127.0.0.1:{}", proxy_port().await)).stringify_err()?;
    // HTTP/1.1 gives every download its own connection through the route.
    let client = reqwest::Client::builder()
        .proxy(proxy)
        .http1_only()
        .user_agent(concat!("PewPewCloud/", env!("CARGO_PKG_VERSION")))
        .connect_timeout(Duration::from_secs(6))
        .build()
        .stringify_err()?;
    run(client, TEST_URL, LIMITS, |sample| {
        let _ = progress.send(sample);
    })
    .await
}

async fn run(
    client: reqwest::Client,
    url: &str,
    limits: Limits,
    mut on_sample: impl FnMut(SpeedProgress),
) -> CmdResult<SpeedResult> {
    let received = Arc::new(AtomicU64::new(0));
    let stop = Arc::new(AtomicBool::new(false));
    let start = Instant::now();
    let deadline = start + limits.duration;
    let workers: Vec<_> = (0..limits.streams)
        .map(|_| {
            tokio::spawn(download(
                client.clone(),
                url.to_owned(),
                Arc::clone(&received),
                Arc::clone(&stop),
                deadline,
                limits.max_bytes,
            ))
        })
        .collect();

    let mut samples = Vec::new();
    let mut last_bytes = 0;
    let mut last_at = start;
    loop {
        tokio::time::sleep(limits.sample_every).await;
        let now = Instant::now();
        let bytes = received.load(Ordering::Acquire);
        let mbps = to_mbps(bytes.saturating_sub(last_bytes), now.duration_since(last_at));
        if now.duration_since(start) >= limits.warm_up {
            samples.push(mbps);
        }
        last_bytes = bytes;
        last_at = now;
        on_sample(SpeedProgress {
            elapsed_ms: millis(now.duration_since(start)),
            bytes,
            mbps,
        });
        let finished = now >= deadline
            || bytes >= limits.max_bytes
            || CANCELLED.load(Ordering::Acquire)
            || workers.iter().all(tokio::task::JoinHandle::is_finished);
        if finished {
            break;
        }
    }
    stop.store(true, Ordering::Release);
    for worker in &workers {
        worker.abort();
    }

    if CANCELLED.load(Ordering::Acquire) {
        return Err("pewpew-speed-test-cancelled".into());
    }
    let bytes = received.load(Ordering::Acquire);
    if bytes == 0 {
        return Err("pewpew-speed-test-failed".into());
    }
    let elapsed = start.elapsed();
    let average_mbps = to_mbps(bytes, elapsed);
    Ok(SpeedResult {
        mbps: percentile(&mut samples, 0.9).unwrap_or(average_mbps),
        average_mbps,
        bytes,
        elapsed_ms: millis(elapsed),
    })
}

async fn download(
    client: reqwest::Client,
    url: String,
    received: Arc<AtomicU64>,
    stop: Arc<AtomicBool>,
    deadline: Instant,
    max_bytes: u64,
) {
    let keep_going = |received: &AtomicU64| {
        !stop.load(Ordering::Acquire) && Instant::now() < deadline && received.load(Ordering::Acquire) < max_bytes
    };
    while keep_going(&received) {
        let Ok(mut response) = client.get(&url).send().await else {
            return;
        };
        if !response.status().is_success() {
            return;
        }
        while let Ok(Some(chunk)) = response.chunk().await {
            received.fetch_add(chunk.len() as u64, Ordering::AcqRel);
            if !keep_going(&received) {
                return;
            }
        }
    }
}

fn to_mbps(bytes: u64, elapsed: Duration) -> f64 {
    let seconds = elapsed.as_secs_f64();
    if seconds <= 0.0 {
        return 0.0;
    }
    bytes as f64 * 8.0 / seconds / 1_000_000.0
}

fn millis(duration: Duration) -> u64 {
    u64::try_from(duration.as_millis()).unwrap_or(u64::MAX)
}

/// Nearest-rank percentile; sorts the samples in place.
fn percentile(samples: &mut [f64], rank: f64) -> Option<f64> {
    if samples.is_empty() {
        return None;
    }
    samples.sort_by(f64::total_cmp);
    let last = samples.len() - 1;
    let index = ((last as f64) * rank).round() as usize;
    samples.get(index.min(last)).copied()
}

#[cfg(test)]
mod tests {
    use super::{Limits, percentile, run, to_mbps};
    use std::io::{Read as _, Write as _};
    use std::net::TcpListener;
    use std::time::Duration;

    /// Local HTTP server that sends `body_len` bytes per request, pausing
    /// between chunks so the speed is measurable.
    #[allow(clippy::expect_used)]
    fn serve(body_len: usize, chunk: usize, pause: Duration) -> String {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind test server");
        let address = listener.local_addr().expect("test server address");
        std::thread::spawn(move || {
            for mut stream in listener.incoming().flatten() {
                std::thread::spawn(move || {
                    let mut request = [0_u8; 2048];
                    let _ = stream.read(&mut request);
                    let head = format!("HTTP/1.1 200 OK\r\nContent-Length: {body_len}\r\nConnection: close\r\n\r\n");
                    if stream.write_all(head.as_bytes()).is_err() {
                        return;
                    }
                    let data = vec![0_u8; chunk];
                    let mut sent = 0;
                    while sent < body_len {
                        let size = chunk.min(body_len - sent);
                        if stream.write_all(&data[..size]).is_err() {
                            return;
                        }
                        sent += size;
                        std::thread::sleep(pause);
                    }
                });
            }
        });
        format!("http://{address}/__down")
    }

    const fn limits(duration_ms: u64, max_bytes: u64) -> Limits {
        Limits {
            streams: 2,
            duration: Duration::from_millis(duration_ms),
            max_bytes,
            warm_up: Duration::from_millis(200),
            sample_every: Duration::from_millis(100),
        }
    }

    #[allow(clippy::expect_used)]
    fn client() -> reqwest::Client {
        reqwest::Client::builder()
            .http1_only()
            .no_proxy()
            .build()
            .expect("test client")
    }

    #[test]
    fn speed_is_in_megabits_per_second() {
        assert!((to_mbps(12_500_000, Duration::from_secs(1)) - 100.0).abs() < 1e-9);
        assert!((to_mbps(1_250_000, Duration::from_millis(200)) - 50.0).abs() < 1e-9);
        assert!(to_mbps(1_000, Duration::ZERO).abs() < f64::EPSILON);
    }

    #[test]
    fn headline_is_the_ninetieth_percentile() {
        let mut samples: Vec<f64> = (1..=10).map(f64::from).collect();
        samples.reverse();
        assert_eq!(percentile(&mut samples, 0.9), Some(9.0));
        assert_eq!(percentile(&mut [42.0], 0.9), Some(42.0));
        assert_eq!(percentile(&mut [], 0.9), None);
    }

    #[tokio::test]
    async fn measures_a_steady_download_and_reports_progress() {
        let url = serve(50_000_000, 16 * 1024, Duration::from_millis(2));
        let mut updates = 0;
        let result = run(client(), &url, limits(1200, u64::MAX), |_| updates += 1).await;
        assert!(
            result
                .as_ref()
                .is_ok_and(|r| r.bytes > 0 && r.mbps > 0.0 && r.average_mbps > 0.0),
            "{result:?}"
        );
        assert!(
            result.as_ref().is_ok_and(|r| (1100..2500).contains(&r.elapsed_ms)),
            "{result:?}"
        );
        assert!(updates >= 8, "only {updates} progress updates");
    }

    #[tokio::test]
    async fn stops_early_once_the_data_cap_is_reached() {
        let url = serve(50_000_000, 64 * 1024, Duration::ZERO);
        let result = run(client(), &url, limits(5000, 2_000_000), |_| {}).await;
        assert!(
            result
                .as_ref()
                .is_ok_and(|r| r.bytes >= 2_000_000 && r.elapsed_ms < 2000),
            "{result:?}"
        );
    }

    #[tokio::test]
    async fn an_unreachable_server_fails_quickly() {
        let address = TcpListener::bind("127.0.0.1:0").and_then(|listener| listener.local_addr());
        assert!(address.is_ok());
        let url = address
            .map(|address| format!("http://{address}/__down"))
            .unwrap_or_default();
        let result = run(client(), &url, limits(3000, u64::MAX), |_| {}).await;
        assert_eq!(
            result.map(|r| r.bytes).map_err(|e| e.to_string()),
            Err("pewpew-speed-test-failed".to_owned())
        );
    }
}
