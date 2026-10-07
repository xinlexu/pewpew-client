use crate::{
    config::{Config, IVerge},
    singleton,
};
use anyhow::Result;
use clash_verge_logging::{Type, logging};
use parking_lot::RwLock;
use scopeguard::defer;
use smartstring::alias::String;
use std::{
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    time::Duration,
};
use sysproxy::{Autoproxy, GuardMonitor, GuardType, Sysproxy};
use tokio::sync::Mutex as TokioMutex;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ProxyApplyStep {
    Sysproxy,
    Autoproxy,
}

const fn proxy_apply_steps(sys_enabled: bool, auto_enabled: bool) -> [ProxyApplyStep; 2] {
    // Disabling PAC clears WinINET proxy flags on Windows, so pure global
    // proxy mode must clear PAC before enabling Sysproxy.
    if sys_enabled && !auto_enabled {
        [ProxyApplyStep::Autoproxy, ProxyApplyStep::Sysproxy]
    } else {
        [ProxyApplyStep::Sysproxy, ProxyApplyStep::Autoproxy]
    }
}

pub struct Sysopt {
    update_lock: TokioMutex<()>,
    reset_sysproxy: AtomicBool,
    inner_proxy: Arc<RwLock<(Sysproxy, Autoproxy)>>,
    guard: Arc<RwLock<GuardMonitor>>,
}

pub struct ProxySnapshot {
    current: (Sysproxy, Autoproxy),
    managed: (Sysproxy, Autoproxy),
}

fn owns_system_proxy(expected: &Sysproxy, current: &Sysproxy) -> bool {
    !expected.host.is_empty() && expected.port != 0 && expected.host == current.host && expected.port == current.port
}

fn disconnected_proxy_state(
    (mut sys, mut auto): (Sysproxy, Autoproxy),
    managed: &[(Sysproxy, Autoproxy)],
) -> Option<(Sysproxy, Autoproxy)> {
    let owns_sys = sys.enable && managed.iter().any(|(expected, _)| owns_system_proxy(expected, &sys));
    let owns_auto = auto.enable
        && managed
            .iter()
            .any(|(_, expected)| !expected.url.is_empty() && expected.url == auto.url);
    if !owns_sys && !owns_auto {
        return None;
    }
    if owns_sys {
        sys.enable = false;
    }
    if owns_auto {
        auto.enable = false;
    }
    Some((sys, auto))
}

fn apply_proxy_pair((sys, auto): (Sysproxy, Autoproxy)) -> Result<()> {
    for step in proxy_apply_steps(sys.enable, auto.enable) {
        match step {
            ProxyApplyStep::Sysproxy => sys.set_system_proxy()?,
            ProxyApplyStep::Autoproxy => auto.set_auto_proxy()?,
        }
    }
    Ok(())
}

impl Default for Sysopt {
    fn default() -> Self {
        Self {
            update_lock: TokioMutex::new(()),
            reset_sysproxy: AtomicBool::new(false),
            inner_proxy: Arc::new(RwLock::new((Sysproxy::default(), Autoproxy::default()))),
            guard: Arc::new(RwLock::new(GuardMonitor::new(GuardType::None, Duration::from_secs(30)))),
        }
    }
}

#[cfg(target_os = "windows")]
static DEFAULT_BYPASS: &str = "localhost;127.*;192.168.*;10.*;172.16.*;172.17.*;172.18.*;172.19.*;172.20.*;172.21.*;172.22.*;172.23.*;172.24.*;172.25.*;172.26.*;172.27.*;172.28.*;172.29.*;172.30.*;172.31.*;<local>";
#[cfg(target_os = "linux")]
static DEFAULT_BYPASS: &str = "localhost,127.0.0.1,192.168.0.0/16,10.0.0.0/8,172.16.0.0/12,::1";
#[cfg(target_os = "macos")]
static DEFAULT_BYPASS: &str =
    "127.0.0.1,192.168.0.0/16,10.0.0.0/8,172.16.0.0/12,localhost,*.local,*.crashlytics.com,<local>";

async fn get_bypass() -> String {
    let use_default = Config::verge().await.latest_arc().use_default_bypass.unwrap_or(true);
    let res = {
        let verge = Config::verge().await;
        let verge = verge.latest_arc();
        verge.system_proxy_bypass.clone()
    };
    let custom_bypass = match res {
        Some(bypass) => bypass,
        None => "".into(),
    };

    if custom_bypass.is_empty() {
        DEFAULT_BYPASS.into()
    } else if use_default {
        format!("{DEFAULT_BYPASS},{custom_bypass}").into()
    } else {
        custom_bypass
    }
}

singleton!(Sysopt, SYSOPT);

