"use client";

// Exam, session label, and date for both import modes. The page keeps this
// state above the mode switch, so switching modes keeps what Joe typed.

import { useState } from "react";
import { loadExam, loadRoster, type ExamRecord, type RosterEntry } from "@/lib/exams";
import { newExamRecord, postExam } from "@/lib/import/remote";
import { paths } from "@/lib/storage/paths";
import { Button, Card, Icon } from "@/lib/ui";
import { exists, field, today } from "./shared";

export function useSessionDetails() {
  const [examId, setExamId] = useState("");
  const [exam, setExam] = useState<ExamRecord | null>(null);
  const [examState, setExamState] = useState<"idle" | "missing" | "found">("idle");
  const [examMsg, setExamMsg] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState("");
  const [newMinutes, setNewMinutes] = useState(5);
  const [roster, setRoster] = useState<RosterEntry[] | null>(null);
  const [sessionLabel, setSessionLabel] = useState("");
  const [sessionDate, setSessionDate] = useState(today);
  const [labelTaken, setLabelTaken] = useState(false);

  async function checkExam() {
    setExamMsg(null);
    try {
      const e = await loadExam(examId.trim());
      setExam(e);
      setExamState("found");
      await refreshRoster(e.id);
    } catch (e) {
      setExam(null);
      // Only a 404 means the exam does not exist; any other failure must not
      // offer to create an exam over one the archive might hold.
      if ((e as Error).message.includes("HTTP 404")) setExamState("missing");
      else {
        setExamState("idle");
        setExamMsg(`The exam did not load: ${(e as Error).message}. Try again.`);
      }
    }
  }

  async function refreshRoster(id: string) {
    try {
      setRoster(await loadRoster(id));
    } catch {
      setRoster(null);
    }
  }

  async function createExam() {
    const record = newExamRecord(examId, newTitle, newMinutes);
    try {
      await postExam(fetch, record);
    } catch (e) {
      setExamMsg(`The exam was not created: ${(e as Error).message}`);
      return;
    }
    setExam(record);
    setExamState("found");
    setExamMsg(`Created exam ${record.id}.`);
    await refreshRoster(record.id);
  }

  async function checkLabel(label: string) {
    setLabelTaken(
      /^[A-Za-z0-9_-]+$/.test(label) ? await exists(paths.sessionImport(label)) : false,
    );
  }

  return {
    examId,
    setExamId,
    exam,
    examState,
    setExamState,
    examMsg,
    newTitle,
    setNewTitle,
    newMinutes,
    setNewMinutes,
    roster,
    sessionLabel,
    setSessionLabel,
    sessionDate,
    setSessionDate,
    labelTaken,
    setLabelTaken,
    checkExam,
    createExam,
    checkLabel,
  };
}

export type SessionDetails = ReturnType<typeof useSessionDetails>;

export function SessionDetailsCard({ d }: { d: SessionDetails }) {
  return (
    <Card className="flex flex-col gap-4">
      <h2 className="text-xl font-medium">1. Session</h2>
      <div className="flex gap-3 items-center flex-wrap">
        <input
          aria-label="Exam id"
          value={d.examId}
          onChange={(e) => {
            d.setExamId(e.target.value);
            d.setExamState("idle");
          }}
          placeholder="exam id"
          className={field}
        />
        <Button onClick={d.checkExam} disabled={!d.examId.trim()}>
          Check exam
        </Button>
        {d.examState === "found" && d.exam ? (
          <span className="text-sm text-on-surface-variant" data-testid="exam-found">
            Exam {d.exam.id}
            {d.exam.title ? `, ${d.exam.title}` : ""}: {d.exam.durationMs / 60000} minutes,{" "}
            {d.exam.targetPatterns.length} target patterns.
          </span>
        ) : null}
      </div>
      {d.examState === "missing" ? (
        <div className="flex flex-col gap-3 border border-outline-variant rounded-control p-4">
          <p className="text-sm">
            The archive has no exam {d.examId.trim()}. Create it with a title and a duration. Target
            patterns and keyterms stay empty, and you can add them on the setup screen later.
          </p>
          <div className="flex gap-3 items-center flex-wrap">
            <input
              aria-label="Exam title"
              value={d.newTitle}
              onChange={(e) => d.setNewTitle(e.target.value)}
              placeholder="title"
              className={field}
            />
            <label className="flex items-center gap-2 text-sm">
              Duration (minutes)
              <input
                aria-label="Exam duration in minutes"
                type="number"
                min={1}
                max={15}
                value={d.newMinutes}
                onChange={(e) => d.setNewMinutes(Number(e.target.value))}
                className={`${field} w-24`}
              />
            </label>
            <Button onClick={d.createExam} disabled={!d.newTitle.trim() || !(d.newMinutes >= 1)}>
              Create exam
            </Button>
          </div>
        </div>
      ) : null}
      {d.examMsg ? <p className="text-sm">{d.examMsg}</p> : null}
      {d.examState === "found" && d.roster === null ? (
        <p className="text-warn text-sm flex items-center gap-2">
          <Icon name="warning" />
          Exam {d.exam?.id} has no roster, so every pair counts as unknown consent and the import
          marks it excluded. Import the roster on the setup screen, then check the exam again.
        </p>
      ) : null}
      <div className="flex gap-3 items-center flex-wrap">
        <input
          aria-label="Session label"
          value={d.sessionLabel}
          onChange={(e) => {
            d.setSessionLabel(e.target.value.trim());
            d.setLabelTaken(false);
          }}
          onBlur={(e) => void d.checkLabel(e.target.value.trim())}
          placeholder="session label, e.g. C1_26_02_S1"
          className={`${field} w-80`}
        />
        <label className="flex items-center gap-2 text-sm">
          Session date
          <input
            aria-label="Session date"
            type="date"
            value={d.sessionDate}
            onChange={(e) => d.setSessionDate(e.target.value)}
            className={field}
          />
        </label>
      </div>
      {d.labelTaken ? (
        <p className="text-fault text-sm flex items-center gap-2">
          <Icon name="block" />
          The archive already holds session {d.sessionLabel}. Choose another label.
        </p>
      ) : null}
    </Card>
  );
}
