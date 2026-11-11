import { afterEach, describe, expect, it, vi } from "vitest";
import { RETRY_DELAYS, RetryLoop, isFatalMediaError } from "../src/recovery.js";

describe("isFatalMediaError", () => {
  it("treats denied permission and insecure origin as fatal", () => {
    expect(isFatalMediaError({ name: "NotAllowedError" })).toBe(true);
    expect(isFatalMediaError({ name: "PermissionDeniedError" })).toBe(true);
    expect(isFatalMediaError({ name: "SecurityError" })).toBe(true);
  });

  it("allows retries for a missing or busy device", () => {
    expect(isFatalMediaError({ name: "NotFoundError" })).toBe(false);
    expect(isFatalMediaError({ name: "NotReadableError" })).toBe(false);
    expect(isFatalMediaError(new Error("Mic tidak tersedia"))).toBe(false);
    expect(isFatalMediaError(null)).toBe(false);
  });
});

describe("RetryLoop", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("waits 2, 5, then 10 seconds between attempts", async () => {
    vi.useFakeTimers();
    const loop = new RetryLoop();
    const task = vi.fn().mockResolvedValue(false);

    expect(loop.schedule(task)).toBe(RETRY_DELAYS[0]);
    await vi.advanceTimersByTimeAsync(1999);
    expect(task).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(task).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(4999);
    expect(task).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(task).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(10000);
    expect(task).toHaveBeenCalledTimes(3);
  });

  it("stops after the third failed attempt", async () => {
    vi.useFakeTimers();
    const loop = new RetryLoop();
    const task = vi.fn().mockResolvedValue(false);

    loop.schedule(task);
    await vi.advanceTimersByTimeAsync(30000);

    expect(task).toHaveBeenCalledTimes(3);
    expect(loop.exhausted).toBe(true);
    expect(loop.pending).toBe(false);
    expect(loop.schedule(task)).toBeNull();
    await vi.advanceTimersByTimeAsync(30000);
    expect(task).toHaveBeenCalledTimes(3);
  });

  it("resets the counter once the device is back", async () => {
    vi.useFakeTimers();
    const loop = new RetryLoop();
    const task = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);

    loop.schedule(task);
    await vi.advanceTimersByTimeAsync(2000);
    expect(loop.attempt).toBe(2);

    await vi.advanceTimersByTimeAsync(5000);
    expect(task).toHaveBeenCalledTimes(2);
    expect(loop.attempt).toBe(0);
    expect(loop.exhausted).toBe(false);
  });

  it("calls onExhausted once when the last attempt fails", async () => {
    vi.useFakeTimers();
    const onExhausted = vi.fn();
    const loop = new RetryLoop({ onExhausted });
    const task = vi.fn().mockResolvedValue(false);

    loop.schedule(task);
    await vi.advanceTimersByTimeAsync(30000);

    expect(onExhausted).toHaveBeenCalledTimes(1);
  });

  it("does not run a queued attempt after stop", async () => {
    vi.useFakeTimers();
    const loop = new RetryLoop();
    const task = vi.fn().mockResolvedValue(true);

    loop.schedule(task);
    loop.stop();
    await vi.advanceTimersByTimeAsync(30000);

    expect(task).not.toHaveBeenCalled();
    expect(loop.pending).toBe(false);
  });

  it("ignores a second schedule while one is pending", async () => {
    vi.useFakeTimers();
    const loop = new RetryLoop();
    const task = vi.fn().mockResolvedValue(false);

    loop.schedule(task);
    expect(loop.schedule(task)).toBeNull();
    await vi.advanceTimersByTimeAsync(2000);
    expect(task).toHaveBeenCalledTimes(1);
  });
});
