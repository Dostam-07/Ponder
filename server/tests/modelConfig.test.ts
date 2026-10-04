import { describe, it, expect } from "vitest";
import { resolveModels } from "../src/llm/modelConfig.js";

const INSTALLED = ["llama3.2:3b", "gemma3:4b", "gemma4:latest", "qwen2.5:1.5b"];

const base = {
  envFast: undefined,
  envQuality: undefined,
  savedFast: null as string | null,
  savedQuality: null as string | null,
  defaultFast: "llama3.2:3b",
  defaultQuality: "gemma3:4b",
  installed: INSTALLED,
};

describe("resolveModels — precedence ladder (env > saved-if-installed > default)", () => {
  it("falls back to the documented defaults when nothing else is set", () => {
    const m = resolveModels(base);
    expect(m.fast.effective).toBe("llama3.2:3b");
    expect(m.fast.source).toBe("default");
    expect(m.quality.effective).toBe("gemma3:4b");
    expect(m.quality.source).toBe("default");
    expect(m.fast.savedIgnored).toBe(false);
    expect(m.installed).toEqual(INSTALLED);
  });

  it("env vars win over everything, and the override is reported", () => {
    const m = resolveModels({ ...base, envFast: "gemma4:latest", envQuality: "qwen2.5:1.5b", savedFast: "llama3.2:3b" });
    expect(m.fast.effective).toBe("gemma4:latest");
    expect(m.fast.source).toBe("env");
    expect(m.fast.env).toBe("gemma4:latest");
    // the saved value differs from env → explicitly reported as overridden
    expect(m.fast.saved).toBe("llama3.2:3b");
    expect(m.fast.savedIgnored).toBe(true);
    expect(m.fast.savedIgnoreReason).toBe("env_override");
    expect(m.quality.source).toBe("env");
  });

  it("env equal to the saved value is not flagged as an override", () => {
    const m = resolveModels({ ...base, envFast: "gemma3:4b", savedFast: "gemma3:4b" });
    expect(m.fast.source).toBe("env");
    expect(m.fast.savedIgnored).toBe(false);
    expect(m.fast.savedIgnoreReason).toBe(null);
  });

  it("empty / whitespace env vars are treated as unset", () => {
    const a = resolveModels({ ...base, envFast: "", savedFast: "gemma3:4b" });
    expect(a.fast.source).toBe("saved");
    const b = resolveModels({ ...base, envFast: "   ", envQuality: "\t" });
    expect(b.fast.source).toBe("default");
    expect(b.quality.source).toBe("default");
  });

  it("saved preference wins over the default when the model is installed", () => {
    const m = resolveModels({ ...base, savedFast: "gemma4:latest", savedQuality: "qwen2.5:1.5b" });
    expect(m.fast.effective).toBe("gemma4:latest");
    expect(m.fast.source).toBe("saved");
    expect(m.quality.effective).toBe("qwen2.5:1.5b");
    expect(m.quality.source).toBe("saved");
    expect(m.fast.savedIgnored).toBe(false);
  });

  it("saved preference is IGNORED (with reason) when the model is no longer installed", () => {
    const m = resolveModels({ ...base, savedFast: "llama3:70b" }); // not in INSTALLED
    expect(m.fast.effective).toBe("llama3.2:3b"); // documented default
    expect(m.fast.source).toBe("default");
    expect(m.fast.savedIgnored).toBe(true);
    expect(m.fast.savedIgnoreReason).toBe("not_installed");
    // roles are independent — quality unaffected
    expect(m.quality.source).toBe("default");
    expect(m.quality.savedIgnored).toBe(false);
  });

  it("an unknown installed list (Ollama down / not yet discovered) trusts the saved preference", () => {
    expect(resolveModels({ ...base, installed: null, savedFast: "gemma3:4b" }).fast.source).toBe("saved");
    expect(resolveModels({ ...base, installed: [], savedFast: "gemma3:4b" }).fast.source).toBe("saved");
  });

  it("env still wins when the installed list is unknown", () => {
    const m = resolveModels({ ...base, installed: null, envFast: "gemma4:latest", savedFast: "gemma3:4b" });
    expect(m.fast.source).toBe("env");
    expect(m.fast.savedIgnoreReason).toBe("env_override");
  });
});
