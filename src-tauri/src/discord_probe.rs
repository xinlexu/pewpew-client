mod config;
#[cfg(test)]
mod tests;
mod transport;

use crate::{core::handle::Handle, process::AsyncHandler};
use anyhow::{Result, bail};
use network_interface::{NetworkInterface, NetworkInterfaceConfig as _};
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use serde_yaml_ng::Mapping;
use std::{
    sync::{
        LazyLock,
        atomic::{AtomicU64, Ordering},
    },
    time::{Duration, Instant},
};
use tauri_plugin_mihomo::models::{ClashMode, Proxies, ProxyType};

static EPOCH: AtomicU64 = AtomicU64::new(0);
static STATE: LazyLock<Mutex<State>> = LazyLock::new(|| Mutex::new(State::default()));
static APPLY: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

#[derive(Clone, Default, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProbeContext {
    main_group: String,
    baseline: String,
    candidates: Vec<String>,
}

#[derive(Clone, Serialize)]
pub struct ProbeStatus {
    state: &'static str,
    route: Option<String>,
}

impl Default for ProbeStatus {
    fn default() -> Self {
        Self {
            state: "following",
            route: None,
        }
    }
}

#[derive(Default)]
struct State {
    context: ProbeContext,
    manual: bool,
    last_attempt: Option<Instant>,
    status: ProbeStatus,
    group: String,
    tested_group: String,
    network: Option<String>,
}

pub fn inject(config: Mapping, enabled: bool) -> Mapping {
    EPOCH.fetch_add(1, Ordering::SeqCst);
    let mut state = STATE.lock();
    if !state.manual {
        state.status = ProbeStatus::default();
    }
    if !enabled {
        state.manual = false;
        return config;
    }
    drop(state);
    config::add_groups(config, &nanoid::nanoid!(8))
}

pub fn is_current(epoch: u64) -> bool {
    EPOCH.load(Ordering::SeqCst) == epoch && !STATE.lock().manual && !Handle::global().is_exiting()
}

fn publish(epoch: u64, status: ProbeStatus) {
    let mut state = STATE.lock();
    if EPOCH.load(Ordering::SeqCst) == epoch && !state.manual {
        state.status = status;
    }
}

