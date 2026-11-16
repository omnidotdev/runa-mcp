import { describe, expect, test } from "bun:test";

import { DEFAULT_API_URL, loadConfig, normalizeApiUrl } from "../src/config.ts";

describe("normalizeApiUrl", () => {
  test("defaults to the public endpoint", () => {
    expect(normalizeApiUrl(undefined)).toBe(DEFAULT_API_URL);
    expect(normalizeApiUrl("  ")).toBe("https://api.runa.omni.dev");
  });

  test("strips trailing slashes", () => {
    expect(normalizeApiUrl("http://runa-api:4000/")).toBe(
      "http://runa-api:4000",
    );
  });
});

describe("loadConfig", () => {
  test("reads the URL and token, treating a blank token as unset", () => {
    expect(
      loadConfig({ RUNA_API_URL: "http://x/", RUNA_API_TOKEN: " runa_t " }),
    ).toEqual({ apiUrl: "http://x", apiToken: "runa_t" });
    expect(loadConfig({ RUNA_API_TOKEN: " " }).apiToken).toBeNull();
  });
});
