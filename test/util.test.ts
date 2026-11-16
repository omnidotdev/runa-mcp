import { describe, expect, test } from "bun:test";

import {
  escapeHtml,
  htmlToText,
  isUuid,
  parseTaskKey,
  plainTextToHtml,
  presentDueDate,
  sameName,
  taskKey,
  toDueDateInput,
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

describe("toDueDateInput", () => {
  test("null clears the due date and its time flag", () => {
    expect(toDueDateInput(null)).toEqual({ dueDate: null, dueHasTime: false });
  });

  test("a bare date is all-day at UTC midnight of that day", () => {
    expect(toDueDateInput("2026-12-01")).toEqual({
      dueDate: "2026-12-01T00:00:00Z",
      dueHasTime: false,
    });
  });

  test("midnight in the stated offset is all-day on that local day", () => {
    for (const value of [
      "2026-12-01T00:00:00Z",
      "2026-12-01T00:00:00+01:00",
      "2026-12-01T00:00:00.000-06:00",
      "2026-12-01T00:00+05:30",
      "2026-12-01T00:00:00+1200",
    ]) {
      expect(toDueDateInput(value)).toEqual({
        dueDate: "2026-12-01T00:00:00Z",
        dueHasTime: false,
      });
    }
  });

  test("any other time is a timed due date at that instant", () => {
    expect(toDueDateInput("2026-12-01T15:00:00-06:00")).toEqual({
      dueDate: "2026-12-01T15:00:00-06:00",
      dueHasTime: true,
    });
    expect(toDueDateInput("2026-12-01T00:00:01Z").dueHasTime).toBe(true);
    expect(toDueDateInput("2026-12-01T00:00:00.5Z").dueHasTime).toBe(true);
  });
});

describe("presentDueDate", () => {
  test("is null without a due date", () => {
    expect(presentDueDate(null, false)).toBeNull();
  });

  test("shows a timed due date as its instant", () => {
    expect(presentDueDate("2026-12-01T21:00:00+00:00", true)).toBe(
      "2026-12-01T21:00:00+00:00",
    );
  });

  test("shows an all-day due date as the day of the nearest UTC midnight", () => {
    // canonical storage
    expect(presentDueDate("2026-12-01T00:00:00+00:00", false)).toBe(
      "2026-12-01",
    );
    // legacy local midnights east and west of UTC
    expect(presentDueDate("2026-11-30T23:00:00+00:00", false)).toBe(
      "2026-12-01",
    );
    expect(presentDueDate("2026-11-30T12:00:00+00:00", false)).toBe(
      "2026-12-01",
    );
    expect(presentDueDate("2026-12-01T06:00:00+00:00", false)).toBe(
      "2026-12-01",
    );
    expect(presentDueDate("2026-12-01T11:00:00+00:00", false)).toBe(
      "2026-12-01",
    );
  });
});
