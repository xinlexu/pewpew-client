use crate::{
    config::{Config, IClashTemp},
    core::{logger::Logger, tray::Tray},
    utils::dirs,
};
use anyhow::{Context as _, Result, anyhow, bail};
use backon::{ConstantBuilder, Retryable as _};
use clash_verge_logging::{Type, logging, logging_error};
use clash_verge_service_ipc::CoreConfig;
use compact_str::CompactString;
use once_cell::sync::Lazy;
use std::{
    borrow::Cow,
    env::current_exe,
    path::{Path, PathBuf},
    process::Command as StdCommand,
    time::Duration,
};
use tokio::sync::Mutex;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ServiceStatus {
    Ready,
    NeedsReinstall,
    InstallRequired,
    UninstallRequired,
    ReinstallRequired,
    ForceReinstallRequired,
    Unavailable(String),
}

#[derive(Clone)]
pub struct ServiceManager(ServiceStatus);

#[cfg(any(target_os = "windows", test))]
const WINDOWS_SERVICE_NAME: &str = "clash_verge_service";
#[cfg(any(target_os = "windows", test))]
const WINDOWS_SERVICE_DISPLAY_NAME: &str = "PewPew Background Service";
#[cfg(any(target_os = "windows", test))]
const WINDOWS_SERVICE_DESCRIPTION: &str = "PewPew Background Service helps to launch the connection core";

#[cfg(target_os = "windows")]
pub fn ensure_service_owned() -> Result<()> {
    use winreg::{
        RegKey,
        enums::{HKEY_LOCAL_MACHINE, KEY_READ, KEY_WOW64_64KEY},
    };

    let root = RegKey::predef(HKEY_LOCAL_MACHINE);
    let key = match root.open_subkey_with_flags(
        format!(r"SYSTEM\CurrentControlSet\Services\{WINDOWS_SERVICE_NAME}"),
        KEY_READ | KEY_WOW64_64KEY,
    ) {
        Ok(key) => key,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(error.into()),
    };
    let image_path: String = key.get_value("ImagePath")?;
    let expected = dirs::service_path()?;
    if !service_path_matches(&image_path, &expected.to_string_lossy()) {
        bail!("pewpew-service-conflict");
    }
    Ok(())
}

#[cfg(any(target_os = "windows", test))]
fn service_path_matches(actual: &str, expected: &str) -> bool {
    actual.trim().trim_matches('"').eq_ignore_ascii_case(expected)
}

pub async fn prepare_enhanced_connection() -> Result<()> {
    use crate::core::{CoreManager, handle::Handle, manager::RunningMode};

    #[cfg(target_os = "windows")]
    ensure_service_owned()?;

    let core = CoreManager::global();
    if tauri_plugin_clash_verge_sysinfo::is_current_app_handle_admin(Handle::app_handle())
        && matches!(*core.get_running_mode(), RunningMode::Sidecar)
    {
        return Ok(());
    }
    let status = if is_service_available().await.is_err() {
        ServiceStatus::InstallRequired
    } else {
        ServiceStatus::Ready
    };
    SERVICE_MANAGER.lock().await.handle_service_status(&status).await?;
    if !matches!(*core.get_running_mode(), RunningMode::Service) {
        core.restart_core().await?;
    }
    if !matches!(*core.get_running_mode(), RunningMode::Service) {
        bail!("pewpew-service-unavailable");
    }
    Ok(())
}

#[cfg(target_os = "windows")]
fn apply_service_branding_privileged() -> Result<()> {
    use std::os::windows::process::CommandExt as _;

    let sc = windows_system_dir()?.join("sc.exe");
    let status = StdCommand::new(&sc)
        .args([
            "config",
            WINDOWS_SERVICE_NAME,
            "DisplayName=",
            WINDOWS_SERVICE_DISPLAY_NAME,
        ])
        .creation_flags(0x08000000)
        .status()?;
    if !status.success() {
        bail!(
            "failed to update service display name with status {}",
            status.code().unwrap_or(-1)
        );
    }

    let status = StdCommand::new(&sc)
        .args(["description", WINDOWS_SERVICE_NAME, WINDOWS_SERVICE_DESCRIPTION])
        .creation_flags(0x08000000)
        .status()?;
    if !status.success() {
        bail!(
            "failed to update service description with status {}",
            status.code().unwrap_or(-1)
        );
    }

    Ok(())
}

