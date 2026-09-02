import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import {
  announcementQueryKeys,
  announcementStreamUrl,
  fetchCurrentAnnouncement,
  markAnnouncementRead,
} from "@/entities/announcement";
import { publicApiError } from "@/shared/api/errors";

export default function AnnouncementBanner() {
  const queryClient = useQueryClient();
  const announcementQuery = useQuery({
    queryKey: announcementQueryKeys.current(),
    queryFn: fetchCurrentAnnouncement,
  });
  const [loading, setLoading] = useState(true);
  const [streamState, setStreamState] = useState<
    "connecting" | "connected" | "reconnecting"
  >("connecting");
  const [streamError, setStreamError] = useState("");
  const streamRef = useRef<EventSource | null>(null);
  const retryTimerRef = useRef<number | null>(null);

  const clearRetryTimer = useCallback(() => {
    if (retryTimerRef.current) {
      window.clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
  }, []);

  const closeStream = useCallback(() => {
    streamRef.current?.close();
    streamRef.current = null;
  }, []);

  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({
      queryKey: announcementQueryKeys.current(),
    });
  }, [queryClient]);

  const connectStream = useCallback(() => {
    clearRetryTimer();
    closeStream();
    setStreamState("connecting");
    const source = new EventSource(announcementStreamUrl());
    streamRef.current = source;

    source.onopen = () => {
      setStreamState("connected");
      setStreamError("");
      refresh();
    };
    source.addEventListener("announcement.published", refresh);
    source.addEventListener("announcement.revoked", refresh);
    source.addEventListener("heartbeat", () => undefined);
    source.onerror = () => {
      setStreamState("reconnecting");
      setStreamError("系统公告流已断开，正在重连…");
      closeStream();
      clearRetryTimer();
      refresh();
      retryTimerRef.current = window.setTimeout(connectStream, 3500);
    };
  }, [clearRetryTimer, closeStream, refresh]);

  useEffect(() => {
    connectStream();
    return () => {
      clearRetryTimer();
      closeStream();
    };
  }, [clearRetryTimer, closeStream, connectStream]);

  useEffect(() => {
    if (announcementQuery.isFetching) return;
    setLoading(false);
    setStreamError(
      announcementQuery.error
        ? publicApiError(announcementQuery.error, "读取系统公告失败")
        : ""
    );
  }, [
    announcementQuery.dataUpdatedAt,
    announcementQuery.error,
    announcementQuery.isFetching,
  ]);

  const markReadMutation = useMutation({
    mutationFn: markAnnouncementRead,
    onSuccess: () => {
      queryClient.setQueryData(announcementQueryKeys.current(), null);
      setStreamError("");
      toast.success("公告已标记为已读");
    },
    onError: error => {
      toast.error(publicApiError(error, "标记公告已读失败"));
    },
  });

  const retry = () => {
    setLoading(true);
    void announcementQuery.refetch();
    connectStream();
  };

  const announcement = announcementQuery.data ?? null;
  const error = streamError;

  if (!loading && !error && !announcement) return null;

  return (
    <section
      style={{
        maxWidth: 1480,
        margin: "18px auto 0",
        padding: "0 clamp(16px, 2.5vw, 38px)",
      }}
    >
      <div
        style={{
          display: "flex",
          gap: 14,
          justifyContent: "space-between",
          alignItems: "flex-start",
          padding: "14px 16px",
          border: "1px solid var(--line)",
          background: "rgba(25,31,32,.92)",
          boxShadow: "0 16px 30px rgba(0,0,0,.12)",
          backdropFilter: "blur(12px)",
          flexWrap: "wrap",
        }}
      >
        <div style={{ minWidth: 0, flex: "1 1 360px" }}>
          <p className="eyebrow">SYSTEM ANNOUNCEMENT</p>
          <h3
            style={{
              margin: 0,
              color: "#f2efe5",
              fontSize: 15,
              letterSpacing: "-.04em",
            }}
          >
            {loading
              ? "正在读取系统公告…"
              : announcement?.title || "系统公告暂时不可用"}
          </h3>
          <p
            style={{
              margin: "8px 0 0",
              color: "#919a96",
              fontSize: 12,
              lineHeight: 1.65,
            }}
          >
            {loading
              ? "正在同步当前未读公告与实时发布流。"
              : announcement
                ? announcement.content
                : error || "当前没有未读公告。"}
          </p>
        </div>
        <div
          style={{
            display: "flex",
            gap: 8,
            alignItems: "center",
            flexWrap: "wrap",
          }}
        >
          {announcement && (
            <span
              className={`status-chip ${
                announcement.kind === "maintenance" ? "sand" : "blue"
              }`}
            >
              {announcement.kind}
            </span>
          )}
          <span
            className={`status-chip ${
              streamState === "connected"
                ? "running"
                : streamState === "reconnecting"
                  ? "sand"
                  : "blue"
            }`}
          >
            {loading ? "loading" : streamState}
          </span>
          {announcement && (
            <button
              className="outline-button small"
              onClick={() => markReadMutation.mutate(announcement.id)}
              disabled={markReadMutation.isPending}
            >
              已读
            </button>
          )}
          {!announcement && error && (
            <button
              className="outline-button small"
              onClick={retry}
              disabled={markReadMutation.isPending}
            >
              重试
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