impl Sysopt {
    fn new() -> Self {
        Self::default()
    }

    fn access_guard(&self) -> Arc<RwLock<GuardMonitor>> {
        Arc::clone(&self.guard)
    }

    pub async fn refresh_guard(&self) {
        logging!(info, Type::Core, "Refreshing system proxy guard...");
        let verge = Config::verge().await.latest_arc();
        if !verge.enable_system_proxy.unwrap_or_default() {
            logging!(info, Type::Core, "System proxy is disabled.");
            self.access_guard().write().stop();
            return;
        }
        if !verge.enable_proxy_guard.unwrap_or_default() {
            logging!(info, Type::Core, "System proxy guard is disabled.");
            self.access_guard().write().stop();
            return;
        }
        logging!(
            info,
            Type::Core,
            "Updating system proxy with duration: {} seconds",
            verge.proxy_guard_duration.unwrap_or(30)
        );
        {
            let guard = self.access_guard();
            guard
                .write()
                .set_interval(Duration::from_secs(verge.proxy_guard_duration.unwrap_or(30)));
        }
        logging!(info, Type::Core, "Starting system proxy guard...");
        {
            let guard = self.access_guard();
            guard.write().start();
        }
    }

    /// Wait for any in-progress `update_sysproxy` to finish, so that a
    /// subsequent read of OS-level sysproxy state sees a fully applied
    /// configuration instead of a partially-applied one (e.g. SOCKS already
    /// disabled but HTTP still enabled mid-transition).
    pub async fn wait_idle(&self) {
        let _ = self.update_lock.lock().await;
    }

    pub async fn snapshot_proxy(&self) -> Result<ProxySnapshot> {
        let _lock = self.update_lock.lock().await;
        let current = tokio::task::spawn_blocking(|| -> Result<_> {
            Ok((Sysproxy::get_system_proxy()?, Autoproxy::get_auto_proxy()?))
        })
        .await??;
        Ok(ProxySnapshot {
            current,
            managed: self.inner_proxy.read().clone(),
        })
    }

    pub async fn restore_proxy_snapshot(&self, snapshot: ProxySnapshot) -> Result<()> {
        let _lock = self.update_lock.lock().await;
        self.access_guard().write().set_guard_type(GuardType::None);
        tokio::task::spawn_blocking(move || apply_proxy_pair(snapshot.current)).await??;
        let verge = Config::verge().await.latest_arc();
        let guard_type = if verge.enable_proxy_guard.unwrap_or_default() {
            if snapshot.managed.1.enable {
                GuardType::Autoproxy(snapshot.managed.1.clone())
            } else if snapshot.managed.0.enable {
                GuardType::Sysproxy(snapshot.managed.0.clone())
            } else {
                GuardType::None
            }
        } else {
            GuardType::None
        };
        *self.inner_proxy.write() = snapshot.managed;
        self.access_guard().write().set_guard_type(guard_type);
        self.refresh_guard().await;
        Ok(())
    }

    /// init the sysproxy
    pub async fn update_sysproxy(&self) -> Result<()> {
        let _lock = self.update_lock.lock().await;
        let previously_managed = self.inner_proxy.read().clone();

        let verge = Config::verge().await.latest_arc();
        let port = match verge.verge_mixed_port {
            Some(port) => port,
            None => Config::clash().await.latest_arc().get_mixed_port(),
        };
        let pac_port = IVerge::get_singleton_port();
        let (sys_enable, pac_enable, proxy_host, proxy_guard) = (
            verge.enable_system_proxy.unwrap_or_default(),
            verge.proxy_auto_config.unwrap_or_default(),
            verge.proxy_host.clone().unwrap_or_else(|| String::from("127.0.0.1")),
            verge.enable_proxy_guard.unwrap_or_default(),
        );
        // 先 await, 避免持有锁导致的 Send 问题
        let bypass = get_bypass().await;

        let (sys, auto, guard_type) = {
            let (sys, auto) = &mut *self.inner_proxy.write();
            sys.host = proxy_host.clone().into();
            sys.port = port;
            sys.bypass = bypass.into();
            auto.url = format!("http://{proxy_host}:{pac_port}/commands/pac");

            // `enable_system_proxy` is the master switch.
            // When disabled, clear only this client's global proxy and PAC.
            let guard_type = if !sys_enable {
                sys.enable = false;
                auto.enable = false;
                GuardType::None
            } else if pac_enable {
                sys.enable = false;
                auto.enable = true;
                if proxy_guard {
                    GuardType::Autoproxy(auto.clone())
                } else {
                    GuardType::None
                }
            } else {
                sys.enable = true;
                auto.enable = false;
                if proxy_guard {
                    GuardType::Sysproxy(sys.clone())
                } else {
                    GuardType::None
                }
            };

            (sys.clone(), auto.clone(), guard_type)
        };

        self.access_guard().write().set_guard_type(guard_type);

        tokio::task::spawn_blocking(move || -> Result<()> {
            if !sys.enable && !auto.enable {
                let current = (Sysproxy::get_system_proxy()?, Autoproxy::get_auto_proxy()?);
                if let Some(next) = disconnected_proxy_state(current, &[(sys, auto), previously_managed]) {
                    apply_proxy_pair(next)?;
                }
                return Ok(());
            }
            apply_proxy_pair((sys, auto))
        })
        .await??;

        Ok(())
    }