#[cfg(target_os = "windows")]
fn uninstall_service() -> Result<()> {
    logging!(info, Type::Service, "uninstall service");

    use deelevate::{PrivilegeLevel, Token};
    use runas::Command as RunasCommand;
    use std::os::windows::process::CommandExt as _;

    let binary_path = dirs::service_path()?;
    let uninstall_path = binary_path.with_file_name("clash-verge-service-uninstall.exe");

    if !uninstall_path.exists() {
        bail!(format!("uninstaller not found: {uninstall_path:?}"));
    }

    let token = Token::with_current_process()?;
    let level = token.privilege_level()?;
    let status = match level {
        PrivilegeLevel::NotPrivileged => RunasCommand::new(uninstall_path).show(false).status()?,
        _ => StdCommand::new(uninstall_path).creation_flags(0x08000000).status()?,
    };

    if !status.success() {
        bail!(
            "failed to uninstall service with status {}",
            status.code().unwrap_or(-1)
        );
    }

    Ok(())
}

#[cfg(target_os = "windows")]
fn install_service() -> Result<()> {
    logging!(info, Type::Service, "install service");

    use deelevate::{PrivilegeLevel, Token};
    use std::os::windows::process::CommandExt as _;

    let binary_path = dirs::service_path()?;
    let install_path = binary_path.with_file_name("clash-verge-service-install.exe");

    if !install_path.exists() {
        bail!("pewpew-service-install-failed: installer not found: {install_path:?}");
    }

    let token = Token::with_current_process()?;
    if matches!(token.privilege_level()?, PrivilegeLevel::NotPrivileged) {
        return install_service_elevated(&install_path);
    }

    let output = StdCommand::new(&install_path)
        .creation_flags(0x08000000)
        .output()
        .map_err(|error| anyhow!("pewpew-service-install-failed: cannot start installer: {error}"))?;
    if let Some((code, err)) = check_output_error(&output) {
        logging!(
            error,
            Type::Service,
            "failed to install service code: {}, details: {}",
            code,
            err
        );
        bail!("pewpew-service-install-failed (code {code}): {err}");
    }
    apply_service_branding_privileged().context("pewpew-service-install-failed: cannot set service name")?;

    Ok(())
}

/// Installs the service behind a single UAC prompt and gives it the PewPew name.
///
/// The `runas` crate escapes quotes as `\"`, which `cmd.exe` does not understand,
/// so the elevated shell could never find the installer. The command line is
/// therefore handed to `ShellExecuteExW` exactly as `cmd.exe` expects it.
#[cfg(target_os = "windows")]
fn install_service_elevated(install_path: &Path) -> Result<()> {
    use windows::core::HSTRING;

    let system_dir = windows_system_dir()?;
    let log_path = dirs::app_logs_dir()?.join("service-install.log");
    if let Some(parent) = log_path.parent() {
        std::fs::create_dir_all(parent).context("pewpew-service-install-failed: cannot prepare log directory")?;
    }
    std::fs::File::create(&log_path).context("pewpew-service-install-failed: cannot write install log")?;

    let code = match elevated_install_parameters(install_path, &system_dir.join("sc.exe"), &log_path) {
        Some(parameters) => run_elevated(
            &HSTRING::from(system_dir.join("cmd.exe").as_os_str()),
            &HSTRING::from(parameters.as_str()),
        )?,
        // A path cmd.exe cannot quote safely: install without renaming; the
        // next client update gives the service its PewPew name.
        None => run_elevated(&HSTRING::from(install_path.as_os_str()), &HSTRING::new())?,
    };
    if code == 0 {
        return Ok(());
    }

    let details = std::fs::read(&log_path)
        .map(|bytes| decode_console_output(&bytes))
        .unwrap_or_default();
    let details: String = details.trim().chars().take(600).collect();
    logging!(
        error,
        Type::Service,
        "failed to install service code: {}, details: {}",
        code,
        details
    );
    if details.is_empty() {
        bail!("pewpew-service-install-failed (code {code})");
    }
    bail!("pewpew-service-install-failed (code {code}): {details}");
}

