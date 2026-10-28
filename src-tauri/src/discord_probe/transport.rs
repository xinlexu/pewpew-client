use anyhow::{Context as _, Result, bail};
use fast_socks5::client::Socks5Datagram;
use serde::Deserialize;
use std::time::Duration;
use tokio::{
    net::TcpStream,
    time::{Instant, timeout},
};

const ENDPOINT: &str = "https://138.68.16.189:18443";
const PACKETS: usize = 1500;

#[derive(Clone, Debug)]
pub struct Quality {
    pub loss: f64,
    pub jitter_ms: f64,
    pub rtt_ms: f64,
    pub mbps: f64,
}

impl Quality {
    pub fn healthy(&self) -> bool {
        self.loss <= 0.02 && self.jitter_ms <= 35.0 && self.rtt_ms <= 300.0 && self.mbps >= 4.5
    }
    pub fn score(&self) -> f64 {
        self.loss * 2000.0 + self.jitter_ms * 2.0 + self.rtt_ms * 0.25
    }
}

#[derive(Deserialize)]
struct Ticket {
    token: String,
}

pub async fn measure(port: u16, epoch: u64) -> Result<Quality> {
    let cert = reqwest::Certificate::from_pem(include_bytes!("../../../services/route-probe/server.crt"))?;
    let client = reqwest::Client::builder()
        .no_proxy()
        .proxy(reqwest::Proxy::all(format!("http://127.0.0.1:{port}"))?)
        .add_root_certificate(cert)
        .https_only(true)
        .http1_only()
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(3))
        .timeout(Duration::from_secs(4))
        .build()?;
    let ticket: Ticket = client
        .post(format!("{ENDPOINT}/session"))
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?;
    let result = timeout(Duration::from_secs(7), exchange(port, &ticket.token, epoch)).await;
    let _ = client.post(format!("{ENDPOINT}/finish/{}", ticket.token)).send().await;
    result.context("probe deadline")?
}

async fn exchange(port: u16, token: &str, epoch: u64) -> Result<Quality> {
    if token.len() != 48 || !token.bytes().all(|b| b.is_ascii_hexdigit()) {
        bail!("invalid probe ticket");
    }
    let mut packet = [0_u8; 1000];
    packet[..4].copy_from_slice(b"PP01");
    for index in 0..24 {
        packet[4 + index] = u8::from_str_radix(&token[index * 2..index * 2 + 2], 16)?;
    }
    let stream = TcpStream::connect(("127.0.0.1", port)).await?;
    let tunnel = Socks5Datagram::bind(stream, "127.0.0.1:0").await?;
    let mut times = vec![None; PACKETS];
    let mut received = vec![false; PACKETS];
    let mut rtts = Vec::new();
    let mut sent = 0_usize;
    let start = Instant::now();
    let mut pacing = tokio::time::interval(Duration::from_millis(10));
    pacing.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    let mut buffer = [0_u8; 1100];
    let deadline = tokio::time::sleep(Duration::from_secs(4));
    tokio::pin!(deadline);
    let mut sending_seconds = 0.0;
    loop {
        if !super::is_current(epoch) {
            bail!("probe cancelled");
        }
        tokio::select! {
            _ = &mut deadline => break,
            _ = pacing.tick(), if sent < PACKETS => {
                for _ in 0..8 {
                    if sent == PACKETS { break; }
                    let sequence = u32::try_from(sent)?;
                    packet[28..32].copy_from_slice(&sequence.to_be_bytes());
                    times[sent] = Some(Instant::now());
                    tunnel.send_to(&packet, ("138.68.16.189", 18444)).await?;
                    sent += 1;
                }
                if sent == PACKETS { sending_seconds = start.elapsed().as_secs_f64(); }
            }
            receipt = Box::pin(tunnel.recv_from(&mut buffer)) => {
                let (length, _) = receipt?;
                if length != 32 || buffer[..28] != packet[..28] { continue; }
                let index = usize::try_from(u32::from_be_bytes(buffer[28..32].try_into()?))?;
                if index >= sent || received[index] { continue; }
                if let Some(time) = times[index] {
                    received[index] = true;
                    rtts.push(time.elapsed().as_secs_f64() * 1000.0);
                }
                if rtts.len() == PACKETS { break; }
            }
        }
    }
    if sent != PACKETS || sending_seconds <= 0.0 || sending_seconds > 3.0 || rtts.len() < 10 {
        bail!("insufficient UDP evidence");
    }
    let count = u32::try_from(rtts.len())?;
    let jitter = rtts.windows(2).map(|w| (w[1] - w[0]).abs()).sum::<f64>() / f64::from(count - 1);
    rtts.sort_by(f64::total_cmp);
    Ok(Quality {
        loss: 1.0 - f64::from(count) / 1500.0,
        jitter_ms: jitter,
        rtt_ms: rtts[rtts.len() * 95 / 100],
        mbps: f64::from(count) * 8000.0 / sending_seconds / 1_000_000.0,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn upload_alone_cannot_qualify_a_route() {
        let good = Quality {
            loss: 0.01,
            jitter_ms: 10.0,
            rtt_ms: 100.0,
            mbps: 5.0,
        };
        assert!(good.healthy());
        assert!(!Quality { loss: 0.1, ..good }.healthy());
        assert!(
            !Quality {
                jitter_ms: 80.0,
                ..good
            }
            .healthy()
        );
        assert!(!Quality { mbps: 1.0, ..good }.healthy());
    }
}
