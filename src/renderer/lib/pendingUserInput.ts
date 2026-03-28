import type { PendingUserInputQuestion } from "@shared/types";

export interface PendingUserInputDraftAnswer {
  selectedOptionLabel?: string;
  customAnswer?: string;
}

export interface PendingUserInputProgress {
  questionIndex: number;
  activeQuestion: PendingUserInputQuestion | null;
  selectedOptionLabel: string | undefined;
  customAnswer: string;
  resolvedAnswer: string | null;
  isLastQuestion: boolean;
  isComplete: boolean;
  canAdvance: boolean;
}

function normalizeDraftAnswer(value: string | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export function resolvePendingUserInputAnswer(
  draft: PendingUserInputDraftAnswer | undefined
): string | null {
  return normalizeDraftAnswer(draft?.customAnswer) ?? normalizeDraftAnswer(draft?.selectedOptionLabel);
}

export function setPendingUserInputCustomAnswer(
  draft: PendingUserInputDraftAnswer | undefined,
  customAnswer: string
): PendingUserInputDraftAnswer {
  const selectedOptionLabel = customAnswer.trim().length > 0 ? undefined : draft?.selectedOptionLabel;
  return {
    customAnswer,
    ...(selectedOptionLabel ? { selectedOptionLabel } : {})
  };
}

export function buildPendingUserInputAnswers(
  questions: ReadonlyArray<PendingUserInputQuestion>,
  draftAnswers: Record<string, PendingUserInputDraftAnswer>
): Record<string, string> | null {
  const answers: Record<string, string> = {};
  for (const question of questions) {
    const answer = resolvePendingUserInputAnswer(draftAnswers[question.id]);
    if (!answer) {
      return null;
    }
    answers[question.id] = answer;
  }
  return answers;
}

export function derivePendingUserInputProgress(
  questions: ReadonlyArray<PendingUserInputQuestion>,
  draftAnswers: Record<string, PendingUserInputDraftAnswer>,
  questionIndex: number
): PendingUserInputProgress {
  const normalizedIndex =
    questions.length === 0 ? 0 : Math.max(0, Math.min(questionIndex, questions.length - 1));
  const activeQuestion = questions[normalizedIndex] ?? null;
  const activeDraft = activeQuestion ? draftAnswers[activeQuestion.id] : undefined;
  const resolvedAnswer = resolvePendingUserInputAnswer(activeDraft);
  const customAnswer = activeDraft?.customAnswer ?? "";
  const isLastQuestion = questions.length === 0 ? true : normalizedIndex >= questions.length - 1;

  return {
    questionIndex: normalizedIndex,
    activeQuestion,
    selectedOptionLabel: activeDraft?.selectedOptionLabel,
    customAnswer,
    resolvedAnswer,
    isLastQuestion,
    isComplete: buildPendingUserInputAnswers(questions, draftAnswers) !== null,
    canAdvance: Boolean(resolvedAnswer)
  };
}
