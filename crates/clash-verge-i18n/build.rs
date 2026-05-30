use std::fs;

fn main() {
    println!("cargo:rerun-if-changed=locales");

    if let Ok(entries) = fs::read_dir("locales") {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|value| value.to_str()) == Some("yml") {
                println!("cargo:rerun-if-changed={}", path.display());
            }
        }
    }
}