/// Builds the `cmd.exe` arguments for [`install_service_elevated`].
///
/// `/S /C "..."` makes cmd strip only the outer quotes, so every path keeps its
/// own quotes. `/D` skips AutoRun commands and `/V:OFF` keeps `!` literal in
/// the elevated shell. All steps write their output to `log` for diagnostics.
/// Returns `None` for paths that cmd.exe would rewrite (`%` is expanded even
/// inside quotes) or that cannot be quoted at all.
#[cfg(any(target_os = "windows", test))]
fn elevated_install_parameters(install: &Path, sc: &Path, log: &Path) -> Option<String> {
    let quoted = |path: &Path| {
        let text = path.to_str()?;
        if text.is_empty() || text.contains(['%', '"', '\r', '\n']) {
            return None;
        }
        Some(format!("\"{text}\""))
    };
    let (install, sc, log) = (quoted(install)?, quoted(sc)?, quoted(log)?);
    Some(format!(
        r#"/D /V:OFF /S /C "({install} && {sc} config {WINDOWS_SERVICE_NAME} DisplayName= "{WINDOWS_SERVICE_DISPLAY_NAME}" && {sc} description {WINDOWS_SERVICE_NAME} "{WINDOWS_SERVICE_DESCRIPTION}") > {log} 2>&1""#
    ))
}

#[cfg(target_os = "windows")]
fn windows_system_dir() -> Result<PathBuf> {
    use windows::Win32::System::SystemInformation::GetSystemDirectoryW;

    let mut buffer = [0u16; 260];
    // SAFETY: the buffer outlives the call and its length is passed with it.
    let len = unsafe { GetSystemDirectoryW(Some(&mut buffer)) } as usize;
    if len == 0 || len >= buffer.len() {
        bail!("failed to locate the Windows system directory");
    }
    Ok(PathBuf::from(String::from_utf16(&buffer[..len])?))
}

/// Runs `file` with administrator rights (one UAC prompt, hidden window) and
/// waits for it, returning its exit code.
#[cfg(target_os = "windows")]
fn run_elevated(file: &windows::core::HSTRING, parameters: &windows::core::HSTRING) -> Result<u32> {
    use windows::{
        Win32::{
            Foundation::{CloseHandle, ERROR_CANCELLED, WAIT_FAILED},
            System::{
                Com::{COINIT_APARTMENTTHREADED, COINIT_DISABLE_OLE1DDE, CoInitializeEx, CoUninitialize},
                Threading::{GetExitCodeProcess, INFINITE, WaitForSingleObject},
            },
            UI::{
                Shell::{SEE_MASK_NOASYNC, SEE_MASK_NOCLOSEPROCESS, SHELLEXECUTEINFOW, ShellExecuteExW},
                WindowsAndMessaging::SW_HIDE,
            },
        },
        core::{PCWSTR, w},
    };

    // A dedicated thread keeps COM initialisation away from runtime workers.
    std::thread::scope(|scope| {
        scope
            .spawn(|| {
                // SAFETY: every pointer handed to the shell outlives the calls,
                // and the process handle is closed exactly once.
                unsafe {
                    let com = CoInitializeEx(None, COINIT_APARTMENTTHREADED | COINIT_DISABLE_OLE1DDE);
                    com.ok()
                        .context("pewpew-service-install-failed: cannot initialize Windows elevation")?;
                    let result = (|| -> Result<u32> {
                        let mut info = SHELLEXECUTEINFOW {
                            cbSize: std::mem::size_of::<SHELLEXECUTEINFOW>() as u32,
                            fMask: SEE_MASK_NOCLOSEPROCESS | SEE_MASK_NOASYNC,
                            lpVerb: w!("runas"),
                            lpFile: PCWSTR(file.as_ptr()),
                            lpParameters: PCWSTR(parameters.as_ptr()),
                            nShow: SW_HIDE.0,
                            ..Default::default()
                        };
                        if let Err(error) = ShellExecuteExW(&mut info) {
                            if error.code() == ERROR_CANCELLED.to_hresult() {
                                bail!("pewpew-service-install-cancelled");
                            }
                            bail!("pewpew-service-install-failed: {error}");
                        }
                        if info.hProcess.is_invalid() {
                            bail!("pewpew-service-install-failed: no process handle");
                        }
                        let waited = WaitForSingleObject(info.hProcess, INFINITE);
                        let mut code = 0u32;
                        let exit = GetExitCodeProcess(info.hProcess, &mut code);
                        let _ = CloseHandle(info.hProcess);
                        if waited == WAIT_FAILED {
                            bail!("pewpew-service-install-failed: could not wait for the installer");
                        }
                        exit.map_err(|error| anyhow!("pewpew-service-install-failed: {error}"))?;
                        Ok(code)
                    })();
                    if com.is_ok() {
                        CoUninitialize();
                    }
                    result
                }
            })
            .join()
            .map_err(|_| anyhow!("pewpew-service-install-failed: elevation thread panicked"))?
    })
}

