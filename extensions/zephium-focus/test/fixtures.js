// Test-only shims: the store module reads `chrome.storage.local`, so the
// suite hands it a small in-memory one. Nothing here ships.
export {
  cleanSettings,
  report,
  spend,
  countOpen,
  suggestions,
  flush as flushLedger,
  loadHistory,
} from "../src/lib/store.js";
