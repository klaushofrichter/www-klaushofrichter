// The website <-> scanner contract, and the shapes the website sends to the
// browser. The real scanner (a later plan) and e2e/fakeScanner.ts both
// implement GET/POST /scan returning ScanState. Spec:
// docs/superpowers/specs/2026-09-17-ip-survey-design.md

export type ScanStage = 'discovery' | 'names' | 'ports' | 'web';
export type NameSource = 'mdns' | 'ssdp' | 'dns';

export interface WebInfo {
  url: string;
  title: string | null;
}

export interface DevicePort {
  port: number;
  service: string;
  web: WebInfo | null;
}

export interface Device {
  ip: string;
  mac: string;
  vendor: string | null;
  privateMac: boolean;
  name: string | null;
  nameSource: NameSource | null;
  web: WebInfo | null;
  services: string[];
  ports: DevicePort[];
  rttMs: number | null;
}

export interface ScanResult {
  scannedAt: string;
  cidr: string;
  devices: Device[];
}

export type ScanState =
  | { state: 'idle' }
  | { state: 'running'; stage: ScanStage; stageIndex: number; stageCount: number; startedAt: string }
  | { state: 'finished'; result: ScanResult }
  | { state: 'failed'; error: string; finishedAt: string };

export interface SavedSurvey extends ScanResult {
  savedAt: string;
  version: string;
}

export type SurveyRowStatus = 'new' | 'unchanged' | 'gone';

export interface SurveyRow extends Device {
  status: SurveyRowStatus;
  // Precomputed so the browser sorts numbers instead of re-parsing addresses.
  ipNum: number;
  statusRank: number;
  // A fact about the device, not the scan snapshot; merged in server-side
  // from notes.json so a 'gone' row keeps its note if the device returns.
  note: string | null;
}

// Keyed by lowercase MAC address so a note survives rescans and reappears if
// a device comes back after being reported 'gone'.
export interface NoteEntry {
  text: string;
  updatedAt: string;
}

export type NotesStore = Record<string, NoteEntry>;

export interface SurveyView {
  source: 'none' | 'saved' | 'scan';
  scannedAt: string | null;
  savedAt: string | null;
  unsaved: boolean;
  rows: SurveyRow[];
  counts: { devices: number; new: number; gone: number };
}

export type ScanProgress =
  | { state: 'idle' }
  | { state: 'running'; stage: ScanStage; stageIndex: number; stageCount: number }
  | { state: 'finished'; scannedAt: string }
  | { state: 'failed'; error: string }
  | { state: 'unavailable' };

export interface SurveyStatus {
  scan: ScanProgress;
  view: SurveyView;
}
