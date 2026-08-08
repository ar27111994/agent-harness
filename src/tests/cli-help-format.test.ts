import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  findUnknownFlag,
  hasHelpFlag,
  isFlagLike,
  printSubcommandHelp,
  printUnknownArgumentError,
  hasUnknownFlag,
  type SubcommandHelpEntry,
} from "../cli-help-format.js";

// ---------------------------------------------------------------------------
// hasHelpFlag
// ---------------------------------------------------------------------------

void describe("hasHelpFlag", () => {
  // -- basic correctness ---------------------------------------------------

  void it("returns true when --help is present", () => {
    assert.equal(hasHelpFlag(["--help"]), true);
    assert.equal(hasHelpFlag(["some-arg", "--help"]), true);
    assert.equal(hasHelpFlag(["--help", "other"]), true);
  });

  void it("returns true when -h is present", () => {
    assert.equal(hasHelpFlag(["-h"]), true);
    assert.equal(hasHelpFlag(["cmd", "-h"]), true);
  });

  void it("returns false when no help flag is present", () => {
    assert.equal(hasHelpFlag([]), false);
    assert.equal(hasHelpFlag(["some-arg"]), false);
    assert.equal(hasHelpFlag(["--verbose"]), false);
    assert.equal(hasHelpFlag(["-v"]), false);
  });

  void it("returns false for arguments that merely contain the substring", () => {
    assert.equal(hasHelpFlag(["--help-extra"]), false);
    assert.equal(hasHelpFlag(["-help"]), false);
    assert.equal(hasHelpFlag(["-hp"]), false);
  });

  void it("works with multiple args interspersed", () => {
    assert.equal(
      hasHelpFlag(["--state-root", "ws1", "--help", "--quiet"]),
      true,
    );
    assert.equal(hasHelpFlag(["--state-root", "ws1", "--quiet"]), false);
  });

  // -- edge cases ----------------------------------------------------------

  void it("handles empty string args", () => {
    assert.equal(hasHelpFlag([""]), false);
    assert.equal(hasHelpFlag(["", "--help"]), true);
  });

  void it("handles args with only whitespace", () => {
    assert.equal(hasHelpFlag(["  "]), false);
    assert.equal(hasHelpFlag(["\t"]), false);
  });

  void it("handles repeated flags (dedup-safe)", () => {
    assert.equal(hasHelpFlag(["--help", "--help", "--help"]), true);
    assert.equal(hasHelpFlag(["-h", "-h"]), true);
  });

  void it("handles --help appearing at any position", () => {
    assert.equal(hasHelpFlag(["--help"]), true); // first
    assert.equal(hasHelpFlag(["a", "--help"]), true); // middle
    assert.equal(hasHelpFlag(["a", "b", "--help"]), true); // last
    assert.equal(hasHelpFlag(["a", "b", "c", "d", "e", "--help"]), true); // deep
  });

  // -- safety / injection --------------------------------------------------

  void it("is not confused by args containing shell metacharacters", () => {
    // These should not match --help — they're not the literal flag
    assert.equal(hasHelpFlag([";--help"]), false);
    assert.equal(hasHelpFlag(["|--help"]), false);
    assert.equal(hasHelpFlag(["`--help`"]), false);
    assert.equal(hasHelpFlag(["$(--help)"]), false);
    assert.equal(hasHelpFlag(["--help;\u3001"]), false);
    assert.equal(hasHelpFlag(["${--help}"]), false);
  });

  void it("is not confused by lookalike unicode dashes", () => {
    // em-dash, en-dash — not the ASCII hyphen-minus
    assert.equal(hasHelpFlag(["\u2014help"]), false);
    assert.equal(hasHelpFlag(["\u2013help"]), false);
    assert.equal(hasHelpFlag(["\u2014h"]), false);
  });

  // -- stress --------------------------------------------------------------

  void it("handles a very large args array", () => {
    const large = Array.from({ length: 100_000 }, (_, i) => `--arg-${i}`);
    large.push("--help");
    assert.equal(hasHelpFlag(large), true);

    const largeWithout = Array.from(
      { length: 100_000 },
      (_, i) => `--arg-${i}`,
    );
    assert.equal(hasHelpFlag(largeWithout), false);
  });

  // -- concurrency ---------------------------------------------------------

  void it("is safe for concurrent calls (pure function)", async () => {
    const results = await Promise.all(
      Array.from({ length: 100 }, (_, i) =>
        Promise.resolve(hasHelpFlag(i % 2 === 0 ? ["--help"] : ["--verbose"])),
      ),
    );
    for (let i = 0; i < 100; i++) {
      assert.equal(results[i], i % 2 === 0);
    }
  });
});