/// Console programs write UTF-8 (Rust) or the OEM code page (cmd.exe).
#[cfg(target_os = "windows")]
fn decode_console_output(bytes: &[u8]) -> String {
    use windows::Win32::Globalization::{CP_OEMCP, MULTI_BYTE_TO_WIDE_CHAR_FLAGS, MultiByteToWideChar};

    if let Ok(text) = std::str::from_utf8(bytes) {
        return text.to_owned();
    }
    // SAFETY: both slices are valid for the duration of the calls.
    unsafe {
        let len = MultiByteToWideChar(CP_OEMCP, MULTI_BYTE_TO_WIDE_CHAR_FLAGS(0), bytes, None);
        if len <= 0 {
            return String::from_utf8_lossy(bytes).into_owned();
        }
        let mut wide = vec![0u16; len as usize];
        let written = MultiByteToWideChar(CP_OEMCP, MULTI_BYTE_TO_WIDE_CHAR_FLAGS(0), bytes, Some(&mut wide));
        String::from_utf16_lossy(&wide[..written.max(0) as usize])
    }
}

#[cfg(target_os = "linux")]
fn uninstall_service() -> Result<()> {
    logging!(info, Type::Service, "uninstall service");

    let uninstall_path = tauri::utils::platform::current_exe()?.with_file_name("clash-verge-service-uninstall");

    if !uninstall_path.exists() {
        bail!(format!("uninstaller not found: {uninstall_path:?}"));
    }

    let uninstall_shell: String = uninstall_path.to_string_lossy().replace(" ", "\\ ");

    let elevator = crate::utils::help::linux_elevator();
    let status = if linux_running_as_root() {
        StdCommand::new(&uninstall_path).status()?
    } else {
        let result = StdCommand::new(&elevator)
            .arg("sh")
            .arg("-c")
            .arg(&uninstall_shell)
            .status()?;

        // 如果 pkexec 执行失败，回退到 sudo
        if !result.success() && elevator.contains("pkexec") {
            logging!(
                warn,
                Type::Service,
                "pkexec failed with code {}, falling back to sudo",
                result.code().unwrap_or(-1)
            );
            StdCommand::new("sudo")
                .arg("sh")
                .arg("-c")
                .arg(&uninstall_shell)
                .status()?
        } else {
            result
        }
    };
    logging!(
        info,
        Type::Service,
        "uninstall status code:{}",
        status.code().unwrap_or(-1)
    );

    if !status.success() {
        bail!(
            "failed to uninstall service with status {}",
            status.code().unwrap_or(-1)
        );
    }

    Ok(())
}

#[cfg(target_os = "linux")]
fn install_service() -> Result<()> {
    logging!(info, Type::Service, "install service");

    let install_path = tauri::utils::platform::current_exe()?.with_file_name("clash-verge-service-install");

    if !install_path.exists() {
        bail!(format!("installer not found: {install_path:?}"));
    }

    let install_shell: String = install_path.to_string_lossy().replace(" ", "\\ ");

    let elevator = crate::utils::help::linux_elevator();
    let output = if linux_running_as_root() {
        StdCommand::new(&install_path).output()?
    } else {
        let result = StdCommand::new(&elevator)
            .arg("sh")
            .arg("-c")
            .arg(&install_shell)
            .output()?;

        // 如果 pkexec 执行失败，回退到 sudo
        if !result.status.success() && elevator.contains("pkexec") {
            logging!(
                warn,
                Type::Service,
                "pkexec failed with code {}, falling back to sudo",
                result.status.code().unwrap_or(-1)
            );
            StdCommand::new("sudo")
                .arg("sh")
                .arg("-c")
                .arg(&install_shell)
                .output()?
        } else {
            result
        }
    };

    if let Some((code, err)) = check_output_error(&output) {
        logging!(
            error,
            Type::Service,
            "failed to install service code: {}, details: {}",
            code,
            err
        );
        bail!("failed to install service code: {}, details: {}", code, err);
    }

    Ok(())
}

#[cfg(target_os = "linux")]
fn linux_running_as_root() -> bool {
    use crate::core::handle;
    use tauri_plugin_clash_verge_sysinfo::is_current_app_handle_admin;
    let app_handle = handle::Handle::app_handle();
    is_current_app_handle_admin(app_handle)
}

