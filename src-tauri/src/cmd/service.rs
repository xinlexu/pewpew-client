use super::{CmdResult, StringifyErr as _};
use crate::core::service::{self, SERVICE_MANAGER, ServiceStatus};
use smartstring::SmartString;

#[tauri::command]
pub async fn prepare_enhanced_connection() -> CmdResult {
    service::prepare_enhanced_connection().await.stringify_err()
}

async fn execute_service_operation_sync(status: ServiceStatus, op_type: &str) -> CmdResult {
    if let Err(e) = SERVICE_MANAGER.lock().await.handle_service_status(&status).await {
        let emsg = format!("{} Service failed: {}", op_type, e);
        return Err(SmartString::from(emsg));
    }
    Ok(())
}

#[tauri::command]
pub async fn install_service() -> CmdResult {
    execute_service_operation_sync(ServiceStatus::InstallRequired, "Install").await
}

#[tauri::command]
pub async fn uninstall_service() -> CmdResult {
    execute_service_operation_sync(ServiceStatus::UninstallRequired, "Uninstall").await
}

#[tauri::command]
pub async fn reinstall_service() -> CmdResult {
    execute_service_operation_sync(ServiceStatus::ReinstallRequired, "Reinstall").await
}

#[tauri::command]
pub async fn repair_service() -> CmdResult {
    execute_service_operation_sync(ServiceStatus::ForceReinstallRequired, "Repair").await
}

#[tauri::command]
pub async fn is_service_available() -> CmdResult<bool> {
    #[cfg(target_os = "windows")]
    service::ensure_service_owned().stringify_err()?;
    service::is_service_available().await.stringify_err()?;
    Ok(true)
}