// ---------------------------------------------------------------------------
// printSubcommandHelp
// ---------------------------------------------------------------------------

function makeHelpTexts(): Record<string, SubcommandHelpEntry> {
  return {
    foo: {
      heading: "test foo — Do the foo thing",
      lines: [
        "Usage: test foo",
        "",
        "Does foo things.",
        "",
        "Options:",
        "  --bar   Enable bar",
      ],
    },
    bar: {
      heading: "test bar — Bar subcommand",
      lines: ["Usage: test bar [--flag]"],
    },
  };
}

void describe("printSubcommandHelp", () => {
  // -- basic correctness ---------------------------------------------------

  void it("prints help for a known subcommand", () => {
    const helpTexts = makeHelpTexts();
    const chunks: string[] = [];
    printSubcommandHelp(
      "foo",
      helpTexts,
      () => {},
      (c) => chunks.push(c),
    );

    const output = chunks.join("");
    assert.match(output, /test foo — Do the foo thing/u);
    assert.match(output, /Usage: test foo/u);
    assert.match(output, /--bar/u);
  });

  void it("calls fallback for an unknown subcommand", () => {
    const helpTexts = makeHelpTexts();
    let fallbackCalled = false;
    const chunks: string[] = [];
    printSubcommandHelp(
      "nonexistent",
      helpTexts,
      () => {
        fallbackCalled = true;
      },
      (c) => chunks.push(c),
    );

    assert.equal(fallbackCalled, true);
    const output = chunks.join("");
    assert.doesNotMatch(output, /test foo/u);
    assert.doesNotMatch(output, /test bar/u);
  });

  void it("calls fallback when helpTexts is empty", () => {
    let fallbackCalled = false;
    printSubcommandHelp("anything", {}, () => {
      fallbackCalled = true;
    });

    assert.equal(fallbackCalled, true);
  });

  void it("handles subcommand names with hyphens and special chars", () => {
    const helpTexts: Record<string, SubcommandHelpEntry> = {
      "demand-profile": {
        heading: "discover demand-profile — Scan workspace",
        lines: ["Usage: agent-harness discover demand-profile"],
      },
    };

    const chunks: string[] = [];
    printSubcommandHelp(
      "demand-profile",
      helpTexts,
      () => {},
      (c) => chunks.push(c),
    );

    assert.match(chunks.join(""), /discover demand-profile/u);
  });

  void it("does not call fallback when subcommand exists", () => {
    const helpTexts = makeHelpTexts();
    let fallbackCalled = false;
    printSubcommandHelp(
      "bar",
      helpTexts,
      () => {
        fallbackCalled = true;
      },
      () => {},
    );

    assert.equal(fallbackCalled, false);
  });

  void it("restores stdout.write after writing (no leak)", () => {
    const originalWrite = process.stdout.write;
    const helpTexts = makeHelpTexts();

    printSubcommandHelp(
      "foo",
      helpTexts,
      () => {},
      () => {},
    );

    assert.strictEqual(process.stdout.write, originalWrite);
  });

  void it("does not alter stdout.write when no write injector is passed", () => {
    const originalWrite = process.stdout.write;
    const helpTexts = makeHelpTexts();

    printSubcommandHelp("foo", helpTexts, () => {});

    assert.strictEqual(process.stdout.write, originalWrite);
  });

  // -- edge cases ----------------------------------------------------------

  void it("handles empty heading", () => {
    const helpTexts: Record<string, SubcommandHelpEntry> = {
      empty: { heading: "", lines: ["just a line"] },
    };
    const chunks: string[] = [];
    printSubcommandHelp(
      "empty",
      helpTexts,
      () => {},
      (c) => chunks.push(c),
    );

    // Should not throw — heading may be empty
    const output = chunks.join("");
    assert.match(output, /just a line/u);
  });

  void it("handles empty lines array", () => {
    const helpTexts: Record<string, SubcommandHelpEntry> = {
      minimal: { heading: "minimal", lines: [] },
    };
    const chunks: string[] = [];
    printSubcommandHelp(
      "minimal",
      helpTexts,
      () => {},
      (c) => chunks.push(c),
    );

    assert.match(chunks.join(""), /minimal/u);
  });

  void it("handles very long heading and lines", () => {
    const longHeading = "x".repeat(10_000);
    const longLine = "y".repeat(10_000);
    const helpTexts: Record<string, SubcommandHelpEntry> = {
      long: { heading: longHeading, lines: [longLine] },
    };

    const chunks: string[] = [];
    assert.doesNotThrow(() => {
      printSubcommandHelp(
        "long",
        helpTexts,
        () => {},
        (c) => chunks.push(c),
      );
    });

    const output = chunks.join("");
    assert.ok(output.includes(longHeading));
    assert.ok(output.includes(longLine));
  });

  void it("handles a large helpTexts record (many subcommands)", () => {
    const helpTexts: Record<string, SubcommandHelpEntry> = {};
    for (let i = 0; i < 500; i++) {
      helpTexts[`cmd-${i}`] = {
        heading: `Command ${i}`,
        lines: [`Usage: cmd-${i}`],
      };
    }

    const chunks: string[] = [];
    printSubcommandHelp(
      "cmd-499",
      helpTexts,
      () => {},
      (c) => chunks.push(c),
    );

    assert.match(chunks.join(""), /Command 499/u);
  });

  // -- security / sanitization ---------------------------------------------

  void it("handles subcommand names that look like prototype pollution", () => {
    const helpTexts: Record<string, SubcommandHelpEntry> = {
      foo: { heading: "safe", lines: ["safe"] },
    };

    // These subcommand lookups should fall through to fallback — never
    // resolve via prototype chain.
    const protokeys = [
      "__proto__",
      "constructor",
      "toString",
      "hasOwnProperty",
    ];
    for (const key of protokeys) {
      let fallbackCalled = false;
      printSubcommandHelp(
        key,
        helpTexts,
        () => {
          fallbackCalled = true;
        },
        () => {},
      );

      assert.equal(
        fallbackCalled,
        true,
        `prototype key '${key}' should not resolve to a help entry`,
      );
    }
  });

  void it("handles subcommand names with unicode and emoji", () => {
    const helpTexts: Record<string, SubcommandHelpEntry> = {
      "héllo-wörld": {
        heading: "unicode heading — café",
        lines: ["Usage: héllo-wörld"],
      },
    };

    const chunks: string[] = [];
    printSubcommandHelp(
      "héllo-wörld",
      helpTexts,
      () => {},
      (c) => chunks.push(c),
    );

    assert.match(chunks.join(""), /unicode heading — café/u);
  });

  void it("handles headings with ASCII control characters gracefully", () => {
    // Control chars should not crash; they get written as-is to stdout
    const helpTexts: Record<string, SubcommandHelpEntry> = {
      ctrl: {
        heading: "test \x00 null \x1b escape",
        lines: ["line with \t tab"],
      },
    };

    const chunks: string[] = [];
    assert.doesNotThrow(() => {
      printSubcommandHelp(
        "ctrl",
        helpTexts,
        () => {},
        (c) => chunks.push(c),
      );
    });
  });

  // -- concurrency ---------------------------------------------------------

  void it("is safe for concurrent calls with different injectors", async () => {
    const helpTexts = makeHelpTexts();
    const results: string[][] = [];

    await Promise.all(
      Array.from({ length: 50 }, (_, i) => {
        const chunks: string[] = [];
        results.push(chunks);
        return Promise.resolve(
          printSubcommandHelp(
            i % 2 === 0 ? "foo" : "bar",
            helpTexts,
            () => {},
            (c) => chunks.push(c),
          ),
        );
      }),
    );

    // Every even-index call should have "foo" output, odd "bar"
    for (let i = 0; i < 50; i++) {
      const joined = results[i].join("");
      if (i % 2 === 0) {
        assert.match(joined, /test foo/u);
      } else {
        assert.match(joined, /test bar/u);
      }
    }
  });

  // -- stress --------------------------------------------------------------

  void it("handles rapid sequential calls without state corruption", () => {
    const helpTexts = makeHelpTexts();

    for (let i = 0; i < 1000; i++) {
      const originalWrite = process.stdout.write;
      const chunks: string[] = [];
      printSubcommandHelp(
        "foo",
        helpTexts,
        () => {},
        (c) => chunks.push(c),
      );

      const output = chunks.join("");
      assert.match(output, /test foo/u);
      // stdout.write must be restored to its exact pre-call reference
      assert.strictEqual(process.stdout.write, originalWrite);
    }
  });
});

