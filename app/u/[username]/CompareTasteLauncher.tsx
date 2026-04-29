"use client";

import { useState } from "react";
import CompareTasteModal from "./CompareTasteModal";

/**
 * Small wrapper that owns the modal-open state. The page is a server
 * component and can't hold useState, so this renders the button + modal
 * pair inline.
 */
export default function CompareTasteLauncher({
  peerHandle,
  peerDisplayName,
}: {
  peerHandle: string;
  peerDisplayName: string | null;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={{
          padding: "8px 14px",
          borderRadius: 999,
          border: "1px solid var(--gold, #C9A84C)",
          background: "transparent",
          color: "var(--gold-text, #5A4416)",
          fontFamily: "var(--font-dm-sans)",
          fontSize: 12,
          fontWeight: 600,
          cursor: "pointer",
        }}
      >
        Are we a match?
      </button>
      <CompareTasteModal
        isOpen={open}
        onClose={() => setOpen(false)}
        peerHandle={peerHandle}
        peerDisplayName={peerDisplayName}
      />
    </>
  );
}
