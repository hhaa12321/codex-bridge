use std::fs;
use std::fs::File;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use codex_bridge::{CodexCliBackend, APP_SERVER_SCHEMA_VERSION};
use serde_json::json;

fn unique_test_dir(label: &str) -> PathBuf {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    std::env::temp_dir().join(format!(
        "cb-{label}-{}-{:x}",
        std::process::id(),
        nanos % 0x100000
    ))
}

fn wait_for_socket(path: &Path, log_path: &Path) {
    let deadline = Instant::now() + Duration::from_secs(20);
    while Instant::now() < deadline {
        if path.exists() {
            return;
        }
        thread::sleep(Duration::from_millis(50));
    }
    let log = fs::read_to_string(log_path).unwrap_or_default();
    panic!(
        "app-server socket did not appear at {}:\n{}",
        path.display(),
        log
    );
}

#[test]
#[ignore = "requires the pinned Codex CLI on PATH"]
fn pinned_codex_cli_exposes_the_tested_app_server_contract() {
    let version = Command::new("codex")
        .arg("--version")
        .env("LC_ALL", "C")
        .output()
        .expect("codex --version");
    assert!(version.status.success());
    assert!(
        String::from_utf8_lossy(&version.stdout).contains(APP_SERVER_SCHEMA_VERSION),
        "installed Codex CLI must match {APP_SERVER_SCHEMA_VERSION}"
    );

    let root = unique_test_dir("app-server-compat");
    let home = root.join("home");
    let schema = root.join("schema");
    fs::create_dir_all(&root).unwrap();
    fs::set_permissions(&root, fs::Permissions::from_mode(0o700)).unwrap();
    fs::create_dir_all(&home).unwrap();
    fs::create_dir_all(&schema).unwrap();
    fs::write(home.join("config.toml"), "[features]\n").unwrap();

    let generated = Command::new("codex")
        .args([
            "app-server",
            "generate-json-schema",
            "--experimental",
            "--out",
        ])
        .arg(&schema)
        .env("CODEX_HOME", &home)
        .env("LC_ALL", "C")
        .output()
        .expect("generate app-server schema");
    assert!(generated.status.success());
    let client_request = fs::read_to_string(schema.join("ClientRequest.json")).unwrap();
    for method in [
        "thread/list",
        "thread/read",
        "thread/resume",
        "thread/queue/add",
        "turn/start",
        "turn/steer",
        "turn/interrupt",
    ] {
        assert!(
            client_request.contains(method),
            "schema is missing {method}"
        );
    }

    let socket = root.join("app-server.sock");
    let log = root.join("app-server.log");
    let mut child = Command::new("codex")
        .args(["app-server", "--listen"])
        .arg(format!("unix://{}", socket.display()))
        .env("CODEX_HOME", &home)
        .env("LC_ALL", "C")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::from(File::create(&log).unwrap()))
        .spawn()
        .expect("start app-server");
    wait_for_socket(&socket, &log);

    let backend = CodexCliBackend::new(PathBuf::from("codex"), Some(socket));
    let thread_list = backend.app_server_rpc("thread/list", json!({"limit": 20}));
    let project_list = backend.app_server_rpc("project/list", json!({"limit": 20}));
    let model_list = backend.app_server_rpc("model/list", json!({"limit": 20}));
    let runtime = backend.app_server_runtime_info();

    let _ = child.kill();
    let _ = child.wait();
    let _ = fs::remove_dir_all(&root);

    assert!(thread_list.unwrap().get("data").is_some());
    assert!(project_list.unwrap().get("data").is_some());
    assert!(model_list.unwrap().get("data").is_some());
    let runtime = runtime.expect("app-server runtime information");
    assert!(runtime.connected);
    assert!(runtime
        .user_agent
        .as_deref()
        .is_some_and(|agent| agent.contains(APP_SERVER_SCHEMA_VERSION)));
}
