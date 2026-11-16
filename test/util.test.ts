import { describe, expect, test } from "bun:test";

import {
  escapeHtml,
  htmlToText,
  isUuid,
  parseTaskKey,
  plainTextToHtml,
  sameName,
  taskKey,
} from "../src/util.ts";

describe("plainTextToHtml", () => {
  test("wraps each line in a paragraph", () => {
    expect(plainTextToHtml("one\ntwo\r\nthree")).toBe(
      "<p>one</p><p>two</p><p>three</p>",
    );
  });

  test("escapes markup so text can never inject HTML", () => {
    const html = plainTextToHtml("<img src=x onerror=\"alert(1)\"> & 'x'");
    expect(html).not.toContain("<img");
    expect(html).toBe(
      "<p>&lt;img src=x onerror=&quot;alert(1)&quot;&gt; &amp; &#39;x&#39;</p>",
    );
  });

  test("round-trips through htmlToText", () => {
    const text = 'Ship <MCP> & "docs"';
    expect(htmlToText(plainTextToHtml(text))).toBe(text);
  });
});

describe("escapeHtml", () => {
  test("escapes the five significant characters", () => {
    expect(escapeHtml(`&<>"'`)).toBe("&amp;&lt;&gt;&quot;&#39;");
  });
});

describe("htmlToText", () => {
  test("strips markup and keeps block boundaries apart", () => {
    expect(
      htmlToText(
        "<p>Hello <strong>there</strong></p><p>Tom &amp; Jerry&nbsp;&lt;3</p>",
      ),
    ).toBe("Hello there Tom & Jerry <3");
  });

  test("handles empty input", () => {
    expect(htmlToText(null)).toBe("");
    expect(htmlToText("")).toBe("");
  });
});

describe("parseTaskKey", () => {
  test("splits a key into prefix and number", () => {
    expect(parseTaskKey("APP-12")).toEqual({ prefix: "APP", number: 12 });
    expect(parseTaskKey(" web2-7 ")).toEqual({ prefix: "web2", number: 7 });
  });

  test("rejects anything else", () => {
    expect(parseTaskKey("12")).toBeNull();
    expect(parseTaskKey("APP-")).toBeNull();
    expect(parseTaskKey("fix login")).toBeNull();
  });
});

describe("taskKey", () => {
  test("joins a prefix and number, tolerating a missing prefix", () => {
    expect(taskKey("APP", 3)).toBe("APP-3");
    expect(taskKey(null, 3)).toBe("3");
    expect(taskKey("APP", null)).toBeNull();
  });
});

describe("isUuid and sameName", () => {
  test("tells ids from names", () => {
    expect(isUuid("11111111-1111-4111-8111-111111111111")).toBe(true);
    expect(isUuid("app")).toBe(false);
  });

  test("compares case- and whitespace-insensitively", () => {
    expect(sameName(" In Progress ", "in progress")).toBe(true);
    expect(sameName(null, "x")).toBe(false);
  });
});
