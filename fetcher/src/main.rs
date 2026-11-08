//! Runs inside an OutLayer TDX worker when a market resolves from its source.
//!
//! stdin:  `{"url": "https://...", "anchor": "text to find", "max_bytes": 2400}`
//! stdout: `{"url", "status", "bytes", "sha256", "excerpt"}` or `{"error": "..."}`.
//!
//! The URL and anchor were fixed by the market when it was created, so the
//! person triggering the resolution cannot choose the evidence. The page is
//! downloaded here, inside the enclave, once; the excerpt is the readable
//! text that starts just before the anchor. `sha256` covers the full body as
//! served, so anyone can compare it with the page later.

use std::io::{self, Read, Write};
use std::time::Duration;

use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use wasi_http_client::Client;

const TIMEOUT: Duration = Duration::from_secs(30);
const MAX_BODY: usize = 2 * 1024 * 1024;
const LEAD_IN: usize = 160;
const DEFAULT_MAX: usize = 2400;
const HARD_MAX: usize = 3200;

#[derive(Deserialize)]
struct Input {
    url: String,
    anchor: String,
    max_bytes: Option<usize>,
}

fn main() {
    let output = run().unwrap_or_else(|error| json!({ "error": error }));
    print!("{output}");
    io::stdout().flush().ok();
}

fn run() -> Result<Value, String> {
    let mut stdin = String::new();
    io::stdin()
        .read_to_string(&mut stdin)
        .map_err(|e| format!("cannot read input: {e}"))?;
    let input: Input = serde_json::from_str(&stdin).map_err(|e| format!("bad input: {e}"))?;
    if !input.url.starts_with("https://") {
        return Err("only https sources are fetched".to_owned());
    }
    if input.anchor.trim().is_empty() {
        return Err("the anchor is empty".to_owned());
    }

    let response = Client::new()
        .get(&input.url)
        .header("Accept", "text/html, text/markdown, text/plain;q=0.9, */*;q=0.5")
        .header("Accept-Encoding", "identity")
        .header("User-Agent", "oathline-fetcher/0.1 (OutLayer TDX)")
        .connect_timeout(TIMEOUT)
        .send()
        .map_err(|e| format!("fetch failed: {e}"))?;
    let status = response.status();
    let body = response.body().map_err(|e| format!("cannot read body: {e}"))?;
    if status != 200 {
        return Err(format!("source returned HTTP {status}"));
    }
    if body.len() > MAX_BODY {
        return Err(format!("source is larger than {MAX_BODY} bytes"));
    }

    let sha256 = hex(&Sha256::digest(&body));
    let raw = String::from_utf8_lossy(&body);
    let text = readable(&raw);
    let max = input.max_bytes.unwrap_or(DEFAULT_MAX).clamp(200, HARD_MAX);
    let excerpt = excerpt(&text, &input.anchor, max).ok_or_else(|| format!("anchor {:?} not found on the page", input.anchor))?;

    Ok(json!({
        "url": input.url,
        "status": status,
        "bytes": body.len(),
        "sha256": sha256,
        "excerpt": excerpt,
    }))
}

/// Readable text: tags, scripts and styles removed from HTML; whitespace collapsed.
fn readable(raw: &str) -> String {
    let looks_html = raw.trim_start().starts_with('<') || raw.contains("</");
    let mut text = String::with_capacity(raw.len());
    if looks_html {
        let lower = raw.to_ascii_lowercase();
        let mut i = 0;
        let bytes = raw.as_bytes();
        while i < bytes.len() {
            if bytes[i] == b'<' {
                // Skip whole <script> and <style> elements.
                for tag in ["script", "style"] {
                    if lower[i..].starts_with(&format!("<{tag}")) {
                        if let Some(end) = lower[i..].find(&format!("</{tag}>")) {
                            i += end + tag.len() + 3;
                        }
                    }
                }
                match raw[i..].find('>') {
                    Some(end) => {
                        i += end + 1;
                        text.push(' ');
                    }
                    None => break,
                }
            } else {
                let next = raw[i..].find('<').map_or(raw.len(), |n| i + n);
                text.push_str(&raw[i..next]);
                i = next;
            }
        }
        text = text
            .replace("&nbsp;", " ")
            .replace("&amp;", "&")
            .replace("&quot;", "\"")
            .replace("&#39;", "'")
            .replace("&lt;", "<")
            .replace("&gt;", ">");
    } else {
        text.push_str(raw);
    }
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// The text from a little before the anchor's first occurrence, cut at a
/// char boundary to at most `max` bytes.
fn excerpt(text: &str, anchor: &str, max: usize) -> Option<String> {
    let anchor = anchor.split_whitespace().collect::<Vec<_>>().join(" ").to_lowercase();
    let at = text.to_lowercase().find(&anchor)?;
    let mut start = at.saturating_sub(LEAD_IN);
    while !text.is_char_boundary(start) {
        start -= 1;
    }
    let mut end = (start + max).min(text.len());
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    let mut out = text[start..end].to_owned();
    if start > 0 {
        out.insert(0, '…');
    }
    if end < text.len() {
        out.push('…');
    }
    Some(out)
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}
