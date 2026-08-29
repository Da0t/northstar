import { describe, expect, it } from "vitest";
import { MAX_UINT32 } from "./simulation";
import {
  DEFAULT_SIMULATION_SEED,
  nextSeed,
  parseSeedInput,
} from "./runConfig";

describe("parseSeedInput", () => {
  it("accepts the uint32 boundaries and decimal leading zeroes", () => {
    expect(parseSeedInput("0")).toEqual({ ok: true, value: 0 });
    expect(parseSeedInput(String(MAX_UINT32))).toEqual({
      ok: true,
      value: MAX_UINT32,
    });
    expect(parseSeedInput("00042")).toEqual({ ok: true, value: 42 });
  });

  it.each(["", " ", "   ", "\t", "\n"])(
    "rejects blank or whitespace-only input %#",
    (input) => {
      expect(parseSeedInput(input)).toMatchObject({ ok: false });
    },
  );

  it.each([" 42", "42 ", "4 2", "\t42", "42\n"])(
    "rejects surrounding or embedded whitespace %#",
    (input) => {
      expect(parseSeedInput(input)).toMatchObject({ ok: false });
    },
  );

  it.each(["+1", "-1"])("rejects signed input %s", (input) => {
    expect(parseSeedInput(input)).toMatchObject({ ok: false });
  });

  it.each(["1.0", ".5", "1."])("rejects decimal input %s", (input) => {
    expect(parseSeedInput(input)).toMatchObject({ ok: false });
  });

  it.each(["1e3", "1E3", "4.294967295e9"])(
    "rejects exponent notation %s",
    (input) => {
      expect(parseSeedInput(input)).toMatchObject({ ok: false });
    },
  );

  it.each(["seed", "0x10", "NaN", "Infinity", "１２"])(
    "rejects non-decimal input %s",
    (input) => {
      expect(parseSeedInput(input)).toMatchObject({ ok: false });
    },
  );

  it.each([String(MAX_UINT32 + 1), "999999999999999999999999999999999999"])(
    "rejects uint32 overflow %s",
    (input) => {
      expect(parseSeedInput(input)).toMatchObject({ ok: false });
    },
  );

  it("exports a valid reproducible default", () => {
    expect(DEFAULT_SIMULATION_SEED).toBe(1_313_821_268);
    expect(parseSeedInput(String(DEFAULT_SIMULATION_SEED))).toEqual({
      ok: true,
      value: DEFAULT_SIMULATION_SEED,
    });
  });
});

describe("nextSeed", () => {
  it("increments within the uint32 range", () => {
    expect(nextSeed(0)).toBe(1);
    expect(nextSeed(MAX_UINT32 - 1)).toBe(MAX_UINT32);
  });

  it("wraps the uint32 maximum to zero", () => {
    expect(nextSeed(MAX_UINT32)).toBe(0);
  });

  it.each([-1, MAX_UINT32 + 1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects invalid programmatic seed %s",
    (seed) => {
      expect(() => nextSeed(seed)).toThrow(RangeError);
    },
  );
});
