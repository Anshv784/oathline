//! Loads the checked-in NEAR AI attestation for `Qwen/Qwen3.8-27B`.
//!
//! The fixture is a real `GET /v1/attestation/report` response, fetched with
//! the nonce in `qwen3.8-27b.nonce`. Its Intel quote was verified with
//! dcap-qvl against the collateral in `qwen3.8-27b.collateral.json`; these
//! tests take the TD report fields straight from the quote bytes.

#![allow(dead_code)]

use serde_json::Value;
use verdict_core::attestation::{ImageMeasurements, ModelPolicy, Rtmr3Event, TdReport};
use verdict_core::Address;

pub struct Fixture {
    pub report: TdReport,
    pub nonce: [u8; 32],
    pub signing_address: Address,
    pub app_compose: String,
    pub events: Vec<Rtmr3Event>,
}

const REPORT: &str = include_str!("../fixtures/qwen3.8-27b.report.json");
const NONCE: &str = include_str!("../fixtures/qwen3.8-27b.nonce");

/// Offsets of the TD 1.0 report body inside a v4 TDX quote (48-byte header).
fn td_report_from_quote(quote: &[u8]) -> TdReport {
    let field = |start: usize, len: usize| &quote[48 + start..48 + start + len];
    let m48 = |start: usize| -> [u8; 48] { field(start, 48).try_into().unwrap() };
    TdReport {
        td_attributes: field(120, 8).try_into().unwrap(),
        mr_td: m48(136),
        mr_config_id: m48(184),
        rt_mr0: m48(328),
        rt_mr1: m48(376),
        rt_mr2: m48(424),
        rt_mr3: m48(472),
        report_data: field(520, 64).try_into().unwrap(),
    }
}

fn hex_bytes(value: &Value) -> Vec<u8> {
    hex::decode(value.as_str().unwrap().trim_start_matches("0x")).unwrap()
}

pub fn load() -> Fixture {
    let root: Value = serde_json::from_str(REPORT).unwrap();
    let model = &root["model_attestations"][0];
    let quote = hex_bytes(&model["intel_quote"]);
    assert_eq!(&quote[..2], &[4, 0], "fixture must be a v4 quote");

    let log: Value = match &model["event_log"] {
        Value::String(text) => serde_json::from_str(text).unwrap(),
        other => other.clone(),
    };
    let events = log
        .as_array()
        .unwrap()
        .iter()
        .filter(|event| event["imr"].as_u64() == Some(3))
        .map(|event| Rtmr3Event {
            event_type: event["event_type"].as_u64().unwrap() as u32,
            event: event["event"].as_str().unwrap().to_owned(),
            payload: hex_bytes(&event["event_payload"]),
            digest: event["digest"]
                .as_str()
                .filter(|digest| !digest.is_empty())
                .map(|digest| hex::decode(digest).unwrap().try_into().unwrap()),
        })
        .collect();

    Fixture {
        report: td_report_from_quote(&quote),
        nonce: hex::decode(NONCE.trim()).unwrap().try_into().unwrap(),
        signing_address: hex_bytes(&model["signing_address"]).try_into().unwrap(),
        app_compose: model["info"]["tcb_info"]["app_compose"]
            .as_str()
            .unwrap()
            .to_owned(),
        events,
    }
}

/// A policy that allows exactly the fixture's image and app configuration.
pub fn policy_for(fixture: &Fixture) -> ModelPolicy {
    ModelPolicy {
        images: vec![ImageMeasurements {
            mr_td: fixture.report.mr_td,
            rt_mr0: fixture.report.rt_mr0,
            rt_mr1: fixture.report.rt_mr1,
            rt_mr2: fixture.report.rt_mr2,
        }],
        compose_hashes: vec![verdict_core::inference::sha256(
            fixture.app_compose.as_bytes(),
        )],
    }
}
