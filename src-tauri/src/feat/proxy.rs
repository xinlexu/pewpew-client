use crate::{
    config::{Config, IVerge},
    core::{handle, service},
    module::lightweight,
    utils::window_manager::WindowManager,
};
use anyhow::Result;
use clash_verge_logging::{Type, logging};
use std::env;
use tauri_plugin_clipboard_manager::ClipboardExt as _;

fn connection_patch(enabled: bool, verge: &IVerge) -> IVerge {
    IVerge {
        enable_system_proxy: Some(enabled),
        enable_tun_mode: Some(enabled && verge.pewpew_enhanced_mode.or(verge.enable_tun_mode).unwrap_or(false)),
        ..IVerge::default()
    }
}

pub async fn disconnect_connection() -> Result<()> {
    let verge = Config::verge().await.latest_arc();
    super::patch_verge(
        &IVerge {
            enable_system_proxy: Some(false),
            ..IVerge::default()
        },
        false,
    )
    .await?;
    let actual_tun = handle::Handle::mihomo()
        .await
        .get_base_config()
        .await
        .ok()
        .is_some_and(|config| config.tun.enable);
    // Keep the system proxy off even when stopping enhanced routing fails.
    if actual_tun || verge.enable_tun_mode.unwrap_or(false) {
        super::patch_verge(
            &IVerge {
                enable_tun_mode: Some(false),
                ..IVerge::default()
            },
            false,
        )
        .await?;
    }
    if verge.auto_close_connection.unwrap_or(false)
        && let Err(err) = handle::Handle::mihomo().await.close_all_connections().await
    {
        logging!(error, Type::ProxyMode, "Failed to close all connections: {err}");
    }
    Ok(())
}

/// Tray and hotkey actions follow the same remembered connection mode as home.
pub async fn toggle_system_proxy() -> bool {
    let verge = Config::verge().await.latest_arc();
    let current = verge.enable_system_proxy.unwrap_or(false) || verge.enable_tun_mode.unwrap_or(false);
    let requested = !current;
    let patch = connection_patch(requested, &verge);
    if requested && patch.enable_tun_mode == Some(true) && !verge.pewpew_enhanced_accepted.unwrap_or(false) {
        if !lightweight::exit_lightweight_mode().await {
            WindowManager::show_main_window().await;
        }
        return current;
    }

    let patch_result: Result<()> = async {
        if !requested {
            return disconnect_connection().await;
        }
        if patch.enable_tun_mode == Some(true) {
            service::prepare_enhanced_connection().await?;
        }
        super::patch_verge(&patch, false).await
    }
    .await;

    match patch_result {
        Ok(_) => {
            handle::Handle::refresh_verge();
            requested
        }
        Err(err) => {
            logging!(error, Type::ProxyMode, "{err}");
            let message = if err.to_string().contains("pewpew-service-conflict") {
                "home.pewpew.compatibility.serviceConflict"
            } else {
                "home.pewpew.compatibility.changeFailed"
            };
            handle::Handle::notice_message("set_config::error", message);
            current
        }
    }
}

/// Toggle TUN mode on/off
/// Returns the updated toggle state
pub async fn toggle_tun_mode(not_save_file: Option<bool>) -> bool {
    let current = Config::verge().await.latest_arc().enable_tun_mode.unwrap_or(false);
    let enable = !current;

    match super::patch_verge(
        &IVerge {
            enable_tun_mode: Some(enable),
            ..IVerge::default()
        },
        not_save_file.unwrap_or(false),
    )
    .await
    {
        Ok(_) => {
            handle::Handle::refresh_verge();
            enable
        }
        Err(err) => {
            logging!(error, Type::ProxyMode, "{err}");
            current
        }
    }
}

/// Copy proxy environment variables to clipboard
pub async fn copy_clash_env() {
    let env_ip = env::var("CLASH_VERGE_REV_IP").ok();
    let verge_cfg = Config::verge().await.latest_arc();
    let ip = env_ip
        .as_deref()
        .unwrap_or_else(|| verge_cfg.proxy_host.as_deref().unwrap_or("127.0.0.1"));

    let app_handle = handle::Handle::app_handle();
    let port = verge_cfg.verge_mixed_port.unwrap_or(7897);
    let http_proxy = format!("http://{ip}:{port}");
    let socks5_proxy = format!("socks5://{ip}:{port}");

    let clipboard = app_handle.clipboard();

    let default_env = {
        #[cfg(not(target_os = "windows"))]
        {
            "bash"
        }
        #[cfg(target_os = "windows")]
        {
            "powershell"
        }
    };
    let env_type = verge_cfg.env_type.as_deref().unwrap_or(default_env);

    let export_text = match env_type {
        "bash" => format!("export https_proxy={http_proxy} http_proxy={http_proxy} all_proxy={socks5_proxy}"),
        "cmd" => format!("set http_proxy={http_proxy}\r\nset https_proxy={http_proxy}"),
        "powershell" => {
            format!("$env:HTTP_PROXY=\"{http_proxy}\"; $env:HTTPS_PROXY=\"{http_proxy}\"")
        }
        "nushell" => {
            format!("load-env {{ http_proxy: \"{http_proxy}\", https_proxy: \"{http_proxy}\" }}")
        }
        "fish" => format!("set -x http_proxy {http_proxy}; set -x https_proxy {http_proxy}"),
        _ => {
            logging!(error, Type::ProxyMode, "copy_clash_env: Invalid env type! {env_type}");
            return;
        }
    };

    if clipboard.write_text(&export_text).is_err() {
        logging!(error, Type::ProxyMode, "Failed to write to clipboard");
    }
}

#[cfg(test)]
mod tests {
    use super::connection_patch;
    use crate::config::IVerge;

    #[test]
    fn tray_connect_uses_remembered_mode_without_changing_preference() {
        let config = IVerge {
            pewpew_enhanced_mode: Some(true),
            ..IVerge::default()
        };
        let connect = connection_patch(true, &config);
        assert_eq!(connect.enable_system_proxy, Some(true));
        assert_eq!(connect.enable_tun_mode, Some(true));
        assert_eq!(connect.pewpew_enhanced_mode, None);
        let disconnect = connection_patch(false, &config);
        assert_eq!(disconnect.enable_system_proxy, Some(false));
        assert_eq!(disconnect.enable_tun_mode, Some(false));
    }

    #[test]
    fn standard_mode_does_not_retain_legacy_tun_flag() {
        let config = IVerge {
            pewpew_enhanced_mode: Some(false),
            enable_tun_mode: Some(true),
            ..IVerge::default()
        };
        assert_eq!(connection_patch(true, &config).enable_tun_mode, Some(false));
    }
}