#[cfg(target_os = "macos")]
fn uninstall_service() -> Result<()> {
    logging!(info, Type::Service, "uninstall service");

    let binary_path = dirs::service_path()?;
    let uninstall_path = binary_path.with_file_name("clash-verge-service-uninstall");

    if !uninstall_path.exists() {
        bail!(format!("uninstaller not found: {uninstall_path:?}"));
    }

    let prompt = clash_verge_i18n::t!("service.adminUninstallPrompt");
    let command = macos_service_admin_script(&uninstall_path.to_string_lossy(), None, &prompt);

    // logging!(debug, Type::Service, "uninstall command: {}", command);

    let status = StdCommand::new("osascript").args(vec!["-e", &command]).status()?;

    if !status.success() {
        bail!(
            "failed to uninstall service with status {}",
            status.code().unwrap_or(-1)
        );
    }

    Ok(())
}

#[cfg(target_os = "macos")]
fn install_service() -> Result<()> {
    logging!(info, Type::Service, "install service");

    let binary_path = dirs::service_path()?;
    let install_path = binary_path.with_file_name("clash-verge-service-install");

    if !install_path.exists() {
        bail!(format!("installer not found: {install_path:?}"));
    }

    let gid = tauri_plugin_clash_verge_sysinfo::current_gid();
    let prompt = clash_verge_i18n::t!("service.adminInstallPrompt");
    let command = macos_service_admin_script(&install_path.to_string_lossy(), Some(gid), &prompt);

    let output = StdCommand::new("osascript").args(vec!["-e", &command]).output()?;
    if let Some((code, err)) = check_output_error(&output) {
        logging!(
            error,
            Type::Service,
            "failed to install service code: {}, details: {}",
            code,
            err
        );
        bail!("failed to install service code: {}, details: {}", code, err);
    }

    Ok(())
}

#[cfg(any(target_os = "macos", test))]
fn macos_service_admin_script(path: &str, gid: Option<u32>, prompt: &str) -> String {
    let quoted_path = format!("'{}'", path.replace('\'', r"'\''"));
    let shell = match gid {
        Some(gid) => format!("cd /; env CLASH_VERGE_SERVICE_GID={gid} {quoted_path}"),
        None => format!("cd /; {quoted_path}"),
    };
    let escape = |value: &str| value.replace('\\', "\\\\").replace('"', "\\\"");
    format!(
        r#"do shell script "{}" with administrator privileges with prompt "{}""#,
        escape(&shell),
        escape(prompt)
    )
}

