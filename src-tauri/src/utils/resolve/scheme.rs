use anyhow::Result;
use percent_encoding::percent_decode_str;
use smartstring::alias::String;
use tauri::Url;

use crate::{
    config::{PrfItem, profiles},
    core::handle,
    utils::help,
};
use clash_verge_logging::{Type, logging};

pub(super) async fn resolve_scheme(param: &str) -> Result<()> {
    let param_str = if param.starts_with("[") && param.len() > 4 {
        param
            .get(2..param.len() - 2)
            .ok_or_else(|| anyhow::anyhow!("Invalid string slice boundaries"))?
    } else {
        param
    };
    let masked_deep_link = help::mask_url(param_str);

    logging!(debug, Type::Config, "received deep link: {masked_deep_link}");

    let link_parsed = Url::parse(param_str)
        .map_err(|e| anyhow::anyhow!("failed to parse deep link: {e:?}, param: {masked_deep_link}"))?;

    let Some((url, name)) = extract_subscription_info(&link_parsed) else {
        logging!(
            warn,
            Type::Config,
            "missing url parameter in deep link: {masked_deep_link}"
        );
        return Ok(());
    };

    import_subscription(&url, name.as_ref()).await;
    Ok(())
}

fn extract_subscription_info(link_parsed: &Url) -> Option<(std::string::String, Option<String>)> {
    if !matches!(link_parsed.scheme(), "pewpew" | "clash" | "clash-verge") {
        return None;
    }

    let name = link_parsed
        .query_pairs()
        .find(|(key, _)| key == "name")
        .map(|(_, value)| value.into_owned().into());
    let url = extract_subscription_url(link_parsed)?;
    Some((url, name))
}

fn extract_subscription_url(link_parsed: &Url) -> Option<std::string::String> {
    let query = link_parsed.query()?;
    let raw_url = query
        .strip_prefix("url=")
        .or_else(|| query.split_once("&url=").map(|(_, value)| value))?;
    let raw_url = if raw_url.starts_with("https://") || raw_url.starts_with("http://") {
        raw_url.split("&name=").next()?
    } else {
        raw_url.split('&').next()?
    };
    let decoded = decode_subscription_url(raw_url.trim());
    let url = Url::parse(&decoded).ok()?;
    (matches!(url.scheme(), "http" | "https") && url.host_str().is_some()).then_some(decoded)
}

fn decode_subscription_url(raw_url: &str) -> std::string::String {
    // Avoid double-decoding nested subscription URLs; decode only when needed.
    if Url::parse(raw_url).is_ok() {
        return raw_url.to_string();
    }

    let mut candidate = raw_url.to_string();
    for _ in 0..2 {
        let next = percent_decode_str(&candidate).decode_utf8_lossy().to_string();
        if next == candidate {
            break;
        }
        candidate = next;
        if Url::parse(&candidate).is_ok() {
            break;
        }
    }
    candidate
}

async fn import_subscription(url: &str, name: Option<&String>) {
    let Some(mut item) = fetch_profile_item(url, name).await else {
        return;
    };
    let Some(uid) = item.uid.clone() else {
        handle::Handle::notice_message("import_sub_url::error", "Missing profile identifier");
        return;
    };
    if let Err(e) = profiles::profiles_append_item_and_save_safe(&mut item).await {
        logging!(error, Type::Config, "Failed to save imported routes: {e}");
        handle::Handle::notice_message("import_sub_url::error", e.to_string());
        return;
    }

    match crate::cmd::patch_profiles_config_by_profile_index(uid.clone()).await {
        Ok(outcome) if outcome.is_valid() => {
            handle::Handle::notify_profile_changed(&uid);
            handle::Handle::refresh_clash();
            handle::Handle::notice_message("import_sub_url::ok", "");
        }
        Ok(outcome) => handle::Handle::notice_message("import_sub_url::error", outcome.to_string()),
        Err(error) => handle::Handle::notice_message("import_sub_url::error", error),
    }
}

async fn fetch_profile_item(url: &str, name: Option<&String>) -> Option<PrfItem> {
    match PrfItem::from_url(url, name, None, None).await {
        Ok(item) => Some(item),
        Err(e) => {
            logging!(error, Type::Config, "failed to parse profile from url: {:?}", e);
            handle::Handle::notice_message("import_sub_url::error", e.to_string());
            None
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encoded_link_does_not_include_display_name() -> Result<()> {
        let link =
            Url::parse("pewpew://install-config?url=https%3A%2F%2Fexample.test%2Fsub%3Ftoken%3Da%252Bb&name=Demo")?;
        let (url, name) = extract_subscription_info(&link).ok_or_else(|| anyhow::anyhow!("missing url"))?;
        assert_eq!(url, "https://example.test/sub?token=a%2Bb");
        assert_eq!(name.as_deref(), Some("Demo"));
        Ok(())
    }

    #[test]
    fn legacy_link_preserves_subscription_query() -> Result<()> {
        let link = Url::parse("clash://install-config?url=https://example.test/sub?token=a%2Bb&flag=1&name=Demo")?;
        assert_eq!(
            extract_subscription_url(&link).as_deref(),
            Some("https://example.test/sub?token=a%2Bb&flag=1")
        );
        Ok(())
    }

    #[test]
    fn unsupported_and_missing_urls_are_rejected() -> Result<()> {
        for value in [
            "pewpew://install-config?noturl=https://example.test",
            "pewpew://install-config?url=file:///tmp/file",
            "other://install-config?url=https://example.test",
        ] {
            assert!(extract_subscription_info(&Url::parse(value)?).is_none());
        }
        Ok(())
    }
}