// ---------------------------------------------------------------------------
// isFlagLike / findUnknownFlag / printUnknownArgumentError / hasUnknownFlag
// ---------------------------------------------------------------------------

void describe("isFlagLike", () => {
  void it("classifies long, short, and non-flag tokens", () => {
    assert.equal(isFlagLike("--quiet"), true);
    assert.equal(isFlagLike("--no-sync"), true);
    assert.equal(isFlagLike("-h"), true);
    assert.equal(isFlagLike("--max-scan-bytes=100"), true);
    assert.equal(isFlagLike("full"), false);
    assert.equal(isFlagLike("-"), false, "bare dash is positional");
    assert.equal(isFlagLike(""), false);
  });
});

void describe("findUnknownFlag", () => {
  const known = new Set(["--quiet", "--summary", "--no-sync"]);

  void it("returns undefined when every flag is known", () => {
    assert.equal(
      findUnknownFlag(["--quiet", "--summary", "--no-sync"], known),
      undefined,
    );
  });

  void it("returns the first unknown flag", () => {
    assert.equal(
      findUnknownFlag(["--quiet", "--bad-flag"], known),
      "--bad-flag",
    );
    assert.equal(findUnknownFlag(["--bad-flag"], known), "--bad-flag");
  });

  void it("compares --flag=value forms by long name", () => {
    assert.equal(findUnknownFlag(["--quiet=true"], known), undefined);
    assert.equal(
      findUnknownFlag(["--max-scan-bytes=200"], known),
      "--max-scan-bytes",
    );
  });

  void it("skips value tokens for flags that take values", () => {
    const flagsWithValues = new Set(["--max-scan-bytes"]);
    assert.equal(
      findUnknownFlag(
        ["--max-scan-bytes", "100", "--quiet"],
        new Set(["--max-scan-bytes", "--quiet"]),
        flagsWithValues,
      ),
      undefined,
    );
    assert.equal(
      findUnknownFlag(
        ["--max-scan-bytes", "100", "--bad-flag"],
        new Set(["--max-scan-bytes"]),
        flagsWithValues,
      ),
      "--bad-flag",
      "the token after a value flag is not itself scanned as a flag",
    );
  });

  void it("does not skip the value token when the value form is used inline", () => {
    const flagsWithValues = new Set(["--max-scan-bytes"]);
    assert.equal(
      findUnknownFlag(
        ["--max-scan-bytes=100", "--quiet"],
        new Set(["--max-scan-bytes", "--quiet"]),
        flagsWithValues,
      ),
      undefined,
      "inline --flag=value form is recognized and nothing after it is skipped",
    );
  });

  void it("ignores positionals and stops at --", () => {
    assert.equal(findUnknownFlag(["full", "opencode"], known), undefined);
    assert.equal(
      findUnknownFlag(["--", "--bad-flag"], known),
      undefined,
      "tokens after -- are positional",
    );
  });

  void it("handles empty args", () => {
    assert.equal(findUnknownFlag([], known), undefined);
  });

  void it("does not classify a bare dash as an unknown flag", () => {
    assert.equal(findUnknownFlag(["-"], known), undefined);
  });
});

