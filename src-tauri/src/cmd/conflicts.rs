//! Finds other proxy clients that compete with PewPew for the system proxy,
//! the virtual network adapter or the local proxy port.

use crate::constants::network::ports;
use serde::Serialize;
use std::net::TcpListener;
use std::path::{Path, PathBuf};

#[derive(Debug, Default, Clone, Serialize, PartialEq, Eq)]
pub struct ProxyConflicts {
    /// Names of other running proxy clients, for display.
    pub apps: Vec<String>,
}

/// Lists other proxy clients that are running right now.
#[tauri::command]
pub async fn detect_proxy_conflicts() -> ProxyConflicts {
    let apps = tokio::task::spawn_blocking(running_proxy_apps)
        .await
        .unwrap_or_default();
    ProxyConflicts { apps }
}

/// Returns a free local port for the proxy, or `None` when every candidate is taken.
#[tauri::command]
pub fn find_free_proxy_port(busy: u16) -> Option<u16> {
    free_port_candidates(busy).find(|port| TcpListener::bind(("127.0.0.1", *port)).is_ok())
}

/// PewPew's own range first, then a higher range that other clients do not use.
fn free_port_candidates(busy: u16) -> impl Iterator<Item = u16> {
    std::iter::once(ports::DEFAULT_MIXED)
        .chain(ports::DEFAULT_HTTP + 1..=7999)
        .chain(17966..=17999)
        .filter(move |port| *port != busy)
}

/// Other proxy clients, by executable name in lower case.
const PROXY_APPS: &[(&str, &str)] = &[
    ("clash-verge.exe", "Clash Verge"),
    ("clash verge.exe", "Clash Verge"),
    ("clash-nyanpasu.exe", "Clash Nyanpasu"),
    ("clash for windows.exe", "Clash for Windows"),
    ("clash-win64.exe", "Clash for Windows"),
    ("mihomo-party.exe", "Mihomo Party"),
    ("sparkle.exe", "Sparkle"),
    ("flclash.exe", "FlClash"),
    ("flclashcore.exe", "FlClash"),
    ("gui.for.clash.exe", "GUI.for.Clash"),
    ("v2rayn.exe", "v2rayN"),
    ("hiddify.exe", "Hiddify"),
    ("nekoray.exe", "NekoRay"),
    ("nekobox.exe", "NekoBox"),
    ("karing.exe", "Karing"),
    ("shadowsocks.exe", "Shadowsocks"),
    ("shadowsocksr.exe", "ShadowsocksR"),
    ("clashx", "ClashX"),
    ("clashx pro", "ClashX Pro"),
    ("surge", "Surge"),
];

/// Core names PewPew ships too. They only count when they run from another folder,
/// for example Clash Verge's core started by its background service.
const SHARED_CORES: &[(&str, &str)] = &[
    ("verge-mihomo.exe", "Clash Verge"),
    ("verge-mihomo-alpha.exe", "Clash Verge"),
];

/// Cores other clients start. Reported only when no client itself was found.
const OTHER_CORES: &[&str] = &[
    "mihomo.exe",
    "mihomo-alpha.exe",
    "clash-meta.exe",
    "clash.exe",
    "sing-box.exe",
    "xray.exe",
];

#[derive(Debug, PartialEq, Eq)]
enum Detected {
    App(&'static str),
    Core(&'static str),
}

fn is_shared_core(name: &str) -> bool {
    SHARED_CORES.iter().any(|(core, _)| *core == name)
}

/// Classifies one process. `name` is the lower-case executable name.
fn classify(name: &str, path: Option<&Path>, own_dir: Option<&Path>) -> Option<Detected> {
    if let Some(&(_, app)) = PROXY_APPS
        .iter()
        .find(|&&(exe, _)| exe.trim_end_matches(".exe") == name.trim_end_matches(".exe"))
    {
        return Some(Detected::App(app));
    }
    if let Some(&(_, app)) = SHARED_CORES.iter().find(|&&(exe, _)| exe == name) {
        // Without a readable path the core may be PewPew's own; stay quiet.
        let exe = windows_path_key(path?);
        let (dir, _) = exe.rsplit_once('\\')?;
        return match own_dir {
            Some(own) if windows_path_key(own) == dir => None,
            _ => Some(Detected::App(app)),
        };
    }
    OTHER_CORES
        .iter()
        .copied()
        .find(|core| *core == name)
        .map(Detected::Core)
}

/// Comparable form of a Windows path: plain prefix, backslashes, lower case,
/// no trailing separator. Works the same on every host so it can be tested.
fn windows_path_key(path: &Path) -> String {
    let text = path.to_string_lossy().replace('/', "\\");
    let text = text.strip_prefix(r"\\?\").unwrap_or(&text);
    text.trim_end_matches('\\').to_lowercase()
}

fn summarize(found: impl IntoIterator<Item = Detected>) -> Vec<String> {
    let mut apps: Vec<String> = Vec::new();
    let mut cores: Vec<String> = Vec::new();
    for item in found {
        let (list, name) = match item {
            Detected::App(name) => (&mut apps, name),
            Detected::Core(name) => (&mut cores, name),
        };
        if !list.iter().any(|known| known == name) {
            list.push(name.to_owned());
        }
    }
    if apps.is_empty() { cores } else { apps }
}

fn running_proxy_apps() -> Vec<String> {
    let own_dir: Option<PathBuf> = std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(Path::to_path_buf));
    let found = processes().into_iter().filter_map(|(pid, name)| {
        let name = name.to_lowercase();
        let path = if is_shared_core(&name) { image_path(pid) } else { None };
        classify(&name, path.as_deref(), own_dir.as_deref())
    });
    summarize(found)
}

#[cfg(windows)]
fn processes() -> Vec<(u32, String)> {
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, PROCESSENTRY32W, Process32FirstW, Process32NextW, TH32CS_SNAPPROCESS,
    };

    let mut list = Vec::new();
    // SAFETY: the entry carries the size the API expects, and the snapshot
    // handle is closed before returning.
    unsafe {
        let Ok(snapshot) = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) else {
            return list;
        };
        let mut entry = PROCESSENTRY32W {
            dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32,
            ..Default::default()
        };
        let mut more = Process32FirstW(snapshot, &mut entry).is_ok();
        while more {
            let len = entry
                .szExeFile
                .iter()
                .position(|&c| c == 0)
                .unwrap_or(entry.szExeFile.len());
            list.push((entry.th32ProcessID, String::from_utf16_lossy(&entry.szExeFile[..len])));
            more = Process32NextW(snapshot, &mut entry).is_ok();
        }
        let _ = CloseHandle(snapshot);
    }
    list
}

