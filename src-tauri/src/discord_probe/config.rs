use serde_yaml_ng::{Mapping, Value};

pub const PREFIX: &str = "PewPew Internal ";

pub fn add_groups(mut config: Mapping, suffix: &str) -> Mapping {
    let mut nodes = vec![Value::String("PASS".into())];
    if let Some(proxies) = config.get("proxies").and_then(Value::as_sequence) {
        nodes.extend(proxies.iter().filter_map(|p| p.get("name").cloned()));
    }
    let providers: Vec<Value> = config
        .get("proxy-providers")
        .and_then(Value::as_mapping)
        .map(|providers| providers.keys().cloned().collect())
        .unwrap_or_default();
    let groups = config
        .entry(Value::String("proxy-groups".into()))
        .or_insert_with(|| Value::Sequence(vec![]));
    let Some(groups) = groups.as_sequence_mut() else {
        return config;
    };
    for purpose in ["Probe", "Discord"] {
        let mut group = Mapping::new();
        group.insert("name".into(), format!("{PREFIX}{purpose} {suffix}").into());
        group.insert("type".into(), "select".into());
        group.insert("hidden".into(), true.into());
        group.insert("proxies".into(), Value::Sequence(nodes.clone()));
        group.insert("use".into(), Value::Sequence(providers.clone()));
        groups.push(Value::Mapping(group));
    }
    let probe = format!("{PREFIX}Probe {suffix}");
    let discord = format!("{PREFIX}Discord {suffix}");
    let rules = config.entry("rules".into()).or_insert_with(|| Value::Sequence(vec![]));
    if let Some(rules) = rules.as_sequence_mut() {
        let mut added = vec![format!(
            "AND,((DST-PORT,18443-18444),(IP-CIDR,138.68.16.189/32,no-resolve)),{probe}"
        )];
        for domain in [
            "discord.com",
            "discord.gg",
            "discord.media",
            "discordapp.com",
            "discordapp.net",
        ] {
            added.push(format!("DOMAIN-SUFFIX,{domain},{discord}"));
        }
        // Voice destinations can be bare IPs. Do not capture local/discovery/DNS traffic.
        for process in [
            "Discord.exe",
            "DiscordCanary.exe",
            "DiscordPTB.exe",
            "Discord",
            "Discord Canary",
            "Discord PTB",
        ] {
            added.push(format!("AND,((NETWORK,udp),(DST-PORT,1024-65535),(PROCESS-NAME,{process}),(NOT,((IP-CIDR,10.0.0.0/8,no-resolve))),(NOT,((IP-CIDR,172.16.0.0/12,no-resolve))),(NOT,((IP-CIDR,192.168.0.0/16,no-resolve))),(NOT,((IP-CIDR,127.0.0.0/8,no-resolve))),(NOT,((IP-CIDR,169.254.0.0/16,no-resolve))),(NOT,((IP-CIDR,224.0.0.0/4,no-resolve))),(NOT,((IP-CIDR6,::1/128,no-resolve))),(NOT,((IP-CIDR6,fc00::/7,no-resolve))),(NOT,((IP-CIDR6,fe80::/10,no-resolve))),(NOT,((IP-CIDR6,ff00::/8,no-resolve)))),{discord}"));
        }
        rules.splice(0..0, added.into_iter().map(Value::String));
    }
    config
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn helpers_default_to_pass_and_preserve_rules() {
        let mut input = Mapping::new();
        input.insert("rules".into(), Value::Sequence(vec!["MATCH,Original".into()]));
        let result = add_groups(input, "test");
        assert_eq!(result["proxy-groups"][0]["proxies"][0].as_str(), Some("PASS"));
        assert_eq!(result["proxy-groups"][1]["hidden"].as_bool(), Some(true));
        assert_eq!(
            result["rules"]
                .as_sequence()
                .and_then(|r| r.last())
                .and_then(Value::as_str),
            Some("MATCH,Original")
        );
    }
}