void describe("printUnknownArgumentError", () => {
  void it("prints option vs command errors with a usage pointer", () => {
    const messages: string[] = [];
    const originalError = console.error;
    console.error = (message?: unknown) => messages.push(String(message));
    try {
      printUnknownArgumentError("--bad-flag");
      printUnknownArgumentError("license", "agent-harness --help");
    } finally {
      console.error = originalError;
    }

    assert.match(messages[0] ?? "", /error: unknown option '--bad-flag'/u);
    assert.match(
      messages[1] ?? "",
      /Run 'agent-harness <command> --help' for usage/u,
    );
    assert.match(messages[2] ?? "", /error: unknown command 'license'/u);
    assert.match(messages[3] ?? "", /Run 'agent-harness --help' for usage/u);
  });
});

void describe("hasUnknownFlag", () => {
  void it("returns false and prints nothing for known flags", () => {
    const messages: string[] = [];
    const originalError = console.error;
    console.error = (message?: unknown) => messages.push(String(message));
    try {
      const rejected = hasUnknownFlag(
        ["--quiet", "--no-sync"],
        new Set(["--quiet", "--no-sync"]),
        new Set(),
        "agent-harness discover full --help",
      );
      assert.equal(rejected, false);
      assert.deepEqual(messages, []);
    } finally {
      console.error = originalError;
    }
  });

  void it("returns true and prints an error with the custom usage hint", () => {
    const messages: string[] = [];
    const originalError = console.error;
    console.error = (message?: unknown) => messages.push(String(message));
    try {
      const rejected = hasUnknownFlag(
        ["--bad-flag"],
        new Set(),
        new Set(),
        "agent-harness discover full --help",
      );
      assert.equal(rejected, true);
      assert.match(messages[0] ?? "", /error: unknown option '--bad-flag'/u);
      assert.match(
        messages[1] ?? "",
        /Run 'agent-harness discover full --help' for usage/u,
      );
    } finally {
      console.error = originalError;
    }
  });
});
