import { describe, it, expect } from "vitest";
import { checkScopeForRpc } from "../scope-check";

describe("checkScopeForRpc", () => {
  it("allows non-tools/call methods regardless of scope", () => {
    expect(checkScopeForRpc({ method: "tools/list" }, []).ok).toBe(true);
    expect(checkScopeForRpc({ method: "initialize" }, []).ok).toBe(true);
    expect(checkScopeForRpc({ method: "ping" }, ["read"]).ok).toBe(true);
  });

  it("requires book scope for booking tools", () => {
    for (const tool of ["book_restaurant", "book_hotel", "book_flight", "book_activity"]) {
      const denied = checkScopeForRpc(
        { method: "tools/call", params: { name: tool } },
        ["read"],
      );
      expect(denied.ok).toBe(false);
      if (!denied.ok) {
        expect(denied.required).toBe("book");
        expect(denied.toolName).toBe(tool);
      }

      expect(
        checkScopeForRpc(
          { method: "tools/call", params: { name: tool } },
          ["book"],
        ).ok,
      ).toBe(true);
    }
  });

  it("requires read scope for read-only tools", () => {
    for (const tool of ["get_job_status", "get_job_audit"]) {
      const denied = checkScopeForRpc(
        { method: "tools/call", params: { name: tool } },
        ["book"],
      );
      expect(denied.ok).toBe(false);
      if (!denied.ok) expect(denied.required).toBe("read");

      expect(
        checkScopeForRpc(
          { method: "tools/call", params: { name: tool } },
          ["read"],
        ).ok,
      ).toBe(true);
    }
  });

  it("denies when token has no scopes", () => {
    expect(
      checkScopeForRpc(
        { method: "tools/call", params: { name: "book_restaurant" } },
        [],
      ).ok,
    ).toBe(false);
  });

  it("passes through unknown tool names (let the SDK return MethodNotFound)", () => {
    expect(
      checkScopeForRpc(
        { method: "tools/call", params: { name: "mystery_tool" } },
        [],
      ).ok,
    ).toBe(true);
  });

  it("passes through malformed bodies", () => {
    expect(checkScopeForRpc(null, []).ok).toBe(true);
    expect(checkScopeForRpc("garbage", []).ok).toBe(true);
    expect(checkScopeForRpc({ method: "tools/call" }, []).ok).toBe(true);
    expect(checkScopeForRpc({ method: "tools/call", params: {} }, []).ok).toBe(true);
  });
});
