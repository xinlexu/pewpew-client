#![allow(clippy::expect_used)]

use super::*;
use std::{
    path::PathBuf,
    process::{Child, Command, Stdio},
};
use tokio::io::{AsyncReadExt as _, AsyncWriteExt as _};

struct Core(Child);
impl Drop for Core {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

fn free_port() -> u16 {
    std::net::TcpListener::bind("127.0.0.1:0")
        .expect("test port")
        .local_addr()
        .expect("address")
        .port()
}

#[tokio::test]
#[ignore = "Opt-in isolated core and bounded live probe; never enables TUN or system proxy"]
async fn live_probe_and_rule_isolation() -> Result<()> {
    let executable = std::env::var("PEWPEW_TEST_CORE")?;
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../target")
        .join(format!("discord-probe-{}", nanoid::nanoid!(8)));
    std::fs::create_dir_all(&root)?;
    let mixed = free_port();
    let api = free_port();
    let local = tokio::net::TcpListener::bind("127.0.0.1:0").await?;
    let web_port = local.local_addr()?.port();
    let web = tokio::spawn(async move {
        while let Ok((mut stream, _)) = local.accept().await {
            tokio::spawn(async move {
                let mut buffer = [0; 4096];
                let _ = tokio::time::timeout(Duration::from_secs(3), stream.read(&mut buffer)).await;
                let _ = stream
                    .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nOK")
                    .await;
            });
        }
    });
    let input: Mapping = serde_yaml_ng::from_str(&format!(
        r#"
mixed-port: {mixed}
external-controller: 127.0.0.1:{api}
allow-lan: false
mode: rule
log-level: silent
tun: {{enable: false}}
dns: {{enable: false}}
hosts:
  discord.com: 127.0.0.1
  ordinary.example: 127.0.0.1
proxies:
  - {{name: TestRoute, type: direct}}
proxy-groups:
  - {{name: Main, type: select, proxies: [TestRoute]}}
rules: ["MATCH,REJECT"]
"#
    ))?;
    let config = config::add_groups(input, "test");
    let path = root.join("config.json");
    std::fs::write(&path, serde_json::to_vec_pretty(&config)?)?;
    let validation = Command::new(&executable)
        .args(["-t", "-d"])
        .arg(&root)
        .arg("-f")
        .arg(&path)
        .output()?;
    assert!(
        validation.status.success(),
        "core rejected rules: {}",
        String::from_utf8_lossy(&validation.stdout)
    );
    let core = Core(
        Command::new(&executable)
            .arg("-d")
            .arg(&root)
            .arg("-f")
            .arg(&path)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()?,
    );
    let control = reqwest::Client::builder()
        .no_proxy()
        .timeout(Duration::from_secs(3))
        .build()?;
    let api_url = format!("http://127.0.0.1:{api}");
    for _ in 0..50 {
        if control.get(format!("{api_url}/version")).send().await.is_ok() {
            break;
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    let cert = reqwest::Certificate::from_pem(include_bytes!("../../../services/route-probe/server.crt"))?;
    let http = reqwest::Client::builder()
        .no_proxy()
        .add_root_certificate(cert)
        .proxy(reqwest::Proxy::all(format!("http://127.0.0.1:{mixed}"))?)
        .timeout(Duration::from_secs(4))
        .build()?;
    let discord_url = format!("http://discord.com:{web_port}");
    let ordinary_url = format!("http://ordinary.example:{web_port}");
    assert!(
        !http
            .get(&discord_url)
            .send()
            .await
            .is_ok_and(|r| r.status().is_success()),
        "PASS must preserve original REJECT"
    );
    control
        .put(format!("{api_url}/proxies/PewPew%20Internal%20Probe%20test"))
        .json(&serde_json::json!({"name":"TestRoute"}))
        .send()
        .await?
        .error_for_status()?;
    assert!(
        http.get("https://138.68.16.189:18443/health")
            .send()
            .await?
            .status()
            .is_success()
    );
    assert!(
        !http
            .get(&discord_url)
            .send()
            .await
            .is_ok_and(|r| r.status().is_success()),
        "probe must not alter Discord"
    );
    let quality = transport::measure(mixed, EPOCH.load(Ordering::SeqCst)).await?;
    println!("UDP receipt evidence: {quality:?}");
    control
        .put(format!("{api_url}/proxies/PewPew%20Internal%20Discord%20test"))
        .json(&serde_json::json!({"name":"TestRoute"}))
        .send()
        .await?
        .error_for_status()?;
    assert_eq!(http.get(&discord_url).send().await?.status(), 200);
    assert!(
        !http
            .get(&ordinary_url)
            .send()
            .await
            .is_ok_and(|r| r.status().is_success()),
        "ordinary traffic must retain original rules"
    );
    control
        .put(format!("{api_url}/proxies/PewPew%20Internal%20Discord%20test"))
        .json(&serde_json::json!({"name":"PASS"}))
        .send()
        .await?
        .error_for_status()?;
    assert!(
        !http
            .get(&discord_url)
            .send()
            .await
            .is_ok_and(|r| r.status().is_success()),
        "manual reset must restore original rules"
    );
    drop(core);
    web.abort();
    Ok(())
}
