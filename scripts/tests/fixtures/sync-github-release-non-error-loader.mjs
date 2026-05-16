if (process.env.AGENT_HARNESS_SYNC_RELEASE_THROW_STRING === "1") {
  globalThis.fetch = async () => {
    throw "string failure";
  };
}
