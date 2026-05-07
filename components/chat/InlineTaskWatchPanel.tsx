"use client";

import dynamic from "next/dynamic";

const TaskTimelinePanel = dynamic(() => import("@/components/task-timeline/TaskTimelinePanel"), {
  ssr: false,
  loading: () => (
    <div style={{ padding: 16, color: "#f8fafc", fontSize: 13 }}>
      Loading task timeline...
    </div>
  ),
});

export type InlineTaskWatchState = {
  jobId: string;
  title: string;
};

type InlineTaskWatchPanelProps = {
  panel: InlineTaskWatchState;
  panelKey: number;
  onClose: () => void;
};

export default function InlineTaskWatchPanel({
  panel,
  panelKey,
  onClose,
}: InlineTaskWatchPanelProps) {
  return (
    <>
      <button
        type="button"
        aria-label="Close task observer"
        className="chat-task-watch-backdrop"
        onClick={onClose}
      />
      <div className="chat-task-watch-panel">
        <TaskTimelinePanel
          key={panelKey}
          jobId={panel.jobId}
          title={panel.title}
          onClose={onClose}
        />
      </div>
    </>
  );
}
