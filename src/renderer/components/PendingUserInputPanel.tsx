import { useEffect, useRef } from "react";
import type { PendingUserInputRequest } from "@shared/types";
import { ArrowRightIcon, CheckIcon, ClipboardListIcon } from "lucide-react";
import { derivePendingUserInputProgress, type PendingUserInputDraftAnswer } from "@renderer/lib/pendingUserInput";

interface PendingUserInputPanelProps {
  request: PendingUserInputRequest | null;
  answers: Record<string, PendingUserInputDraftAnswer>;
  questionIndex: number;
  isResponding: boolean;
  onSelectOption: (questionId: string, optionLabel: string) => void;
  onAdvance: () => void;
}

export function PendingUserInputPanel({
  request,
  answers,
  questionIndex,
  isResponding,
  onSelectOption,
  onAdvance
}: PendingUserInputPanelProps) {
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
      }
    };
  }, []);

  if (!request || request.questions.length === 0) {
    return null;
  }

  const progress = derivePendingUserInputProgress(request.questions, answers, questionIndex);
  const activeQuestion = progress.activeQuestion;
  if (!activeQuestion) {
    return null;
  }

  const selectOptionAndAutoAdvance = (questionId: string, optionLabel: string) => {
    onSelectOption(questionId, optionLabel);
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
    }
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      onAdvance();
    }, 200);
  };

  return (
    <div className="pending-user-input">
      <div className="pending-user-input-header">
        <span className="summary-card-badge">
          <ClipboardListIcon size={12} />
          Request User Input
        </span>
        {request.questions.length > 1 ? <span>{progress.questionIndex + 1} of {request.questions.length}</span> : null}
      </div>
      <p className="pending-user-input-question">{activeQuestion.question}</p>
      <div className="pending-user-input-options">
        {activeQuestion.options.map((option, index) => {
          const isSelected = progress.selectedOptionLabel === option.label;
          return (
            <button
              key={`${activeQuestion.id}:${option.label}`}
              type="button"
              className={`pending-user-input-option ${isSelected ? "selected" : ""}`}
              disabled={isResponding}
              onClick={() => selectOptionAndAutoAdvance(activeQuestion.id, option.label)}
            >
              <kbd>{index + 1}</kbd>
              <div>
                <span>{option.label}</span>
                <small>{option.description}</small>
              </div>
              {isSelected ? <CheckIcon size={13} /> : <ArrowRightIcon size={13} />}
            </button>
          );
        })}
      </div>
    </div>
  );
}