    /// reset the sysproxy
    pub async fn reset_sysproxy(&self) -> Result<()> {
        if self
            .reset_sysproxy
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .is_err()
        {
            return Ok(());
        }
        defer! {
            self.reset_sysproxy.store(false, Ordering::SeqCst);
        }
        let _lock = self.update_lock.lock().await;

        // close proxy guard
        self.access_guard().write().set_guard_type(GuardType::None);

        // Leave settings owned by other applications untouched on exit.
        let (sys, auto) = {
            let (sys, auto) = &mut *self.inner_proxy.write();
            sys.enable = false;
            auto.enable = false;
            (sys.clone(), auto.clone())
        };

        tokio::task::spawn_blocking(move || -> Result<()> {
            let current = (Sysproxy::get_system_proxy()?, Autoproxy::get_auto_proxy()?);
            if let Some(next) = disconnected_proxy_state(current, &[(sys, auto)]) {
                apply_proxy_pair(next)?;
            }
            Ok(())
        })
        .await??;

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::{ProxyApplyStep, disconnected_proxy_state, proxy_apply_steps};
    use sysproxy::{Autoproxy, Sysproxy};

    fn proxy_pair(host: &str, url: &str) -> (Sysproxy, Autoproxy) {
        (
            Sysproxy {
                enable: true,
                host: host.into(),
                port: 7897,
                ..Default::default()
            },
            Autoproxy {
                enable: true,
                url: url.into(),
            },
        )
    }

    #[test]
    fn disconnect_preserves_foreign_proxy_settings() {
        let ours = proxy_pair("127.0.0.1", "http://127.0.0.1:33331/commands/pac");
        let foreign = proxy_pair("office.example", "https://office.example/proxy.pac");
        assert!(disconnected_proxy_state(foreign, &[ours]).is_none());
    }

    #[test]
    fn disconnect_clears_only_our_manual_proxy() -> anyhow::Result<()> {
        let ours = proxy_pair("127.0.0.1", "http://127.0.0.1:33331/commands/pac");
        let current = proxy_pair("127.0.0.1", "https://office.example/proxy.pac");
        let (sys, auto) = disconnected_proxy_state(current, &[ours])
            .ok_or_else(|| anyhow::anyhow!("managed manual proxy was not recognized"))?;
        assert!(!sys.enable);
        assert!(auto.enable);
        assert_eq!(auto.url, "https://office.example/proxy.pac");
        Ok(())
    }

    #[test]
    fn disconnect_clears_only_our_pac() -> anyhow::Result<()> {
        let ours = proxy_pair("127.0.0.1", "http://127.0.0.1:33331/commands/pac");
        let current = proxy_pair("office.example", &ours.1.url);
        let (sys, auto) = disconnected_proxy_state(current, &[ours])
            .ok_or_else(|| anyhow::anyhow!("managed PAC was not recognized"))?;
        assert!(sys.enable);
        assert_eq!(sys.host, "office.example");
        assert!(!auto.enable);
        Ok(())
    }

    #[test]
    fn uninitialized_proxy_is_not_owned() {
        let current = proxy_pair("office.example", "");
        assert!(disconnected_proxy_state(current, &[(Sysproxy::default(), Autoproxy::default())]).is_none());
    }

    #[test]
    fn pure_sysproxy_mode_clears_pac_before_enabling_global_proxy() {
        assert_eq!(
            proxy_apply_steps(true, false),
            [ProxyApplyStep::Autoproxy, ProxyApplyStep::Sysproxy]
        );
    }

    #[test]
    fn pac_mode_clears_global_proxy_before_enabling_pac() {
        assert_eq!(
            proxy_apply_steps(false, true),
            [ProxyApplyStep::Sysproxy, ProxyApplyStep::Autoproxy]
        );
    }

    #[test]
    fn disabled_mode_clears_global_proxy_before_pac() {
        assert_eq!(
            proxy_apply_steps(false, false),
            [ProxyApplyStep::Sysproxy, ProxyApplyStep::Autoproxy]
        );
    }
}