#[cfg(windows)]
fn image_path(pid: u32) -> Option<PathBuf> {
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::System::Threading::{
        OpenProcess, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION, QueryFullProcessImageNameW,
    };
    use windows::core::PWSTR;

    // SAFETY: the buffer outlives the call, `size` holds its length in UTF-16
    // units, and the process handle is closed before returning.
    unsafe {
        let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
        let mut buffer = [0u16; 1024];
        let mut size = buffer.len() as u32;
        let result = QueryFullProcessImageNameW(handle, PROCESS_NAME_WIN32, PWSTR(buffer.as_mut_ptr()), &mut size);
        let _ = CloseHandle(handle);
        result.ok()?;
        let len = (size as usize).min(buffer.len());
        Some(PathBuf::from(String::from_utf16_lossy(&buffer[..len])))
    }
}

#[cfg(not(windows))]
fn processes() -> Vec<(u32, String)> {
    let mut system = sysinfo::System::new();
    system.refresh_processes_specifics(
        sysinfo::ProcessesToUpdate::All,
        true,
        sysinfo::ProcessRefreshKind::nothing(),
    );
    system
        .processes()
        .iter()
        .map(|(pid, process)| (pid.as_u32(), process.name().to_string_lossy().into_owned()))
        .collect()
}

#[cfg(not(windows))]
const fn image_path(_pid: u32) -> Option<PathBuf> {
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    const OWN: &str = r"C:\Program Files\PewPew 云客户端";

    fn own() -> &'static Path {
        Path::new(OWN)
    }

    #[test]
    fn known_clients_are_reported_by_name() {
        assert_eq!(
            classify("clash-verge.exe", None, Some(own())),
            Some(Detected::App("Clash Verge"))
        );
        assert_eq!(
            classify("clash for windows.exe", None, Some(own())),
            Some(Detected::App("Clash for Windows"))
        );
        assert_eq!(classify("v2rayn.exe", None, Some(own())), Some(Detected::App("v2rayN")));
        assert_eq!(classify("pewpew-client.exe", None, Some(own())), None);
        assert_eq!(classify("explorer.exe", None, Some(own())), None);
        assert_eq!(classify("clash verge", None, None), Some(Detected::App("Clash Verge")));
        assert_eq!(classify("clashx", None, None), Some(Detected::App("ClashX")));
        assert_eq!(classify("surge", None, None), Some(Detected::App("Surge")));
        assert_eq!(classify("pewpew-client", None, None), None);
    }

    #[test]
    fn pewpews_own_core_is_not_a_conflict() {
        let path = PathBuf::from(format!(r"{OWN}\verge-mihomo.exe"));
        assert_eq!(classify("verge-mihomo.exe", Some(&path), Some(own())), None);

        let verbatim = PathBuf::from(format!(r"\\?\{}\VERGE-MIHOMO.EXE", OWN.to_uppercase()));
        assert_eq!(classify("verge-mihomo.exe", Some(&verbatim), Some(own())), None);
    }

    #[test]
    fn clash_verges_core_counts_even_without_its_window() {
        let path = PathBuf::from(r"C:\Program Files\Clash Verge\verge-mihomo.exe");
        assert_eq!(
            classify("verge-mihomo.exe", Some(&path), Some(own())),
            Some(Detected::App("Clash Verge"))
        );
        // An unreadable path may belong to PewPew's own service; say nothing.
        assert_eq!(classify("verge-mihomo.exe", None, Some(own())), None);
    }

    #[test]
    fn bare_cores_show_only_without_a_known_client() {
        assert_eq!(
            summarize([Detected::Core("mihomo.exe"), Detected::Core("mihomo.exe")]),
            vec!["mihomo.exe".to_owned()]
        );
        assert_eq!(
            summarize([
                Detected::Core("mihomo.exe"),
                Detected::App("Sparkle"),
                Detected::App("Sparkle"),
                Detected::App("Clash Verge"),
            ]),
            vec!["Sparkle".to_owned(), "Clash Verge".to_owned()]
        );
        assert!(summarize([]).is_empty());
    }

    #[test]
    fn free_port_search_skips_the_busy_port_and_clash_verge_defaults() {
        let candidates: Vec<u16> = free_port_candidates(ports::DEFAULT_MIXED).collect();
        assert!(!candidates.contains(&ports::DEFAULT_MIXED));
        assert!(!candidates.contains(&ports::DEFAULT_SOCKS));
        assert!(!candidates.contains(&ports::DEFAULT_HTTP));
        assert!(candidates.iter().all(|port| !(7890..=7899).contains(port)));
        assert_eq!(free_port_candidates(7890).next(), Some(ports::DEFAULT_MIXED));
    }
}
