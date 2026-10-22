// Shared test options. A test that starts a session or mounts a surface takes UI: the engine
// does real work there, and with several sessions on one machine 5 s is not enough.
export const UI = { timeoutMs: 30_000 }
