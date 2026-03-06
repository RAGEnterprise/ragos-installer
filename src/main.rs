use axum::{
	extract::State,
	http::StatusCode,
	response::{Html, IntoResponse},
	routing::{get, post},
	Json, Router,
};
use axum::extract::Query;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
	net::SocketAddr,
	path::{Path, PathBuf},
	process::Stdio,
	sync::Arc,
};
use thiserror::Error;
use tokio::{
	fs,
	process::Command,
	sync::Mutex,
};
use tower_http::trace::TraceLayer;
use tower_http::services::ServeDir;
use tower_http::set_header::SetResponseHeaderLayer;
use tracing::{info, warn};
use axum::http::header::{CACHE_CONTROL, HeaderValue};

#[derive(Clone)]
struct AppState {
	static_dir: PathBuf,
	imgs_dir: PathBuf,
	runtime_dir: PathBuf,
	install_lock: Arc<Mutex<()>>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct PlanRequest {
	// EULA
	eula_accepted: bool,

	// Disco
	disk_mode: String, // "one" | "two"
	sys_disk: String,
	data_disk: Option<String>,
	root_fs: Option<String>, // "ext4" | "btrfs" (quando two)
	data_fs: Option<String>, // "btrfs" | "ext4" | "xfs" (quando two)

	// Localização
	country: String,
	time_zone: String,
	locale: String,
	key_map: String,

	// Admin
	admin_user: String,
	admin_uid: u32,
	admin_email: String,
	admin_password: String,
	admin_password_confirm: String,
	admin_authorized_keys: Option<Vec<String>>,

	// Rede
	host_name: String,
	mgmt_interface: String,
	server_ip: String,
	mgmt_netmask: String,
	mgmt_gateway: String,
	mgmt_dns: String, // "1.1.1.1,8.8.8.8"
	http_port: u16,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Plan {
	// Disco
	disk_mode: String,
	sys_disk: String,
	data_disk: Option<String>,
	root_fs: Option<String>,
	data_fs: Option<String>,

	// Localização
	country: String,
	time_zone: String,
	locale: String,
	key_map: String,

	// Admin
	admin_user: String,
	admin_uid: u32,
	admin_email: String,
	admin_hashed_password: String,
	admin_authorized_keys: Vec<String>,

	// Rede
	host_name: String,
	mgmt_interface: String,
	server_ip: String,
	mgmt_prefix_length: u8,
	mgmt_gateway: String,
	mgmt_dns: Vec<String>,
	http_port: u16,

	created_at_unix: i64,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct DisksResponse {
	disks: Vec<String>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct NetIfsResponse {
	interfaces: Vec<String>,
}

#[derive(Debug, Deserialize)]
struct NetworkTestQuery {
	target: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct NetworkTestResponse {
	target: String,
	success: bool,
	output: String,
}

#[derive(Debug, Deserialize)]
struct DiskLayoutQuery {
	disk: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ListResponse {
	items: Vec<String>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct TimezoneLocation {
	timezone: String,
	country_code: String,
	latitude: f64,
	longitude: f64,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct TimezoneLocationsResponse {
	items: Vec<TimezoneLocation>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct StatusResponse {
	have_plan: bool,
	can_install: bool,
	install_running: bool,
	last_install_exit: Option<i32>,
	install_started_at_unix: Option<i64>,
}

#[derive(Debug, Error)]
enum AppError {
	#[error("io: {0}")]
	Io(#[from] std::io::Error),
	#[error("utf8: {0}")]
	Utf8(#[from] std::string::FromUtf8Error),
	#[error("json: {0}")]
	Json(#[from] serde_json::Error),
	#[error("validation: {0}")]
	Validation(String),
	#[error("command failed: {0}")]
	CommandFailed(String),
}

impl IntoResponse for AppError {
	fn into_response(self) -> axum::response::Response {
		let msg = self.to_string();
		(StatusCode::BAD_REQUEST, msg).into_response()
	}
}

fn now_unix() -> i64 {
	use std::time::{SystemTime, UNIX_EPOCH};
	SystemTime::now()
		.duration_since(UNIX_EPOCH)
		.unwrap_or_default()
		.as_secs() as i64
}

fn parse_geo_component(value: &str) -> Option<f64> {
	let trimmed = value.trim();
	if trimmed.len() < 4 {
		return None;
	}

	let sign = if trimmed.starts_with('-') { -1.0 } else { 1.0 };
	let digits = trimmed.trim_start_matches(['+', '-']);
	let (deg, min, sec) = match digits.len() {
		4 | 5 => {
			let split = digits.len().saturating_sub(2);
			(
				digits[..split].parse::<f64>().ok()?,
				digits[split..].parse::<f64>().ok()?,
				0.0,
			)
		}
		6 | 7 => {
			let split = digits.len().saturating_sub(4);
			(
				digits[..split].parse::<f64>().ok()?,
				digits[split..split + 2].parse::<f64>().ok()?,
				digits[split + 2..].parse::<f64>().ok()?,
			)
		}
		_ => return None,
	};

	Some(sign * (deg + (min / 60.0) + (sec / 3600.0)))
}

fn parse_timezone_locations_from_tab(content: &str) -> Vec<TimezoneLocation> {
	let mut items = Vec::new();

	for line in content.lines() {
		let line = line.trim();
		if line.is_empty() || line.starts_with('#') {
			continue;
		}

		let parts: Vec<&str> = line.split('\t').collect();
		if parts.len() < 3 {
			continue;
		}

		let country_code = parts[0].split(',').next().unwrap_or("").trim().to_string();
		let position = parts[1].trim();
		let timezone = parts[2].trim().to_string();
		if timezone.is_empty() || country_code.is_empty() {
			continue;
		}

		let split_index = position[1..]
			.find(|c| c == '+' || c == '-')
			.map(|idx| idx + 1);
		let Some(split_index) = split_index else {
			continue;
		};

		let latitude = parse_geo_component(&position[..split_index]);
		let longitude = parse_geo_component(&position[split_index..]);
		let (Some(latitude), Some(longitude)) = (latitude, longitude) else {
			continue;
		};

		items.push(TimezoneLocation {
			timezone,
			country_code,
			latitude,
			longitude,
		});
	}

	items.sort_by(|a, b| a.timezone.cmp(&b.timezone));
	items.dedup_by(|a, b| a.timezone == b.timezone);
	items
}

fn plan_path(runtime_dir: &Path) -> PathBuf {
	runtime_dir.join("plan.json")
}

fn install_state_path(runtime_dir: &Path) -> PathBuf {
	runtime_dir.join("install-state.json")
}

#[derive(Debug, Deserialize, Serialize, Default, Clone)]
#[serde(rename_all = "camelCase")]
struct InstallState {
	running: bool,
	last_exit: Option<i32>,
	started_at_unix: Option<i64>,
}

async fn read_install_state(runtime_dir: &Path) -> Result<InstallState, AppError> {
	let p = install_state_path(runtime_dir);
	if !p.exists() {
		return Ok(InstallState::default());
	}
	let bytes = fs::read(p).await?;
	Ok(serde_json::from_slice(&bytes)?)
}

async fn write_install_state(runtime_dir: &Path, state: &InstallState) -> Result<(), AppError> {
	fs::create_dir_all(runtime_dir).await?;
	let p = install_state_path(runtime_dir);
	let bytes = serde_json::to_vec_pretty(state)?;
	fs::write(p, bytes).await?;
	Ok(())
}

async fn get_index(State(state): State<AppState>) -> Result<impl IntoResponse, AppError> {
	let index = fs::read_to_string(state.static_dir.join("index.html")).await?;
	Ok(Html(index))
}

async fn get_netifs() -> Result<Json<NetIfsResponse>, AppError> {
	let out = Command::new("ip")
		.args(["-o", "link", "show"])
		.stdout(Stdio::piped())
		.stderr(Stdio::piped())
		.output()
		.await?;
	if !out.status.success() {
		return Err(AppError::CommandFailed(String::from_utf8(out.stderr)?));
	}
	let stdout = String::from_utf8(out.stdout)?;
	let mut interfaces = vec![];
	for line in stdout.lines() {
		// formato: "2: ens18: <BROADCAST,MULTICAST,UP,LOWER_UP> ..."
		let mut parts = line.split(':');
		let _idx = parts.next();
		let name = parts.next().unwrap_or("").trim();
		if name.is_empty() {
			continue;
		}
		// remove "@..." (ex: eth0@if3)
		let name = name.split('@').next().unwrap_or(name);
		if name != "lo" {
			interfaces.push(name.to_string());
		}
	}
	interfaces.sort();
	interfaces.dedup();
	Ok(Json(NetIfsResponse { interfaces }))
}

async fn get_network_test(Query(q): Query<NetworkTestQuery>) -> Result<Json<NetworkTestResponse>, AppError> {
	let target = q
		.target
		.unwrap_or_else(|| "1.1.1.1".to_string())
		.trim()
		.to_string();

	if target.is_empty() {
		return Err(AppError::Validation("target vazio".into()));
	}

	let out = Command::new("ping")
		.args(["-c", "1", "-W", "2", &target])
		.stdout(Stdio::piped())
		.stderr(Stdio::piped())
		.output()
		.await?;

	let stdout = String::from_utf8(out.stdout)?;
	let stderr = String::from_utf8(out.stderr)?;
	let output = if stdout.trim().is_empty() { stderr } else { stdout };

	Ok(Json(NetworkTestResponse {
		target,
		success: out.status.success(),
		output,
	}))
}

async fn get_timezones() -> Result<Json<ListResponse>, AppError> {
	let out = Command::new("timedatectl")
		.args(["list-timezones"])
		.stdout(Stdio::piped())
		.stderr(Stdio::piped())
		.output()
		.await?;
	if !out.status.success() {
		return Err(AppError::CommandFailed(String::from_utf8(out.stderr)?));
	}
	let stdout = String::from_utf8(out.stdout)?;
	let items = stdout
		.lines()
		.map(|l| l.trim())
		.filter(|l| !l.is_empty())
		.map(|l| l.to_string())
		.collect();
	Ok(Json(ListResponse { items }))
}

async fn get_timezone_locations() -> Result<Json<TimezoneLocationsResponse>, AppError> {
	let candidates = [
		"/usr/share/zoneinfo/zone.tab",
		"/usr/share/zoneinfo/zone1970.tab",
	];

	for path in candidates {
		if Path::new(path).exists() {
			let content = fs::read_to_string(path).await?;
			let items = parse_timezone_locations_from_tab(&content);
			if !items.is_empty() {
				return Ok(Json(TimezoneLocationsResponse { items }));
			}
		}
	}

	Err(AppError::Validation("não foi possível carregar coordenadas de timezone".into()))
}

fn size_value_to_u64(v: &Value) -> u64 {
	match v {
		Value::Number(n) => n.as_u64().unwrap_or(0),
		Value::String(s) => s.trim().parse::<u64>().unwrap_or(0),
		_ => 0,
	}
}

fn find_disk_value(root: &Value, disk_path: &str) -> Option<Value> {
	let ty = root.get("type").and_then(|x| x.as_str()).unwrap_or("");
	let path = root.get("path").and_then(|x| x.as_str()).unwrap_or("");
	if ty == "disk" && path == disk_path {
		return Some(root.clone());
	}
	if let Some(children) = root.get("children").and_then(|x| x.as_array()) {
		for ch in children {
			if let Some(found) = find_disk_value(ch, disk_path) {
				return Some(found);
			}
		}
	}
	None
}

fn enrich_size_bytes(n: &mut Value) {
	if let Some(obj) = n.as_object_mut() {
		if let Some(size_v) = obj.get("size") {
			let bytes = size_value_to_u64(size_v);
			obj.insert("sizeBytes".into(), Value::from(bytes));
		}
	}
	if let Some(children) = n.get_mut("children").and_then(|x| x.as_array_mut()) {
		for ch in children {
			enrich_size_bytes(ch);
		}
	}
}

async fn get_disk_layout(Query(q): Query<DiskLayoutQuery>) -> Result<Json<Value>, AppError> {
	let disk = q.disk.trim().to_string();
	if !disk.starts_with("/dev/") {
		return Err(AppError::Validation("disk inválido".into()));
	}

	// lsblk JSON tree with bytes. Using PATH keeps /dev/xyz stable for UI.
	let out = Command::new("lsblk")
		.args([
			"-J",
			"-b",
			"-o",
			"NAME,PATH,TYPE,SIZE,MOUNTPOINT,FSTYPE,PKNAME",
		])
		.stdout(Stdio::piped())
		.stderr(Stdio::piped())
		.output()
		.await?;
	if !out.status.success() {
		return Err(AppError::CommandFailed(String::from_utf8(out.stderr)?));
	}
	let stdout = String::from_utf8(out.stdout)?;
	let v: Value = serde_json::from_str(&stdout)?;
	let blockdevices = v
		.get("blockdevices")
		.and_then(|x| x.as_array())
		.ok_or_else(|| AppError::Validation("lsblk retornou formato inesperado".into()))?;

	let mut disk_val: Option<Value> = None;
	for bd in blockdevices {
		if let Some(found) = find_disk_value(bd, &disk) {
			disk_val = Some(found);
			break;
		}
	}
	let mut disk_val = disk_val.ok_or_else(|| AppError::Validation("disco não encontrado".into()))?;
	enrich_size_bytes(&mut disk_val);
	let size_bytes = disk_val
		.get("sizeBytes")
		.map(size_value_to_u64)
		.unwrap_or(0);

	Ok(Json(serde_json::json!({
		"disk": disk_val,
		"sizeBytes": size_bytes,
	})))
}

async fn get_keymaps() -> Result<Json<ListResponse>, AppError> {
	let out = Command::new("localectl")
		.args(["list-keymaps"])
		.stdout(Stdio::piped())
		.stderr(Stdio::piped())
		.output()
		.await?;
	if !out.status.success() {
		return Err(AppError::CommandFailed(String::from_utf8(out.stderr)?));
	}
	let stdout = String::from_utf8(out.stdout)?;
	let items = stdout
		.lines()
		.map(|l| l.trim())
		.filter(|l| !l.is_empty())
		.map(|l| l.to_string())
		.collect();
	Ok(Json(ListResponse { items }))
}

async fn get_locales() -> Result<Json<ListResponse>, AppError> {
	// Preferência: `localectl list-locales` (systemd). Fallback: `locale -a`.
	let out = Command::new("localectl")
		.args(["list-locales"])
		.stdout(Stdio::piped())
		.stderr(Stdio::piped())
		.output()
		.await;

	let mut items: Vec<String> = match out {
		Ok(o) if o.status.success() => {
			let stdout = String::from_utf8(o.stdout)?;
			stdout
				.lines()
				.map(|l| l.trim())
				.filter(|l| !l.is_empty())
				.map(|l| l.to_string())
				.collect()
		}
		_ => vec![],
	};

	if items.is_empty() {
		let out = Command::new("locale")
			.args(["-a"])
			.stdout(Stdio::piped())
			.stderr(Stdio::piped())
			.output()
			.await;
		if let Ok(o) = out {
			if o.status.success() {
				let stdout = String::from_utf8(o.stdout)?;
				items = stdout
					.lines()
					.map(|l| l.trim())
					.filter(|l| !l.is_empty())
					.map(|l| l.to_string())
					.collect();
			}
		}
	}

	items.sort();
	items.dedup();
	Ok(Json(ListResponse { items }))
}

async fn get_countries() -> Result<Json<ListResponse>, AppError> {
	// Preferência: /usr/share/zoneinfo/iso3166.tab (tzdata)
	let candidates = [
		"/usr/share/zoneinfo/iso3166.tab",
		"/usr/share/zoneinfo/zone1970.tab",
	];

	let mut content = None;
	for p in candidates {
		if Path::new(p).exists() {
			content = Some(fs::read_to_string(p).await?);
			break;
		}
	}

	if let Some(text) = content {
		let mut items = vec![];
		for line in text.lines() {
			let line = line.trim();
			if line.is_empty() || line.starts_with('#') {
				continue;
			}
			// iso3166.tab: "BR\tBrazil"
			let mut parts = line.split('\t');
			let code_or_cc = parts.next().unwrap_or("").trim();
			let name = parts.next().unwrap_or("").trim();
			if !code_or_cc.is_empty() {
				// Para autocomplete, preferimos manter valores curtos quando possível.
				// Se for iso3166.tab, o primeiro campo é o código do país.
				if code_or_cc.len() == 2 && code_or_cc.chars().all(|c| c.is_ascii_uppercase()) {
					items.push(code_or_cc.to_string());
				} else if !name.is_empty() {
					items.push(name.to_string());
				}
			}
		}
		items.sort();
		items.dedup();
		return Ok(Json(ListResponse { items }));
	}

	// Fallback: deriva códigos de país a partir de locales (ex: pt_BR.UTF-8 -> BR)
	let out = Command::new("locale")
		.args(["-a"])
		.stdout(Stdio::piped())
		.stderr(Stdio::piped())
		.output()
		.await;

	let mut items: Vec<String> = vec![];
	if let Ok(o) = out {
		if o.status.success() {
			let stdout = String::from_utf8(o.stdout)?;
			for line in stdout.lines() {
				let s = line.trim();
				// formatos comuns: pt_BR.UTF-8, en_US, de_DE@euro
				let mut s = s.split('@').next().unwrap_or(s);
				s = s.split('.').next().unwrap_or(s);
				if let Some((_lang, cc)) = s.split_once('_') {
					let cc = cc.trim();
					if cc.len() == 2 && cc.chars().all(|c| c.is_ascii_uppercase()) {
						items.push(cc.to_string());
					}
				}
			}
		}
	}

	items.sort();
	items.dedup();
	Ok(Json(ListResponse { items }))
}

async fn get_disks() -> Result<Json<DisksResponse>, AppError> {
	// Lista discos físicos (TYPE=disk) e retorna /dev/...
	let out = Command::new("lsblk")
		.args(["-dpno", "NAME,TYPE"])
		.stdout(Stdio::piped())
		.stderr(Stdio::piped())
		.output()
		.await?;

	if !out.status.success() {
		return Err(AppError::CommandFailed(String::from_utf8(out.stderr)?));
	}

	let stdout = String::from_utf8(out.stdout)?;
	let mut disks = vec![];
	for line in stdout.lines() {
		let mut parts = line.split_whitespace();
		let name = parts.next().unwrap_or("");
		let ty = parts.next().unwrap_or("");
		if ty == "disk" && name.starts_with("/dev/") {
			disks.push(name.to_string());
		}
	}
	Ok(Json(DisksResponse { disks }))
}

fn validate_plan(req: &PlanRequest) -> Result<(), AppError> {
	if !req.eula_accepted {
		return Err(AppError::Validation("É necessário aceitar o EULA".into()));
	}

	if req.disk_mode != "one" && req.disk_mode != "two" {
		return Err(AppError::Validation("diskMode inválido".into()));
	}
	if !req.sys_disk.starts_with("/dev/") {
		return Err(AppError::Validation("sysDisk inválido".into()));
	}
	if req.disk_mode == "two" {
		let data = req
			.data_disk
			.as_deref()
			.ok_or_else(|| AppError::Validation("dataDisk obrigatório (modo two)".into()))?;
		if !data.starts_with("/dev/") {
			return Err(AppError::Validation("dataDisk inválido".into()));
		}
		if data == req.sys_disk {
			return Err(AppError::Validation("dataDisk não pode ser igual ao sysDisk".into()));
		}
		let root_fs = req
			.root_fs
			.as_deref()
			.ok_or_else(|| AppError::Validation("rootFs obrigatório (modo two)".into()))?;
		if root_fs != "ext4" && root_fs != "btrfs" && root_fs != "xfs" {
			return Err(AppError::Validation("rootFs inválido".into()));
		}

		let data_fs = req
			.data_fs
			.as_deref()
			.ok_or_else(|| AppError::Validation("dataFs obrigatório (modo two)".into()))?;
		if data_fs != "btrfs" && data_fs != "ext4" && data_fs != "xfs" {
			return Err(AppError::Validation("dataFs inválido".into()));
		}
	}

	if req.country.trim().is_empty() {
		return Err(AppError::Validation("country vazio".into()));
	}
	if req.time_zone.trim().is_empty() {
		return Err(AppError::Validation("timeZone vazio".into()));
	}
	if req.locale.trim().is_empty() {
		return Err(AppError::Validation("locale vazio".into()));
	}
	if req.key_map.trim().is_empty() {
		return Err(AppError::Validation("keyMap vazio".into()));
	}

	if req.admin_user.trim().is_empty() {
		return Err(AppError::Validation("adminUser vazio".into()));
	}
	if req.admin_password.len() < 8 {
		return Err(AppError::Validation("Senha deve ter pelo menos 8 caracteres".into()));
	}
	if !is_strong_password(&req.admin_password) {
		return Err(AppError::Validation(
			"Senha fraca: use 12+ caracteres e misture maiúsculas, minúsculas, números e símbolos".into(),
		));
	}
	if req.admin_password != req.admin_password_confirm {
		return Err(AppError::Validation("Senha e confirmação não batem".into()));
	}
	if req.admin_email.trim().is_empty() {
		return Err(AppError::Validation("adminEmail vazio".into()));
	}

	if req.server_ip.trim().is_empty() {
		return Err(AppError::Validation("serverIp vazio".into()));
	}
	if req.host_name.trim().is_empty() {
		return Err(AppError::Validation("hostName vazio".into()));
	}
	if req.mgmt_interface.trim().is_empty() {
		return Err(AppError::Validation("mgmtInterface vazio".into()));
	}
	if req.mgmt_gateway.trim().is_empty() {
		return Err(AppError::Validation("mgmtGateway vazio".into()));
	}
	if req.mgmt_dns.trim().is_empty() {
		return Err(AppError::Validation("mgmtDns vazio".into()));
	}
	if req.mgmt_netmask.trim().is_empty() {
		return Err(AppError::Validation("mgmtNetmask vazio".into()));
	}
	Ok(())
}

fn is_strong_password(pw: &str) -> bool {
	if pw.len() < 12 {
		return false;
	}
	let mut have_lower = false;
	let mut have_upper = false;
	let mut have_digit = false;
	let mut have_symbol = false;
	for ch in pw.chars() {
		if ch.is_ascii_lowercase() {
			have_lower = true;
		} else if ch.is_ascii_uppercase() {
			have_upper = true;
		} else if ch.is_ascii_digit() {
			have_digit = true;
		} else if !ch.is_whitespace() {
			have_symbol = true;
		}
	}
	let classes = [have_lower, have_upper, have_digit, have_symbol]
		.into_iter()
		.filter(|x| *x)
		.count();
	classes >= 3
}

fn parse_dns_csv(s: &str) -> Vec<String> {
	s.split(',')
		.map(|x| x.trim())
		.filter(|x| !x.is_empty())
		.map(|x| x.to_string())
		.collect()
}

fn netmask_to_prefix(netmask: &str) -> Result<u8, AppError> {
	let parts: Vec<&str> = netmask.trim().split('.').collect();
	if parts.len() != 4 {
		return Err(AppError::Validation("Netmask inválida".into()));
	}
	let mut bits = 0u8;
	let mut seen_zero = false;
	for p in parts {
		let oct: u8 = p
			.parse()
			.map_err(|_| AppError::Validation("Netmask inválida".into()))?;
		for i in (0..8).rev() {
			let b = (oct >> i) & 1;
			if b == 1 {
				if seen_zero {
					return Err(AppError::Validation("Netmask inválida".into()));
				}
				bits = bits.saturating_add(1);
			} else {
				seen_zero = true;
			}
		}
	}
	Ok(bits)
}

async fn hash_password_sha512(password: &str) -> Result<String, AppError> {
	let mut child = Command::new("mkpasswd")
		.args(["-m", "sha-512", "--stdin"])
		.stdin(Stdio::piped())
		.stdout(Stdio::piped())
		.stderr(Stdio::piped())
		.spawn()?;

	{
		use tokio::io::AsyncWriteExt;
		let mut stdin = child
			.stdin
			.take()
			.ok_or_else(|| AppError::CommandFailed("mkpasswd stdin".into()))?;
		stdin.write_all(password.as_bytes()).await?;
		stdin.write_all(b"\n").await?;
	}

	let out = child.wait_with_output().await?;
	if !out.status.success() {
		return Err(AppError::CommandFailed(String::from_utf8(out.stderr)?));
	}
	let stdout = String::from_utf8(out.stdout)?;
	let hash = stdout.lines().next().unwrap_or("").trim().to_string();
	if hash.is_empty() {
		return Err(AppError::CommandFailed("mkpasswd retornou vazio".into()));
	}
	Ok(hash)
}

async fn post_plan(
	State(state): State<AppState>,
	Json(req): Json<PlanRequest>,
) -> Result<Json<Plan>, AppError> {
	validate_plan(&req)?;
	fs::create_dir_all(&state.runtime_dir).await?;

	let mgmt_prefix = netmask_to_prefix(&req.mgmt_netmask)?;
	let mgmt_dns = parse_dns_csv(&req.mgmt_dns);
	if mgmt_dns.is_empty() {
		return Err(AppError::Validation("mgmtDns inválido".into()));
	}

	let admin_hash = hash_password_sha512(&req.admin_password).await?;

	let plan = Plan {
		disk_mode: req.disk_mode.clone(),
		sys_disk: req.sys_disk,
		data_disk: if req.disk_mode == "two" {
			req.data_disk
		} else {
			None
		},
		root_fs: if req.disk_mode == "two" {
			req.root_fs
		} else {
			None
		},
		data_fs: if req.disk_mode == "two" {
			req.data_fs
		} else {
			None
		},

		country: req.country,
		time_zone: req.time_zone,
		locale: req.locale,
		key_map: req.key_map,

		admin_user: req.admin_user,
		admin_uid: req.admin_uid,
		admin_email: req.admin_email,
		admin_hashed_password: admin_hash,
		admin_authorized_keys: req.admin_authorized_keys.unwrap_or_default(),

		host_name: req.host_name,
		mgmt_interface: req.mgmt_interface,
		server_ip: req.server_ip,
		mgmt_prefix_length: mgmt_prefix,
		mgmt_gateway: req.mgmt_gateway,
		mgmt_dns,
		http_port: req.http_port,

		created_at_unix: now_unix(),
	};

	let p = plan_path(&state.runtime_dir);
	let bytes = serde_json::to_vec_pretty(&plan)?;
	fs::write(p, bytes).await?;

	// Marca estado como pronto.
	let mut ist = read_install_state(&state.runtime_dir).await?;
	ist.running = false;
	write_install_state(&state.runtime_dir, &ist).await?;

	Ok(Json(plan))
}

async fn get_status(State(state): State<AppState>) -> Result<Json<StatusResponse>, AppError> {
	let have_plan = plan_path(&state.runtime_dir).exists();
	let ist = read_install_state(&state.runtime_dir).await?;
	Ok(Json(StatusResponse {
		have_plan,
		can_install: have_plan && !ist.running,
		install_running: ist.running,
		last_install_exit: ist.last_exit,
		install_started_at_unix: ist.started_at_unix,
	}))
}

async fn get_log() -> Result<Json<serde_json::Value>, AppError> {
	let out = Command::new("tail")
		.args(["-n", "200", "/var/log/ragos-install.log"])
		.stdout(Stdio::piped())
		.stderr(Stdio::piped())
		.output()
		.await;

	match out {
		Ok(o) if o.status.success() => {
			let stdout = String::from_utf8(o.stdout)?;
			Ok(Json(serde_json::json!({ "ok": true, "tail": stdout })))
		}
		_ => Ok(Json(serde_json::json!({ "ok": false, "tail": "(sem log ainda)" }))),
	}
}

async fn post_install(State(state): State<AppState>) -> Result<Json<serde_json::Value>, AppError> {
	let _guard = state.install_lock.lock().await;

	let plan_bytes = fs::read(plan_path(&state.runtime_dir)).await.map_err(|_| {
		AppError::Validation("sem plano: finalize o wizard antes".into())
	})?;
	let plan: Plan = serde_json::from_slice(&plan_bytes)?;

	let ist = read_install_state(&state.runtime_dir).await?;
	if ist.running {
		return Err(AppError::Validation("instalação já em andamento".into()));
	}

	// Marca como running.
	write_install_state(
		&state.runtime_dir,
		&InstallState {
			running: true,
			last_exit: None,
			started_at_unix: Some(now_unix()),
		},
	)
	.await?;

	let runtime_dir = state.runtime_dir.clone();
	tokio::spawn(async move {
		let mut cmd = Command::new("ragos-install");
		cmd.arg("unattended");
		cmd.env("RAGOS_I_UNDERSTAND_THIS_WIPES_DISKS", "YES");

		cmd.env("RAGOS_SERVER_IP", &plan.server_ip);
		cmd.env("RAGOS_HTTP_PORT", plan.http_port.to_string());
		cmd.env("RAGOS_HOSTNAME", &plan.host_name);
		cmd.env("RAGOS_TIMEZONE", &plan.time_zone);
		cmd.env("RAGOS_LOCALE", &plan.locale);
		cmd.env("RAGOS_KEYMAP", &plan.key_map);
		cmd.env("RAGOS_MGMT_IFACE", &plan.mgmt_interface);
		cmd.env(
			"RAGOS_MGMT_PREFIX",
			plan.mgmt_prefix_length.to_string(),
		);
		cmd.env("RAGOS_MGMT_GATEWAY", &plan.mgmt_gateway);
		cmd.env("RAGOS_MGMT_DNS", plan.mgmt_dns.join(","));

		cmd.env("RAGOS_ADMIN_USER", &plan.admin_user);
		cmd.env("RAGOS_ADMIN_UID", plan.admin_uid.to_string());
		cmd.env("RAGOS_ADMIN_EMAIL", &plan.admin_email);
		cmd.env("RAGOS_ADMIN_HASH", &plan.admin_hashed_password);
		cmd.env("RAGOS_ADMIN_AUTHORIZED_KEYS", plan.admin_authorized_keys.join("\n"));

		cmd.env("RAGOS_DISK_MODE", &plan.disk_mode);
		cmd.env("RAGOS_SYS_DISK", &plan.sys_disk);
		if let Some(d) = &plan.data_disk {
			cmd.env("RAGOS_DATA_DISK", d);
		}
		if let Some(r) = &plan.root_fs {
			cmd.env("RAGOS_ROOT_FS", r);
		}
		if let Some(df) = &plan.data_fs {
			cmd.env("RAGOS_DATA_FS", df);
		}

		cmd.stdout(Stdio::inherit());
		cmd.stderr(Stdio::inherit());

		info!("starting installer unattended");
		let status = cmd.status().await;
		let (ok, code) = match status {
			Ok(s) => (s.success(), s.code().unwrap_or(1)),
			Err(_) => (false, 1),
		};

		warn!(exit_code = code, ok = ok, "installer finished");
		let _ = write_install_state(
			&runtime_dir,
			&InstallState {
				running: false,
				last_exit: Some(code),
				started_at_unix: None,
			},
		)
		.await;
	});

	Ok(Json(serde_json::json!({
		"started": true,
		"log_file": "/var/log/ragos-install.log"
	})))
}

#[tokio::main]
async fn main() -> Result<(), AppError> {
	tracing_subscriber::fmt()
		.with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
		.init();

	let listen = std::env::var("RAGOS_INSTALLER_LISTEN").unwrap_or_else(|_| "0.0.0.0:8000".into());
	let addr: SocketAddr = listen
		.parse()
		.map_err(|_| AppError::Validation("RAGOS_INSTALLER_LISTEN inválido".into()))?;

	let static_dir = std::env::var("RAGOS_INSTALLER_STATIC")
		.map(PathBuf::from)
		.unwrap_or_else(|_| {
			let local = PathBuf::from("./static");
			if local.exists() {
				return local;
			}
			let repo = PathBuf::from("./installer/installer-ui/static");
			if repo.exists() {
				return repo;
			}
			local
		});
	let imgs_dir = std::env::var("RAGOS_INSTALLER_IMGS")
		.map(PathBuf::from)
		.unwrap_or_else(|_| {
			let dev_imgs = PathBuf::from("./imgs");
			if dev_imgs.exists() {
				dev_imgs
			} else if PathBuf::from("./installer/installer-ui/imgs").exists() {
				PathBuf::from("./installer/installer-ui/imgs")
			} else {
				static_dir.join("imgs")
			}
		});
	let runtime_dir = std::env::var("RAGOS_INSTALLER_RUNTIME")
		.map(PathBuf::from)
		.unwrap_or_else(|_| {
			let mut candidates: Vec<PathBuf> = vec![PathBuf::from("/run/ragos-installer")];
			if let Ok(xdg) = std::env::var("XDG_RUNTIME_DIR") {
				if !xdg.trim().is_empty() {
					candidates.push(PathBuf::from(xdg).join("ragos-installer"));
				}
			}
			candidates.push(PathBuf::from("./runtime"));

			for p in candidates {
				if std::fs::create_dir_all(&p).is_ok() {
					return p;
				}
			}

			PathBuf::from("./runtime")
		});

	let state = AppState {
		static_dir,
		imgs_dir,
		runtime_dir,
		install_lock: Arc::new(Mutex::new(())),
	};

	info!(
		static_dir = %state.static_dir.display(),
		imgs_dir = %state.imgs_dir.display(),
		runtime_dir = %state.runtime_dir.display(),
		"installer-ui paths"
	);

	let app = Router::new()
		.route("/", get(get_index))
		.nest_service("/imgs", ServeDir::new(state.imgs_dir.clone()))
		.route("/api/v1/disks", get(get_disks))
		.route("/api/v1/disk-layout", get(get_disk_layout))
		.route("/api/v1/netifs", get(get_netifs))
		.route("/api/v1/network-test", get(get_network_test))
		.route("/api/v1/timezones", get(get_timezones))
		.route("/api/v1/timezone-locations", get(get_timezone_locations))
		.route("/api/v1/keymaps", get(get_keymaps))
		.route("/api/v1/locales", get(get_locales))
		.route("/api/v1/countries", get(get_countries))
		.route("/api/v1/plan", post(post_plan))
		.route("/api/v1/install", post(post_install))
		.route("/api/v1/status", get(get_status))
		.route("/api/v1/log", get(get_log))
		.layer(SetResponseHeaderLayer::if_not_present(
			CACHE_CONTROL,
			HeaderValue::from_static("no-store"),
		))
		.layer(TraceLayer::new_for_http())
		.with_state(state.clone())
		.fallback_service(ServeDir::new(state.static_dir));

	info!(%addr, "ragos-installer-ui listening");
	let listener = tokio::net::TcpListener::bind(addr).await?;
	axum::serve(listener, app).await?;
	Ok(())
}
