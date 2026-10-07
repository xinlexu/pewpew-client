use serde_yaml_ng::{Mapping, Value};

macro_rules! revise {
    ($map: expr, $key: expr, $val: expr) => {
        let ret_key = Value::String($key.into());
        $map.insert(ret_key, Value::from($val));
    };
}

// if key not exists then append value
#[allow(unused_macros)]
macro_rules! append {
    ($map: expr, $key: expr, $val: expr) => {
        let ret_key = Value::String($key.into());
        if !$map.contains_key(&ret_key) {
            $map.insert(ret_key, Value::from($val));
        }
    };
}

pub fn use_tun(mut config: Mapping, enable: bool) -> Mapping {
    let tun_key = Value::from("tun");
    let tun_val = config.get(&tun_key);
    let mut tun_val = tun_val.map_or_else(Mapping::new, |val| {
        val.as_mapping().cloned().unwrap_or_else(Mapping::new)
    });

    if enable {
        // 读取DNS配置
        let dns_key = Value::from("dns");
        let dns_val = config.get(&dns_key);
        let mut dns_val = dns_val.map_or_else(Mapping::new, |val| {
            val.as_mapping().cloned().unwrap_or_else(Mapping::new)
        });
        let ipv6_key = Value::from("ipv6");
        let ipv6_val = config.get(&ipv6_key).and_then(|v| v.as_bool()).unwrap_or(false);

        // 检查现有的 enhanced-mode 设置
        let current_mode = dns_val
            .get(Value::from("enhanced-mode"))
            .and_then(|v| v.as_str())
            .unwrap_or("fake-ip");

        // 只有当 enhanced-mode 是 fake-ip 或未设置时才修改 DNS 配置
        if current_mode == "fake-ip" || !dns_val.contains_key(Value::from("enhanced-mode")) {
            revise!(dns_val, "enable", true);
            revise!(dns_val, "ipv6", ipv6_val);

            if !dns_val.contains_key(Value::from("enhanced-mode")) {
                revise!(dns_val, "enhanced-mode", "fake-ip");
            }

            if !dns_val.contains_key(Value::from("fake-ip-range")) {
                revise!(dns_val, "fake-ip-range", "198.18.0.1/16");
            }
        }

        // 当TUN启用时，将修改后的DNS配置写回
        revise!(config, "dns", dns_val);
    }

    // 更新TUN配置
    revise!(tun_val, "enable", enable);
    revise!(config, "tun", tun_val);

    config
}

#[cfg(test)]
mod tests {
    use super::use_tun;
    use serde_yaml_ng::Mapping;

    #[test]
    fn enabling_tun_preserves_routing_mode_and_custom_dns() -> anyhow::Result<()> {
        let config: Mapping = serde_yaml_ng::from_str(
            "mode: rule\ndns:\n  enhanced-mode: redir-host\n  nameserver: [https://example.test/dns-query]\ntun:\n  auto-route: true\n",
        )?;
        let dns = config.get("dns").cloned();
        let enhanced = use_tun(config, true);
        assert_eq!(enhanced.get("mode").and_then(|v| v.as_str()), Some("rule"));
        assert_eq!(enhanced.get("dns").cloned(), dns);
        assert_eq!(
            enhanced
                .get("tun")
                .and_then(|v| v.get("enable"))
                .and_then(|v| v.as_bool()),
            Some(true)
        );
        let disconnected = use_tun(enhanced, false);
        assert_eq!(disconnected.get("dns").cloned(), dns);
        assert_eq!(
            disconnected
                .get("tun")
                .and_then(|v| v.get("enable"))
                .and_then(|v| v.as_bool()),
            Some(false)
        );
        Ok(())
    }
}
