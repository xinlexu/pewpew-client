use std::time::Duration;

pub mod network {
    pub const DEFAULT_EXTERNAL_CONTROLLER: &str = "127.0.0.1:9097";

    pub mod ports {
        #[cfg(not(target_os = "windows"))]
        pub const DEFAULT_REDIR: u16 = 7895;
        #[cfg(target_os = "linux")]
        pub const DEFAULT_TPROXY: u16 = 7896;
        // PewPew's own defaults, so it can run while Clash Verge holds 7897-7899.
        pub const DEFAULT_MIXED: u16 = 7966;
        pub const DEFAULT_SOCKS: u16 = 7967;
        pub const DEFAULT_HTTP: u16 = 7968;

        // Clash Verge's defaults, which earlier PewPew versions also used.
        pub const LEGACY_MIXED: u16 = 7897;
        pub const LEGACY_SOCKS: u16 = 7898;
        pub const LEGACY_HTTP: u16 = 7899;

        /// Moves a port that still has the shared Clash Verge default to PewPew's own.
        pub const fn migrate_legacy(port: u16, legacy: u16, default: u16) -> u16 {
            if port == legacy { default } else { port }
        }

        #[cfg(not(feature = "verge-dev"))]
        pub const SINGLETON_SERVER: u16 = 33331;
        #[cfg(feature = "verge-dev")]
        pub const SINGLETON_SERVER: u16 = 11233;
    }
}

pub mod timing {
    use super::Duration;

    pub const CONFIG_UPDATE_DEBOUNCE: Duration = Duration::from_millis(300);
    pub const STARTUP_ERROR_DELAY: Duration = Duration::from_secs(2);

    #[cfg(target_os = "windows")]
    pub const SERVICE_WAIT_MAX: Duration = Duration::from_millis(3000);
    #[cfg(target_os = "windows")]
    pub const SERVICE_WAIT_INTERVAL: Duration = Duration::from_millis(200);
}

pub mod files {
    pub const RUNTIME_CONFIG: &str = "clash-verge.yaml";
    pub const CHECK_CONFIG: &str = "clash-verge-check.yaml";
    pub const DNS_CONFIG: &str = "dns_config.yaml";
    pub const WINDOW_STATE: &str = "window_state.json";
}

pub mod tun {
    pub const DEFAULT_STACK: &str = "gvisor";

    pub const DNS_HIJACK: &[&str] = &["any:53"];
}