fn check_output_error(output: &std::process::Output) -> Option<(i32, Cow<'_, str>)> {
    if output.status.success() {
        return None;
    }
    let code = output.status.code().unwrap_or(-1);
    let stderr = String::from_utf8_lossy(&output.stderr);
    if !stderr.is_empty() {
        return Some((code, stderr));
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    if !stdout.is_empty() {
        return Some((code, stdout));
    }
    Some((code, Cow::Borrowed("Unknown error")))
}

fn reinstall_service() -> Result<()> {
    logging!(info, Type::Service, "reinstall service");

    // 先卸载服务
    if let Err(err) = uninstall_service() {
        logging!(warn, Type::Service, "failed to uninstall service: {}", err);
    }

    // 再安装服务
    match install_service() {
        Ok(_) => Ok(()),
        Err(err) => {
            bail!(format!("failed to install service: {err}"))
        }
    }
}

/// 强制重装服务（UI修复按钮）
fn force_reinstall_service() -> Result<()> {
    logging!(info, Type::Service, "用户请求强制重装服务");
    reinstall_service().map_err(|err| {
        logging!(error, Type::Service, "强制重装服务失败: {}", err);
        err
    })
}

/// 尝试使用服务启动core
pub(super) async fn start_with_existing_service(config_file: &PathBuf) -> Result<()> {
    logging!(info, Type::Service, "尝试使用现有服务启动核心");

    let verge_config = Config::verge().await;
    let clash_core = verge_config.latest_arc().get_valid_clash_core();
    drop(verge_config);

    let bin_ext = if cfg!(windows) { ".exe" } else { "" };
    let bin_path = current_exe()?.with_file_name(format!("{clash_core}{bin_ext}"));

    let payload = clash_verge_service_ipc::ClashConfig {
        core_config: CoreConfig {
            config_path: dirs::path_to_str(config_file)?.into(),
            core_path: dirs::path_to_str(&bin_path)?.into(),
            core_ipc_path: IClashTemp::guard_external_controller_ipc(),
            config_dir: dirs::path_to_str(&dirs::app_home_dir()?)?.into(),
        },
        log_config: Logger::global().service_writer_config()?,
    };

    let response = clash_verge_service_ipc::start_clash(&payload)
        .await
        .context("后台服务启动失败，请重启客户端或联系客服")?;

    if response.code > 0 {
        let err_msg = response.message;
        logging!(error, Type::Service, "启动核心失败: {}", err_msg);
        bail!(err_msg);
    }

    logging!(info, Type::Service, "服务成功启动核心");
    Ok(())
}

// 以服务启动core
pub(super) async fn run_core_by_service(config_file: &PathBuf) -> Result<()> {
    logging!(info, Type::Service, "正在尝试通过服务启动核心");

    SERVICE_MANAGER.lock().await.refresh().await?;

    logging!(info, Type::Service, "服务已运行且版本匹配，直接使用");
    start_with_existing_service(config_file).await
}

pub(super) async fn get_clash_logs_by_service() -> Result<Vec<CompactString>> {
    logging!(info, Type::Service, "正在获取服务模式下的连接核心日志");

    let response = clash_verge_service_ipc::get_clash_logs()
        .await
        .context("无法连接到 PewPew 后台服务")?;

    if response.code > 0 {
        let err_msg = response.message;
        logging!(error, Type::Service, "获取服务模式下的连接核心日志失败: {}", err_msg);
        bail!(err_msg);
    }

    logging!(info, Type::Service, "成功获取服务模式下的连接核心日志");
    Ok(response.data.unwrap_or_default())
}

/// 通过服务停止core
pub(super) async fn stop_core_by_service() -> Result<()> {
    logging!(info, Type::Service, "通过服务停止核心 (IPC)");

    let response = clash_verge_service_ipc::stop_clash()
        .await
        .context("无法连接到 PewPew 后台服务")?;

    if response.code > 0 {
        let err_msg = response.message;
        logging!(error, Type::Service, "停止核心失败: {}", err_msg);
        bail!(err_msg);
    }

    logging!(info, Type::Service, "服务成功停止核心");
    Ok(())
}

/// 检查服务是否正在运行
pub async fn is_service_available() -> Result<()> {
    if let Err(e) = Path::metadata(clash_verge_service_ipc::IPC_PATH.as_ref()) {
        let verge = Config::verge().await;
        let verge_last = verge.latest_arc();
        let is_enable = verge_last.enable_tun_mode.unwrap_or(false);
        if is_enable {
            logging!(warn, Type::Service, "Some issue with service IPC Path: {}", e);
        }
        return Err(e.into());
    }
    clash_verge_service_ipc::connect().await?;
    Ok(())
}

pub async fn wait_and_check_service_available(status: &mut ServiceManager) -> Result<()> {
    wait_for_service_ipc(status, "Waiting for service to be available").await
}

async fn wait_and_check_service_version(status: &mut ServiceManager) -> Result<()> {
    wait_and_check_service_available(status).await?;

    if clash_verge_service_ipc::is_reinstall_service_needed().await {
        logging!(info, Type::Service, "服务版本不匹配，执行重装流程");
        reinstall_service()?;
        wait_and_check_service_available(status).await?;
    }

    Ok(())
}

async fn wait_for_service_ipc(status: &mut ServiceManager, reason: &str) -> Result<()> {
    status.0 = ServiceStatus::Unavailable(reason.into());
    let config = ServiceManager::config();

    let backoff = ConstantBuilder::default()
        .with_delay(config.retry_delay)
        .with_max_times(config.max_retries);

    let result = (|| async {
        if Path::new(clash_verge_service_ipc::IPC_PATH).exists() {
            clash_verge_service_ipc::connect().await?;
            Ok(())
        } else {
            Err(anyhow!("IPC path not ready"))
        }
    })
    .retry(backoff)
    .await;

    if result.is_ok() {
        status.0 = ServiceStatus::Ready;
    }

    result
}

pub fn is_service_ipc_path_exists() -> bool {
    Path::new(clash_verge_service_ipc::IPC_PATH).exists()
}

impl ServiceManager {
    pub fn default() -> Self {
        Self(ServiceStatus::Unavailable("Need Checks".into()))
    }

    pub const fn config() -> clash_verge_service_ipc::IpcConfig {
        clash_verge_service_ipc::IpcConfig {
            default_timeout: Duration::from_millis(150),
            retry_delay: Duration::from_millis(250),
            max_retries: 20,
        }
    }

    pub async fn init(&mut self) -> Result<()> {
        if let Err(e) = clash_verge_service_ipc::connect().await {
            self.0 = ServiceStatus::Unavailable("服务连接失败: {e}".to_string());
            return Err(e);
        }
        Ok(())
    }

    pub fn current(&self) -> ServiceStatus {
        self.0.clone()
    }

    pub async fn refresh(&mut self) -> Result<()> {
        let status = self.check_service_comprehensive().await;
        self.0 = status.clone();
        logging_error!(Type::Service, self.handle_service_status(&status).await);
        Ok(())
    }

    /// 综合服务状态检查（一次性完成所有检查）
    pub async fn check_service_comprehensive(&self) -> ServiceStatus {
        if clash_verge_service_ipc::is_reinstall_service_needed().await {
            ServiceStatus::NeedsReinstall
        } else {
            ServiceStatus::Ready
        }
    }

    /// 根据服务状态执行相应操作
    pub async fn handle_service_status(&mut self, status: &ServiceStatus) -> Result<()> {
        match status {
            ServiceStatus::Ready => {
                logging!(info, Type::Service, "服务就绪，直接启动");
                self.0 = ServiceStatus::Ready;
            }
            ServiceStatus::NeedsReinstall | ServiceStatus::ReinstallRequired => {
                logging!(info, Type::Service, "服务需要重装，执行重装流程");
                reinstall_service()?;
                wait_and_check_service_available(self).await?;
            }
            ServiceStatus::ForceReinstallRequired => {
                logging!(info, Type::Service, "服务需要强制重装，执行强制重装流程");
                force_reinstall_service()?;
                wait_and_check_service_available(self).await?;
            }
            ServiceStatus::InstallRequired => {
                logging!(info, Type::Service, "需要安装服务，执行安装流程");
                install_service()?;
                wait_and_check_service_version(self).await?;
            }
            ServiceStatus::UninstallRequired => {
                logging!(info, Type::Service, "服务需要卸载，执行卸载流程");
                uninstall_service()?;
                self.0 = ServiceStatus::Unavailable("Service Uninstalled".into());
            }
            ServiceStatus::Unavailable(reason) => {
                logging!(info, Type::Service, "服务不可用: {}，将使用Sidecar模式", reason);
                self.0 = ServiceStatus::Unavailable(reason.clone());
                return Err(anyhow::anyhow!("服务不可用: {}", reason));
            }
        }

        // 防止服务安装成功后，内核未完全启动导致系统托盘无法获取代理节点信息
        Tray::global().update_menu().await?;
        Ok(())
    }
}

pub static SERVICE_MANAGER: Lazy<Mutex<ServiceManager>> = Lazy::new(|| Mutex::new(ServiceManager::default()));

#[cfg(test)]
mod tests {
    use super::{elevated_install_parameters, macos_service_admin_script, service_path_matches};
    use std::path::Path;

    #[test]
    fn elevated_install_command_is_quoted_the_way_cmd_reads_it() -> anyhow::Result<()> {
        let parameters = elevated_install_parameters(
            Path::new(r"C:\Program Files\PewPew 云客户端\resources\clash-verge-service-install.exe"),
            Path::new(r"C:\WINDOWS\system32\sc.exe"),
            Path::new(r"C:\Users\A B\AppData\Roaming\com.pewpewcloud.client\logs\service-install.log"),
        )
        .ok_or_else(|| anyhow::anyhow!("ordinary paths must be accepted"))?;

        // Backslash-escaped quotes are what broke the old `runas` version.
        assert!(!parameters.contains(r#"\""#));
        // `cmd /S /C` removes only the first and the last quote.
        let command = parameters
            .strip_prefix(r#"/D /V:OFF /S /C ""#)
            .and_then(|rest| rest.strip_suffix('"'))
            .ok_or_else(|| anyhow::anyhow!("the command must be wrapped in one pair of quotes"))?;
        assert_eq!(
            command,
            concat!(
                r#"("C:\Program Files\PewPew 云客户端\resources\clash-verge-service-install.exe""#,
                r#" && "C:\WINDOWS\system32\sc.exe" config clash_verge_service DisplayName= "PewPew Background Service""#,
                r#" && "C:\WINDOWS\system32\sc.exe" description clash_verge_service"#,
                r#" "PewPew Background Service helps to launch the connection core")"#,
                r#" > "C:\Users\A B\AppData\Roaming\com.pewpewcloud.client\logs\service-install.log" 2>&1"#,
            )
        );
        Ok(())
    }

    #[test]
    fn elevated_install_command_rejects_paths_cmd_would_rewrite() {
        let sc = Path::new(r"C:\WINDOWS\system32\sc.exe");
        let log = Path::new(r"C:\logs\service-install.log");
        for install in [r"C:\100%PATH%\install.exe", "C:\\bad\"quote\\install.exe", ""] {
            assert_eq!(
                elevated_install_parameters(Path::new(install), sc, log),
                None,
                "{install}"
            );
        }
        let install = Path::new(r"C:\client\install.exe");
        assert_eq!(
            elevated_install_parameters(install, Path::new(r"C:\%PATH%\sc.exe"), log),
            None
        );
        assert_eq!(
            elevated_install_parameters(install, sc, Path::new(r"C:\%USER%\install.log")),
            None
        );
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn elevated_command_runs_in_windows_and_keeps_all_failure_output() -> anyhow::Result<()> {
        use std::os::windows::process::CommandExt as _;

        let root = std::env::temp_dir().join(format!("PewPew cmd 中文 & (test)! {}", nanoid::nanoid!()));
        std::fs::create_dir(&root)?;
        let result = (|| -> anyhow::Result<()> {
            let install = root.join("install.cmd");
            let sc = root.join("service-control.cmd");
            let log = root.join("install.log");
            let run = || -> anyhow::Result<std::process::Output> {
                let parameters = elevated_install_parameters(&install, &sc, &log)
                    .ok_or_else(|| anyhow::anyhow!("test paths must be accepted"))?;
                Ok(std::process::Command::new(super::windows_system_dir()?.join("cmd.exe"))
                    .raw_arg(parameters)
                    .creation_flags(0x08000000)
                    .output()?)
            };
            std::fs::write(
                &install,
                b"@echo off\r\necho INSTALL_OUT\r\necho INSTALL_ERR 1>&2\r\nexit /b 0\r\n",
            )?;
            std::fs::write(&sc, b"@echo off\r\necho SC_%1\r\nexit /b 0\r\n")?;
            assert!(run()?.status.success());
            let output = std::fs::read_to_string(&log)?;
            for expected in ["INSTALL_OUT", "INSTALL_ERR", "SC_config", "SC_description"] {
                assert!(output.contains(expected), "missing {expected}: {output}");
            }

            std::fs::write(&install, b"@echo off\r\necho INSTALL_DENIED 1>&2\r\nexit /b 7\r\n")?;
            assert_eq!(run()?.status.code(), Some(7));
            let output = std::fs::read_to_string(&log)?;
            assert!(output.contains("INSTALL_DENIED"));
            assert!(!output.contains("SC_"));

            std::fs::write(&install, b"@echo off\r\nexit /b 0\r\n")?;
            std::fs::write(&sc, b"@echo off\r\necho SERVICE_NAME_DENIED 1>&2\r\nexit /b 5\r\n")?;
            assert_eq!(run()?.status.code(), Some(5));
            assert!(std::fs::read_to_string(&log)?.contains("SERVICE_NAME_DENIED"));
            Ok(())
        })();
        std::fs::remove_dir_all(&root)?;
        result
    }

    #[test]
    fn service_ownership_rejects_another_installation() {
        let expected = r"C:\PewPew Cloud\resources\clash-verge-service.exe";
        assert!(service_path_matches(&format!("\"{expected}\""), expected));
        assert!(service_path_matches(&expected.to_lowercase(), expected));
        assert!(!service_path_matches(
            r"C:\Other Client\resources\clash-verge-service.exe",
            expected
        ));
        assert!(!service_path_matches(&format!("{expected} --other"), expected));
    }

    #[test]
    fn macos_service_paths_and_prompts_are_quoted() {
        let result = macos_service_admin_script(
            "/Applications/PewPew's \"Cloud\"/helper",
            Some(501),
            "PewPew \"Service\"",
        );
        assert_eq!(
            result,
            r#"do shell script "cd /; env CLASH_VERGE_SERVICE_GID=501 '/Applications/PewPew'\\''s \"Cloud\"/helper'" with administrator privileges with prompt "PewPew \"Service\"""#
        );
    }

    #[test]
    fn macos_uninstall_does_not_require_nested_sudo() {
        let result = macos_service_admin_script("/Applications/PewPew Cloud/helper", None, "PewPew Background Service");
        assert_eq!(
            result,
            r#"do shell script "cd /; '/Applications/PewPew Cloud/helper'" with administrator privileges with prompt "PewPew Background Service""#
        );
    }
}