#[tauri::command]
pub async fn set_discord_probe_context(mut context: ProbeContext) -> Result<(), String> {
    context.candidates.truncate(3);
    {
        let mut state = STATE.lock();
        if state.context == context {
            return Ok(());
        }
        if state.context.main_group == context.main_group && state.context.baseline == context.baseline {
            state.context = context;
            return Ok(());
        }
        EPOCH.fetch_add(1, Ordering::SeqCst);
        state.context = context;
        if !state.manual {
            state.status = ProbeStatus::default();
        }
    }
    let _guard = APPLY.lock().await;
    reset_route().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_discord_probe_status() -> ProbeStatus {
    STATE.lock().status.clone()
}

#[tauri::command]
pub async fn follow_manual_discord_route() -> Result<(), String> {
    {
        let mut state = STATE.lock();
        EPOCH.fetch_add(1, Ordering::SeqCst);
        state.manual = true;
        state.status = ProbeStatus {
            state: "manual",
            route: None,
        };
    }
    let _guard = APPLY.lock().await;
    let enabled = Handle::mihomo()
        .await
        .get_base_config()
        .await
        .map_err(|e| e.to_string())?
        .tun
        .enable;
    if !enabled {
        STATE.lock().manual = false;
    }
    reset_route().await.map_err(|e| e.to_string())
}

async fn reset_route() -> Result<()> {
    let client = Handle::mihomo().await;
    let proxies = client.get_proxies().await?;
    for name in proxies
        .proxies
        .keys()
        .filter(|n| n.starts_with("PewPew Internal Discord "))
    {
        if proxies.proxies[name].now.as_deref() != Some("PASS") {
            client.select_node_for_group(name, "PASS").await?;
        }
    }
    drop(client);
    Ok(())
}

fn discord_running() -> bool {
    let mut system = sysinfo::System::new();
    system.refresh_processes_specifics(
        sysinfo::ProcessesToUpdate::All,
        true,
        sysinfo::ProcessRefreshKind::nothing(),
    );
    system.processes().values().any(|p| {
        matches!(
            p.name().to_string_lossy().to_ascii_lowercase().as_str(),
            "discord.exe" | "discordcanary.exe" | "discordptb.exe" | "discord" | "discord canary" | "discord ptb"
        )
    })
}

fn network_fingerprint() -> Option<String> {
    let mut addresses: Vec<String> = NetworkInterface::show()
        .ok()?
        .into_iter()
        .map(|interface| format!("{}:{:?}", interface.name, interface.addr))
        .collect();
    addresses.sort();
    Some(addresses.join("|"))
}

async fn update_network(network: Option<String>) {
    {
        let mut state = STATE.lock();
        if state.network == network {
            return;
        }
        EPOCH.fetch_add(1, Ordering::SeqCst);
        state.network = network;
        state.tested_group.clear();
        if !state.manual {
            state.status = ProbeStatus::default();
        }
    }
    let _guard = APPLY.lock().await;
    let _ = reset_route().await;
}

fn selected_leaf(proxies: &Proxies, group: &str) -> Option<String> {
    let mut name = group;
    for _ in 0..16 {
        let proxy = proxies.proxies.get(name)?;
        if proxy.all.is_none() {
            return Some(name.to_owned());
        }
        name = proxy.now.as_deref()?;
    }
    None
}

fn eligible_routes(proxies: &Proxies, context: &ProbeContext, group: &str) -> Vec<String> {
    let members = proxies.proxies.get(group).and_then(|p| p.all.as_ref());
    let mut result = vec![];
    for name in std::iter::once(&context.baseline).chain(context.candidates.iter()) {
        if !result.contains(name)
            && members.is_some_and(|list| list.contains(name))
            && proxies.proxies.get(name).is_some_and(|p| {
                p.udp
                    && p.all.is_none()
                    && !matches!(
                        p.proxy_type,
                        ProxyType::Direct
                            | ProxyType::Reject
                            | ProxyType::RejectDrop
                            | ProxyType::Compatible
                            | ProxyType::Pass
                            | ProxyType::Dns
                    )
            })
            && !matches!(name.as_str(), "DIRECT" | "REJECT" | "PASS" | "COMPATIBLE")
        {
            result.push(name.clone());
        }
        if result.len() == 3 {
            break;
        }
    }
    result
}

struct Job {
    epoch: u64,
    port: u16,
    probe: String,
    discord: String,
    routes: Vec<String>,
    context: ProbeContext,
}

async fn prepare(running: bool) -> Result<Option<Job>> {
    let client = Handle::mihomo().await;
    let base = client.get_base_config().await?;
    let proxies = client.get_proxies().await?;
    drop(client);
    if !base.tun.enable || base.mode != ClashMode::Rule {
        {
            let mut state = STATE.lock();
            if !base.tun.enable {
                state.manual = false;
            }
            state.status = ProbeStatus::default();
        }
        let _guard = APPLY.lock().await;
        reset_route().await?;
        return Ok(None);
    }
    if !running {
        return Ok(None);
    }
    let Some(discord) = proxies
        .proxies
        .keys()
        .find(|n| n.starts_with("PewPew Internal Discord "))
        .cloned()
    else {
        return Ok(None);
    };
    let suffix = discord.trim_start_matches("PewPew Internal Discord ");
    let probe = format!("PewPew Internal Probe {suffix}");
    let mut state = STATE.lock();
    if state.group != discord {
        state.group.clone_from(&discord);
        if !state.manual {
            state.status = ProbeStatus::default();
        }
    }
    if state.manual
        || state.tested_group == discord
        || state
            .last_attempt
            .is_some_and(|at| at.elapsed() < Duration::from_secs(1800))
    {
        return Ok(None);
    }
    let context = state.context.clone();
    if selected_leaf(&proxies, &context.main_group).as_deref() != Some(&context.baseline) {
        return Ok(None);
    }
    let routes = eligible_routes(&proxies, &context, &discord);
    if routes.len() < 2 || routes.first() != Some(&context.baseline) {
        return Ok(None);
    }
    state.last_attempt = Some(Instant::now());
    state.tested_group.clone_from(&discord);
    state.status = ProbeStatus {
        state: "testing",
        route: None,
    };
    drop(state);
    Ok(Some(Job {
        epoch: EPOCH.load(Ordering::SeqCst),
        port: base.mixed_port,
        probe,
        discord,
        routes,
        context,
    }))
}

async fn probe_route(job: &Job, route: &str) -> Result<transport::Quality> {
    if !is_current(job.epoch) {
        bail!("cancelled");
    }
    let client = Handle::mihomo().await;
    client.select_node_for_group(&job.probe, route).await?;
    drop(client);
    transport::measure(job.port, job.epoch).await
}

async fn choose(job: &Job) -> Result<Option<String>> {
    let baseline = probe_route(job, &job.routes[0]).await?;
    // Adequate existing service does not justify changing a live application's route.
    if baseline.healthy() {
        return Ok(None);
    }
    let mut best: Option<(String, transport::Quality)> = None;
    for route in job.routes.iter().skip(1) {
        if let Ok(quality) = probe_route(job, route).await
            && quality.healthy()
            && quality.score() + 30.0 < baseline.score()
            && best.as_ref().is_none_or(|(_, old)| quality.score() < old.score())
        {
            best = Some((route.clone(), quality));
        }
    }
    let Some((route, _)) = best else { return Ok(None) };
    let confirmed = probe_route(job, &route).await?;
    Ok((confirmed.healthy() && confirmed.score() + 30.0 < baseline.score()).then_some(route))
}

async fn execute(job: Job) -> Result<()> {
    let winner = choose(&job).await.ok().flatten();
    let _guard = APPLY.lock().await;
    let client = Handle::mihomo().await;
    let _ = client.select_node_for_group(&job.probe, "PASS").await;
    if !is_current(job.epoch) {
        return Ok(());
    }
    let base = client.get_base_config().await?;
    let proxies = client.get_proxies().await?;
    if !base.tun.enable
        || base.mode != ClashMode::Rule
        || selected_leaf(&proxies, &job.context.main_group).as_deref() != Some(&job.context.baseline)
        || !proxies.proxies.contains_key(&job.discord)
    {
        return Ok(());
    }
    if let Some(route) = winner {
        client.select_node_for_group(&job.discord, &route).await?;
        if is_current(job.epoch) {
            publish(
                job.epoch,
                ProbeStatus {
                    state: "selected",
                    route: Some(route),
                },
            );
        } else {
            client.select_node_for_group(&job.discord, "PASS").await?;
        }
    } else {
        client.select_node_for_group(&job.discord, "PASS").await?;
        if is_current(job.epoch) {
            publish(job.epoch, ProbeStatus::default());
        }
    }
    drop(client);
    Ok(())
}

pub fn start() {
    AsyncHandler::spawn(|| async {
        while !Handle::global().is_exiting() {
            tokio::time::sleep(Duration::from_secs(15)).await;
            let (running, network) = tokio::task::spawn_blocking(|| (discord_running(), network_fingerprint()))
                .await
                .unwrap_or((false, None));
            let identified = network.is_some();
            update_network(network).await;
            if let Ok(Some(job)) = prepare(running && identified).await {
                let epoch = job.epoch;
                if execute(job).await.is_err() && is_current(epoch) {
                    publish(epoch, ProbeStatus::default());
                }
            }
        }
    });
}
