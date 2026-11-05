"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { drawingMetadata, isDrawingResult, type DrawingApi, type ProcessingResponse } from "./drawing-api";
import type { ProcessingJob } from "@bim/contracts";

export const POLL_INTERVAL_MS = 2000;
export const POLL_TIMEOUT_MS = 120000;
export const drawingKey = (id: string, demo = false) => ["drawing-detail", demo ? "demo" : "api", id] as const;

export function useDrawingDetail(id: string, api: DrawingApi, demo: boolean) {
  const client = useQueryClient();
  const key = drawingKey(id, demo);
  const [job, setJob] = useState<ProcessingJob | null>(null);
  const [timedOut, setTimedOut] = useState(false);
  const [pollRound, setPollRound] = useState(0);
  const operation = useRef<AbortController | null>(null);
  const lock = useRef(false);
  useEffect(() => () => operation.current?.abort(), []);

  const detail = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => api.getDrawing(id, signal),
    retry: false,
    refetchOnWindowFocus: false,
    gcTime: 0,
    refetchInterval: query => !!api.getJob && !timedOut && !query.state.error &&
      (query.state.data && drawingMetadata(query.state.data).status === "processing" ||
        job?.status !== "failed" && !!job && query.state.data && !["processed", "failed", "error"].includes(drawingMetadata(query.state.data).status))
      ? POLL_INTERVAL_MS : false,
  });
  const jobQuery = useQuery({
    queryKey: [...key, "job", job?.id],
    queryFn: async ({ signal }) => {
      if (!api.getJob || !job) throw new Error("Job polling is unavailable.");
      const next = await api.getJob(job.id, signal);
      if (next.drawingId !== id) throw new Error("Unexpected drawing in job response.");
      return next;
    },
    enabled: !!api.getJob && !!job && !timedOut && (job.status === "queued" || job.status === "processing"),
    initialData: job ?? undefined,
    retry: false,
    gcTime: 0,
    refetchOnWindowFocus: false,
    refetchInterval: query => !query.state.error &&
      (query.state.data?.status === "queued" || query.state.data?.status === "processing") ? POLL_INTERVAL_MS : false,
  });
  const currentJob = jobQuery.data ?? job;
  const status = detail.data ? drawingMetadata(detail.data).status : undefined;
  // In the synchronous API, persisted `processing` means rooms are ready for
  // placement. Only explicit demo jobs represent background work to poll.
  const active = !!api.getJob && (status === "processing" || currentJob?.status === "queued" || currentJob?.status === "processing" ||
    currentJob?.status === "completed" && status !== "processed" && status !== "failed" && status !== "error");

  useEffect(() => {
    if (!api.getJob || !active || timedOut) return;
    const timer = setTimeout(() => setTimedOut(true), POLL_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [api, active, timedOut, pollRound]);

  useEffect(() => {
    if (timedOut) void client.cancelQueries({ queryKey: drawingKey(id, demo) });
  }, [timedOut, client, id, demo]);

  useEffect(() => {
    if (currentJob?.status !== "completed" && currentJob?.status !== "failed") return;
    void client.invalidateQueries({ queryKey: drawingKey(id, demo), exact: true });
  }, [currentJob?.status, client, id, demo]);

  const receiveResult = async (next: ProcessingResponse) => {
    if (operation.current?.signal.aborted) return;
    if ("drawing" in next) client.setQueryData(key, next);
    setJob("id" in next ? next : null);
    setTimedOut(false);
    setPollRound(value => value + 1);
    await client.invalidateQueries({ queryKey: key, exact: true });
  };
  const process = useMutation({
    retry: false,
    mutationFn: async () => {
      operation.current = new AbortController();
      const { signal } = operation.current;
      await client.cancelQueries({ queryKey: key, exact: true });
      signal.throwIfAborted();
      return api.processDrawing(id, signal);
    },
    onSuccess: receiveResult,
    onError: () => client.invalidateQueries({ queryKey: key, exact: true }),
    onSettled: () => { lock.current = false; },
  });
  const place = useMutation({
    retry: false,
    mutationFn: async () => {
      if (!api.placeDrawing) throw new Error("Placement is unavailable.");
      operation.current = new AbortController();
      const { signal } = operation.current;
      await client.cancelQueries({ queryKey: key, exact: true });
      signal.throwIfAborted();
      return api.placeDrawing(id, signal);
    },
    onSuccess: receiveResult,
    onError: () => client.invalidateQueries({ queryKey: key, exact: true }),
    onSettled: () => { lock.current = false; },
  });
  const busy = active || process.isPending || place.isPending;

  return {
    detail, process, place, currentJob, timedOut,
    jobError: jobQuery.error,
    busy,
    start: () => {
      if (lock.current || busy) return;
      lock.current = true;
      place.reset();
      process.mutate();
    },
    startPlacement: () => {
      if (lock.current || busy || !api.placeDrawing || !detail.data || !isDrawingResult(detail.data) || !detail.data.rooms.length) return;
      lock.current = true;
      process.reset();
      place.mutate();
    },
    refresh: async () => {
      setTimedOut(false);
      setPollRound(value => value + 1);
      await Promise.all([detail.refetch(), ...(api.getJob && job ? [jobQuery.refetch()] : [])]);
    },
  };
}
